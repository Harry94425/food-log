import { FoodItem, LabelRecognition, Recognition, RecognizerError } from './types';

/** 一種辨識工作：提示詞、回傳格式、解析方式。兩家 AI 共用 */
export type RecognitionTask<T> = {
  /** OpenAI json_schema 需要的名稱 */
  name: string;
  prompt: (hint?: string) => string;
  schema: object;
  /** OpenAI strict 模式要求每個物件都標 additionalProperties: false */
  strictSchema: object;
  parse: (text: string) => T;
};

const withHint = (prompt: string, hint?: string) => (hint ? `${prompt}\n\n使用者補充：${hint}` : prompt);

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new RecognizerError('無法解析 AI 回傳的內容。');
  }
}

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.round(v * 10) / 10) : 0);

const NUTRIENTS_PROPS = {
  kcal: { type: 'number' },
  protein: { type: 'number' },
  fat: { type: 'number' },
  carbs: { type: 'number' },
} as const;
const NUTRIENT_KEYS = ['kcal', 'protein', 'fat', 'carbs'];

// ---- 拍餐點 ----

const MEAL_PROMPT = `你是營養師。辨識照片中的所有食物與飲料，估計每一項的份量與營養素。

規則：
- title 是整份餐點的名稱，像菜單上會寫的那樣，例如「豬排咖哩飯」「雞腿便當」「牛肉麵＋燙青菜」。
- 食物名稱用繁體中文，以台灣常見說法命名（例如：滷肉飯、雞腿便當、無糖豆漿）。
- portion 寫出估計份量，盡量附上克數或毫升，例如「1 碗 (約 200g)」。
- kcal 為大卡，protein / fat / carbs 為公克，都是該項目的總量（不是每 100g）。
- 便當或套餐請拆成主食、主菜、配菜分別列出。
- 記得估算看不太到的油、醬汁、勾芡。
- 如果照片是包裝上的「營養標示」表格：照抄表上的數字，不要估算；name 用商品名稱（看不到就寫「包裝食品」），
  預設記 1 份，portion 寫清楚依據，例如「1 份 (30g)，本包裝 3 份」；只有每 100 公克時寫「100g」。
  note 提醒使用者確認吃了幾份。
- note 用一句話說明最不確定的地方；沒有就留空字串。
- 照片裡沒有食物時，items 回傳空陣列，並在 note 說明。`;

const ITEM_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, portion: { type: 'string' }, ...NUTRIENTS_PROPS },
  required: ['name', 'portion', ...NUTRIENT_KEYS],
} as const;

const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    items: { type: 'array', items: ITEM_SCHEMA },
    note: { type: 'string' },
  },
  required: ['title', 'items', 'note'],
} as const;

export const MEAL_TASK: RecognitionTask<Recognition> = {
  name: 'food_recognition',
  prompt: (hint) => withHint(MEAL_PROMPT, hint),
  schema: MEAL_SCHEMA,
  strictSchema: {
    ...MEAL_SCHEMA,
    additionalProperties: false,
    properties: {
      ...MEAL_SCHEMA.properties,
      items: { type: 'array', items: { ...ITEM_SCHEMA, additionalProperties: false } },
    },
  },
  parse: (text) => {
    const raw = parseJson(text);
    const items = Array.isArray(raw?.items) ? raw.items : [];
    return {
      title: String(raw?.title ?? ''),
      items: items.map((i: any) => ({
        name: String(i?.name ?? '未知食物'),
        portion: String(i?.portion ?? ''),
        kcal: Math.round(num(i?.kcal)),
        protein: num(i?.protein),
        fat: num(i?.fat),
        carbs: num(i?.carbs),
      })),
      note: String(raw?.note ?? ''),
    };
  },
};

// ---- 掃營養標示 ----

const LABEL_PROMPT = `讀取照片中包裝上的「營養標示」表格，照實抄下數字，不要估算。

規則：
- name 是商品名稱（從包裝上看得到的），看不到就用「包裝食品」。
- serving_size 照標示寫，例如「每一份量 30 公克」寫成「30 公克」。
- serving_grams 是每份的公克或毫升數字；看不到填 0。
- servings_per_package 是「本包裝含 N 份」的 N；看不到填 0。
- per_serving 是「每份」的熱量（大卡）、蛋白質、脂肪、碳水化合物（公克）。
- 如果只有「每 100 公克」：有 serving_grams 就換算成每份；沒有就把每 100 公克當成一份，serving_size 寫「100 公克」、serving_grams 填 100。
- 熱量如果只有 kJ，除以 4.184 換成大卡。
- note 用一句話說明看不清楚或換算過的地方；沒有就留空字串。
- 照片裡找不到營養標示時，數字都填 0，並在 note 說明。`;

const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    serving_size: { type: 'string' },
    serving_grams: { type: 'number' },
    servings_per_package: { type: 'number' },
    per_serving: { type: 'object', properties: NUTRIENTS_PROPS, required: NUTRIENT_KEYS },
    note: { type: 'string' },
  },
  required: ['name', 'serving_size', 'serving_grams', 'servings_per_package', 'per_serving', 'note'],
} as const;

export const LABEL_TASK: RecognitionTask<LabelRecognition> = {
  name: 'nutrition_label',
  prompt: (hint) => withHint(LABEL_PROMPT, hint),
  schema: LABEL_SCHEMA,
  strictSchema: {
    ...LABEL_SCHEMA,
    additionalProperties: false,
    properties: {
      ...LABEL_SCHEMA.properties,
      per_serving: { ...LABEL_SCHEMA.properties.per_serving, additionalProperties: false },
    },
  },
  parse: (text) => {
    const raw = parseJson(text);
    const p = raw?.per_serving ?? {};
    return {
      name: String(raw?.name || '包裝食品'),
      servingSize: String(raw?.serving_size ?? ''),
      servingGrams: num(raw?.serving_grams) || null,
      servingsPerPackage: num(raw?.servings_per_package) || null,
      perServing: { kcal: num(p.kcal), protein: num(p.protein), fat: num(p.fat), carbs: num(p.carbs) },
      note: String(raw?.note ?? ''),
    };
  },
};

// ---- 手動輸入品項名稱，用文字估算 ----

const ITEM_TEXT_PROMPT = `你是營養師。依照使用者輸入的食物名稱與份量，估計這一份的營養素。

規則：
- 以台灣常見的做法與份量為準；沒寫份量就用一般一人份（例如白飯 1 碗約 200g）。
- name 保留使用者寫的名稱；portion 寫出你採用的份量，盡量附上克數或毫升。
- kcal 為大卡，protein / fat / carbs 為公克，都是這一份的總量。`;

export const ITEM_TEXT_TASK: RecognitionTask<FoodItem> = {
  name: 'food_item_estimate',
  prompt: (hint) => `${ITEM_TEXT_PROMPT}\n\n食物：${hint ?? ''}`,
  schema: ITEM_SCHEMA,
  strictSchema: { ...ITEM_SCHEMA, additionalProperties: false },
  parse: (text) => {
    const i = parseJson(text);
    return {
      name: String(i?.name ?? ''),
      portion: String(i?.portion ?? ''),
      kcal: Math.round(num(i?.kcal)),
      protein: num(i?.protein),
      fat: num(i?.fat),
      carbs: num(i?.carbs),
    };
  },
};
