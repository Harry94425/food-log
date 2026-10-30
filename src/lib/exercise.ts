export type ExercisePreset = {
  name: string;
  /** 固定消耗（kcal）；null 表示每次自己填，例如照碼表 */
  kcal: number | null;
};

/**
 * 重訓記 0 kcal：每日目標用的活動係數 1.375 已經包含每週 2–3 次重訓，
 * 再加會重複計算。記錄只是為了知道哪天有練。
 */
export const EXERCISE_PRESETS: ExercisePreset[] = [
  { name: '重訓', kcal: 0 },
  { name: '公路車', kcal: null },
  { name: '跑步', kcal: null },
  { name: '其他', kcal: null },
];

/** 這個項目的消耗已經算在每日目標裡，不用填數字（Strava 匯入的名稱是「重訓・活動名」） */
export function isIncludedInGoal(name: string) {
  const category = name.split('・')[0];
  return EXERCISE_PRESETS.find((p) => p.name === category)?.kcal === 0;
}

/** Strava 的 sport_type 對到 App 的運動類別 */
export function categoryForStrava(sportType: string) {
  if (sportType === 'WeightTraining') return '重訓';
  if (/Ride$/.test(sportType)) return '公路車';
  if (/Run$/.test(sportType)) return '跑步';
  return '其他';
}
