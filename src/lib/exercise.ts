/** 運動紀錄的名稱是「類別・Strava 活動名」，例如「公路車・蕃薯」 */
const STRENGTH = '重訓';

/**
 * 重訓記 0 kcal：每日目標用的活動係數 1.375 已經包含每週 2–3 次重訓，
 * 再加會重複計算。記錄只是為了知道哪天有練。
 */
export function isIncludedInGoal(name: string) {
  return name.split('・')[0] === STRENGTH;
}

/** Strava 的 sport_type 對到 App 的運動類別 */
export function categoryForStrava(sportType: string) {
  if (sportType === 'WeightTraining') return STRENGTH;
  if (/Ride$/.test(sportType)) return '公路車';
  if (/Run$/.test(sportType)) return '跑步';
  return '其他';
}
