export const FOOD_PROMPT = `你是營養師。辨識照片中的所有食物與飲料，估計每一項的份量與營養素。

規則：
- 食物名稱用繁體中文，以台灣常見說法命名（例如：滷肉飯、雞腿便當、無糖豆漿）。
- portion 寫出估計份量，盡量附上克數或毫升，例如「1 碗 (約 200g)」。
- kcal 為大卡，protein / fat / carbs 為公克，都是該項目的總量（不是每 100g）。
- 便當或套餐請拆成主食、主菜、配菜分別列出。
- 記得估算看不太到的油、醬汁、勾芡。
- note 用一句話說明最不確定的地方；沒有就留空字串。
- 照片裡沒有食物時，items 回傳空陣列，並在 note 說明。`;

export const RECOGNITION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          portion: { type: 'string' },
          kcal: { type: 'number' },
          protein: { type: 'number' },
          fat: { type: 'number' },
          carbs: { type: 'number' },
        },
        required: ['name', 'portion', 'kcal', 'protein', 'fat', 'carbs'],
      },
    },
    note: { type: 'string' },
  },
  required: ['items', 'note'],
} as const;
