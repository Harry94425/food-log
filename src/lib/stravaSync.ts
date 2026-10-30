import type { SQLiteDatabase } from 'expo-sqlite';
import { getStravaIds, importStravaExercise } from './db';
import { categoryForStrava, isIncludedInGoal } from './exercise';
import { connectedAthlete, getActivity, listActivitiesSince } from './strava';

export const SYNC_DAYS = 30;
/** 自動同步（打開「今天」頁）最短間隔 */
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;

let lastSyncAt = 0;
let running: Promise<number> | null = null;

/**
 * 匯入最近 SYNC_DAYS 天還沒匯入過的 Strava 活動，回傳新增幾筆。
 * 重訓記 0 kcal（每日目標已含），其他用 Strava 的熱量。
 */
export function syncStrava(db: SQLiteDatabase): Promise<number> {
  // 同時只跑一次，避免設定頁和今天頁一起觸發時重複呼叫 API
  running ??= doSync(db).finally(() => {
    running = null;
  });
  return running;
}

async function doSync(db: SQLiteDatabase) {
  if (!(await connectedAthlete())) return 0;
  const after = Math.floor(Date.now() / 1000) - SYNC_DAYS * 86400;
  const [list, known] = await Promise.all([listActivitiesSince(after), getStravaIds(db)]);

  let added = 0;
  for (const s of list) {
    if (known.has(s.id)) continue;
    const a = await getActivity(s.id);
    const name = `${categoryForStrava(a.sport_type)}・${a.name}`;
    await importStravaExercise(db, {
      stravaId: a.id,
      date: a.date,
      name,
      kcal: isIncludedInGoal(name) ? 0 : a.kcal,
    });
    added++;
  }
  lastSyncAt = Date.now();
  return added;
}

/** 距離上次同步夠久才同步；失敗不吵使用者 */
export async function autoSyncStrava(db: SQLiteDatabase) {
  if (Date.now() - lastSyncAt < AUTO_SYNC_INTERVAL_MS) return 0;
  try {
    return await syncStrava(db);
  } catch {
    lastSyncAt = Date.now();
    return 0;
  }
}
