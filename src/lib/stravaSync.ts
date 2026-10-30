import type { SQLiteDatabase } from 'expo-sqlite';
import {
  fromDateKey,
  getStravaIds,
  importStravaExercise,
  latestStravaDate,
  removeStravaExercisesNotIn,
  toDateKey,
  updateStravaExercise,
} from './db';
import { categoryForStrava, isIncludedInGoal } from './exercise';
import { connectedAthlete, getActivity, listActivitiesSince } from './strava';

/** 第一次連結時往回抓幾天（不抓全部歷史） */
export const FIRST_IMPORT_DAYS = 7;
/**
 * 之後每次從「最後一筆已匯入活動的日期」往回這麼多天開始抓：
 * 不管多久沒開 App，新活動都會補齊；晚上傳的舊活動、改名、刪除也能在這段期間內跟上。
 */
const OVERLAP_DAYS = 14;
/** 自動同步（打開「今天」頁）最短間隔 */
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;

export type SyncResult = { added: number; removed: number };

let lastSyncAt = 0;
let running: Promise<SyncResult> | null = null;

const activityName = (sportType: string, name: string) => `${categoryForStrava(sportType)}・${name}`;

/**
 * 讓運動紀錄和 Strava 一致：新活動匯入、改名或改日期跟著改、
 * Strava 上刪掉的這邊也刪。重訓記 0 kcal（每日目標已含），其他用 Strava 的熱量。
 */
export function syncStrava(db: SQLiteDatabase): Promise<SyncResult> {
  // 同時只跑一次，避免設定頁和今天頁一起觸發時重複呼叫 API
  running ??= doSync(db).finally(() => {
    running = null;
  });
  return running;
}

async function doSync(db: SQLiteDatabase): Promise<SyncResult> {
  if (!(await connectedAthlete())) return { added: 0, removed: 0 };
  const latest = await latestStravaDate(db);
  const after = latest
    ? Math.floor(fromDateKey(latest).getTime() / 1000) - OVERLAP_DAYS * 86400
    : Math.floor(Date.now() / 1000) - FIRST_IMPORT_DAYS * 86400;
  const [list, known] = await Promise.all([listActivitiesSince(after), getStravaIds(db)]);

  let added = 0;
  for (const s of list) {
    const name = activityName(s.sport_type, s.name);
    if (known.has(s.id)) {
      // 列表就有名稱和日期，不用再查詳細資料
      await updateStravaExercise(db, s.id, s.start_date_local.slice(0, 10), name);
      continue;
    }
    const a = await getActivity(s.id);
    await importStravaExercise(db, {
      stravaId: a.id,
      date: a.date,
      name,
      kcal: isIncludedInGoal(name) ? 0 : a.kcal,
    });
    added++;
  }

  // 起始那天的活動可能早於 after 而不在列表裡，所以只清掉之後的日子
  const before = known.size;
  await removeStravaExercisesNotIn(
    db,
    toDateKey(new Date(after * 1000)),
    list.map((s) => s.id),
  );
  const removed = before + added - (await getStravaIds(db)).size;

  lastSyncAt = Date.now();
  return { added, removed };
}

/** 距離上次同步夠久才同步；失敗不吵使用者。回傳是否有變動 */
export async function autoSyncStrava(db: SQLiteDatabase) {
  if (Date.now() - lastSyncAt < AUTO_SYNC_INTERVAL_MS) return false;
  try {
    const r = await syncStrava(db);
    return r.added + r.removed > 0;
  } catch {
    lastSyncAt = Date.now();
    return false;
  }
}
