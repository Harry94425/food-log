import type { SQLiteDatabase } from 'expo-sqlite';
import type { Totals } from './db';
import { getRecognizer } from './settings';
import type { RecognitionTask } from './recognizer/tasks';
import { RecognizerError } from './recognizer/types';

export type Sex = 'male' | 'female';
export type GoalType = 'gain' | 'maintain' | 'lose';
export type Activity = 'none' | 'light' | 'moderate' | 'high';

/** 第一次使用時填的基本資料，用來設定每日目標 */
export type Profile = {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  goal: GoalType;
  /** 重訓、球類等「不會另外記錄」的運動量；騎車、跑步從 Strava 每天另外加 */
  activity: Activity;
  /** 目標體重；舊版資料沒有 */
  targetWeightKg?: number;
};

export const SEX_LABELS: Record<Sex, string> = { male: '男', female: '女' };
export const GOAL_LABELS: Record<GoalType, string> = { gain: '增肌', maintain: '維持', lose: '減脂' };
export const ACTIVITY_LABELS: Record<Activity, string> = {
  none: '幾乎不運動',
  light: '每週 1–3 次',
  moderate: '每週 3–5 次',
  high: '每週 6 次以上',
};

const ACTIVITY_FACTOR: Record<Activity, number> = { none: 1.2, light: 1.375, moderate: 1.55, high: 1.725 };
/** 每公斤體重的蛋白質（g） */
const PROTEIN_PER_KG: Record<GoalType, number> = { gain: 1.8, maintain: 1.6, lose: 2.0 };
/** 每天熱量盈餘／赤字 */
const KCAL_ADJUST: Record<GoalType, number> = { gain: 300, maintain: 0, lose: -400 };

const PROFILE_KEY = 'profile';

export async function getProfile(db: SQLiteDatabase): Promise<Profile | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', PROFILE_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Profile;
  } catch {
    return null;
  }
}

export async function saveProfile(db: SQLiteDatabase, p: Profile) {
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', PROFILE_KEY, JSON.stringify(p));
}

export function describeProfile(p: Profile) {
  const target = p.targetWeightKg ? `（目標體重 ${p.targetWeightKg} kg）` : '';
  return `${SEX_LABELS[p.sex]}、${p.age} 歲、${p.heightCm} cm、${p.weightKg} kg，目標${GOAL_LABELS[p.goal]}${target}，運動${ACTIVITY_LABELS[p.activity]}`;
}

/** 國健署成人健康體位：18.5 ≤ BMI < 24 */
export const HEALTHY_BMI: [number, number] = [18.5, 24];

export function bmi(weightKg: number, heightCm: number) {
  return weightKg / (heightCm / 100) ** 2;
}

export function bmiLabel(value: number) {
  if (value < HEALTHY_BMI[0]) return '過輕';
  if (value < HEALTHY_BMI[1]) return '健康';
  if (value < 27) return '過重';
  return '肥胖';
}

/** 某個 BMI 對應的體重 */
export function weightForBmi(value: number, heightCm: number) {
  return value * (heightCm / 100) ** 2;
}

const half = (kg: number) => Math.round(kg * 2) / 2;

/**
 * 依 BMI 建議目標體重：
 * 增肌先到 BMI 22（健康範圍中間），已經超過就再增 2 kg；
 * 減脂先回到健康範圍上限，已經在範圍內就少 2 kg、但不低於 BMI 20；維持就是現在的體重
 */
export function suggestTargetWeight(goal: GoalType, weightKg: number, heightCm: number) {
  const mid = weightForBmi(22, heightCm);
  if (goal === 'gain') return half(weightKg < mid ? mid : weightKg + 2);
  if (goal === 'lose') {
    const upper = weightForBmi(HEALTHY_BMI[1], heightCm);
    return half(weightKg > upper ? upper : Math.max(weightKg - 2, weightForBmi(20, heightCm)));
  }
  return half(weightKg);
}

/** 每週大概變化多少（kg，正負號跟方向一致），用來估要幾週 */
export function weeklyRate(goal: GoalType, weightKg: number) {
  if (goal === 'gain') return 0.3;
  if (goal === 'lose') return -weightKg * 0.0075;
  return 0;
}

/**
 * 不用 AI 的估算：Mifflin-St Jeor 基礎代謝 × 活動係數，再依目標加減；
 * 蛋白質依體重、脂肪佔 25% 熱量、剩下給碳水
 */
export function formulaGoals(p: Profile): Totals {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const kcal = Math.round((bmr * ACTIVITY_FACTOR[p.activity] + KCAL_ADJUST[p.goal]) / 50) * 50;
  const protein = Math.round(p.weightKg * PROTEIN_PER_KG[p.goal]);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carbs };
}

export type GoalSuggestion = Totals & { reason: string };

const GOAL_PROMPT = `你是運動營養師。依照使用者的基本資料，設定每天的飲食目標。

規則：
- kcal 為每天總熱量（大卡），protein / fat / carbs 為公克。
- 「運動」指的是重訓、球類等日常運動，請算進目標裡。
- 騎車、跑步等有手錶紀錄的運動，App 每天會把消耗另外加到當天目標並用碳水補，所以這裡不要算進去。
- 增肌：小幅熱量盈餘、蛋白質充足；減脂：適度赤字、蛋白質偏高；維持：熱量平衡。
- 四個數字要彼此一致：protein × 4 + carbs × 4 + fat × 9 約等於 kcal。
- reason 用繁體中文兩三句話說明怎麼算的，例如估計的每日消耗、盈餘多少、蛋白質每公斤幾克。`;

const GOAL_SCHEMA = {
  type: 'object',
  properties: {
    kcal: { type: 'number' },
    protein: { type: 'number' },
    fat: { type: 'number' },
    carbs: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['kcal', 'protein', 'fat', 'carbs', 'reason'],
} as const;

const GOAL_TASK: RecognitionTask<GoalSuggestion> = {
  name: 'daily_goals',
  prompt: (hint) => `${GOAL_PROMPT}\n\n使用者：${hint ?? ''}`,
  schema: GOAL_SCHEMA,
  strictSchema: { ...GOAL_SCHEMA, additionalProperties: false },
  parse: (text) => {
    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new RecognizerError('無法解析 AI 回傳的內容。');
    }
    const n = (v: unknown) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : 0);
    const goals = { kcal: n(raw?.kcal), protein: n(raw?.protein), fat: n(raw?.fat), carbs: n(raw?.carbs) };
    if (!goals.kcal || !goals.protein) throw new RecognizerError('AI 給的目標不完整，請再試一次或用公式估算。');
    return { ...goals, reason: String(raw?.reason ?? '') };
  },
};

/** 請 AI 依基本資料設定目標；沒設金鑰會丟 RecognizerError */
export async function suggestGoals(db: SQLiteDatabase, p: Profile, onStatus?: (m: string) => void) {
  const recognizer = await getRecognizer(db);
  return recognizer.run(GOAL_TASK, { hint: describeProfile(p), onStatus });
}
