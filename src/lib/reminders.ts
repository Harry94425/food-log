import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { MealType, toDateKey } from './db';

export type ReminderKey = 'lunch' | 'dinner';

export type Reminder = {
  key: ReminderKey;
  mealType: MealType;
  label: string;
  title: string;
  body: string;
  /** 預設時間 HH:MM */
  defaultTime: string;
};

export const REMINDERS: Reminder[] = [
  {
    key: 'lunch',
    mealType: 'lunch',
    label: '午餐',
    title: '午餐記了嗎？',
    body: '點一下記錄午餐，今天的熱量和蛋白質才算得準',
    defaultTime: '13:30',
  },
  {
    key: 'dinner',
    mealType: 'dinner',
    label: '晚餐',
    title: '晚餐記了嗎？',
    body: '點一下記錄晚餐，看看今天吃夠了沒',
    defaultTime: '20:30',
  },
];

export type ReminderSetting = { enabled: boolean; time: string };
export type ReminderSettings = Record<ReminderKey, ReminderSetting>;

const CHANNEL = 'reminders';
const ID_PREFIX = 'reminder-';
/** 一次排未來幾天；每次打開 App 或存餐點都會重排 */
const DAYS_AHEAD = 14;

/** 前景收到通知也要顯示 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function getReminderSettings(db: SQLiteDatabase): Promise<ReminderSettings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key LIKE 'reminder_%'",
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    REMINDERS.map((r) => [
      r.key,
      { enabled: map[`reminder_${r.key}_enabled`] === '1', time: map[`reminder_${r.key}_time`] || r.defaultTime },
    ]),
  ) as ReminderSettings;
}

export async function saveReminderSetting(db: SQLiteDatabase, key: ReminderKey, s: ReminderSetting) {
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?), (?, ?)',
    `reminder_${key}_enabled`,
    s.enabled ? '1' : '0',
    `reminder_${key}_time`,
    s.time,
  );
}

/** 自訂的「記錄提醒」通知頻道建好了沒；建不起來就用預設頻道 */
let channelReady: boolean | null = null;

async function ensureChannel() {
  if (channelReady !== null) return channelReady;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: '記錄提醒',
      // 有匯出，只是 lint 追不到 expo-notifications 的巢狀 export *
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.HIGH,
    });
    channelReady = true;
  } catch {
    // Expo Go 內建的通知模組建自訂頻道會當掉（正式 APK 正常），改用預設頻道
    channelReady = false;
  }
  return channelReady;
}

/** 開提醒前要通知權限；Android 13 以上會跳出系統詢問 */
export async function ensurePermission() {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * 重新排接下來 DAYS_AHEAD 天的提醒。
 * 今天已經記過那一餐就不提醒；所以存餐點、刪餐點後都要再排一次。
 */
export async function scheduleReminders(db: SQLiteDatabase) {
  const settings = await getReminderSettings(db);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  const enabled = REMINDERS.filter((r) => settings[r.key].enabled);
  if (enabled.length === 0) return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;

  const today = toDateKey();
  const loggedToday = new Set(
    (await db.getAllAsync<{ meal_type: MealType }>('SELECT DISTINCT meal_type FROM meals WHERE date = ?', today)).map(
      (r) => r.meal_type,
    ),
  );

  const channelId = (await ensureChannel()) ? CHANNEL : undefined;
  const now = Date.now();
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const day = new Date();
    day.setDate(day.getDate() + i);
    const dateKey = toDateKey(day);
    for (const r of enabled) {
      if (dateKey === today && loggedToday.has(r.mealType)) continue;
      const [h, m] = settings[r.key].time.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (at.getTime() <= now) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${r.key}-${dateKey}`,
        content: { title: r.title, body: r.body, data: { mealType: r.mealType } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId },
      });
    }
  }
}
