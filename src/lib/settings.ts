import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Totals } from './db';
import { GeminiRecognizer } from './recognizer/gemini';
import { FoodRecognizer, RecognizerError } from './recognizer/types';

const API_KEY = 'gemini_api_key';

export const DEFAULT_MODEL = 'gemini-3.8-flash';

/** 預設的每日目標；每個人要在設定頁改成自己的 */
export const DEFAULT_GOALS: Totals = { kcal: 2350, protein: 90, fat: 65, carbs: 330 };

export type Settings = { model: string; goals: Totals };

export async function getApiKey() {
  return SecureStore.getItemAsync(API_KEY);
}

export async function setApiKey(value: string) {
  if (value) await SecureStore.setItemAsync(API_KEY, value);
  else await SecureStore.deleteItemAsync(API_KEY);
}

export async function getSettings(db: SQLiteDatabase): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const n = (k: keyof Totals) => (map[`goal_${k}`] ? Number(map[`goal_${k}`]) : DEFAULT_GOALS[k]);
  return {
    model: map.model || DEFAULT_MODEL,
    goals: { kcal: n('kcal'), protein: n('protein'), fat: n('fat'), carbs: n('carbs') },
  };
}

export async function saveSettings(db: SQLiteDatabase, s: Settings) {
  const entries: [string, string][] = [
    ['model', s.model],
    ...(Object.keys(s.goals) as (keyof Totals)[]).map((k): [string, string] => [`goal_${k}`, String(s.goals[k])]),
  ];
  await db.withTransactionAsync(async () => {
    for (const [k, v] of entries) {
      await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, v);
    }
  });
}

/**
 * 運動日的目標：多出來的熱量全部用碳水補（1g 碳水 = 4 kcal），蛋白質和脂肪不變。
 */
export function goalsForDay(base: Totals, exerciseKcal: number): Totals {
  return {
    ...base,
    kcal: base.kcal + exerciseKcal,
    carbs: base.carbs + Math.round(exerciseKcal / 4),
  };
}

export async function getRecognizer(db: SQLiteDatabase): Promise<FoodRecognizer> {
  const key = await getApiKey();
  if (!key) throw new RecognizerError('請先到「設定」輸入 Gemini API 金鑰。');
  const { model } = await getSettings(db);
  return new GeminiRecognizer(key, model);
}
