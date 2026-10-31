import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Totals } from './db';
import { GeminiRecognizer } from './recognizer/gemini';
import { OpenAIRecognizer } from './recognizer/openai';
import { FoodRecognizer, RecognizerError } from './recognizer/types';

export type Provider = 'gemini' | 'openai';

export const PROVIDERS: Record<Provider, { label: string; keyUrl: string; defaultModel: string; keyStore: string }> = {
  gemini: {
    label: 'Gemini（免費）',
    keyUrl: 'aistudio.google.com',
    defaultModel: 'gemini-3.8-flash',
    keyStore: 'gemini_api_key',
  },
  openai: {
    label: 'GPT（付費）',
    keyUrl: 'platform.openai.com',
    defaultModel: 'gpt-6-luna',
    keyStore: 'openai_api_key',
  },
};

/** 還沒填基本資料前暫用的一般目標；第一次使用時會依基本資料重新設定 */
export const DEFAULT_GOALS: Totals = { kcal: 2000, protein: 75, fat: 55, carbs: 280 };

export type Settings = { provider: Provider; models: Record<Provider, string>; goals: Totals };

export async function getApiKey(provider: Provider) {
  return SecureStore.getItemAsync(PROVIDERS[provider].keyStore);
}

export async function setApiKey(provider: Provider, value: string) {
  const key = PROVIDERS[provider].keyStore;
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

export async function getSettings(db: SQLiteDatabase): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const n = (k: keyof Totals) => (map[`goal_${k}`] ? Number(map[`goal_${k}`]) : DEFAULT_GOALS[k]);
  return {
    provider: map.provider === 'openai' ? 'openai' : 'gemini',
    models: {
      // 舊版只存 `model`（Gemini）
      gemini: map.model || PROVIDERS.gemini.defaultModel,
      openai: map.openai_model || PROVIDERS.openai.defaultModel,
    },
    goals: { kcal: n('kcal'), protein: n('protein'), fat: n('fat'), carbs: n('carbs') },
  };
}

export async function saveSettings(db: SQLiteDatabase, s: Settings) {
  const entries: [string, string][] = [
    ['provider', s.provider],
    ['model', s.models.gemini],
    ['openai_model', s.models.openai],
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
  const { provider, models } = await getSettings(db);
  const key = await getApiKey(provider);
  if (!key) throw new RecognizerError(`請先到「設定」輸入 ${PROVIDERS[provider].label} 的 API 金鑰。`);
  return provider === 'openai' ? new OpenAIRecognizer(key, models.openai) : new GeminiRecognizer(key, models.gemini);
}
