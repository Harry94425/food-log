import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { scheduleReminders } from '@/lib/reminders';

/**
 * 掛在根目錄、不顯示任何東西：
 * - 打開 App／回到前景時重排提醒（排程只排未來 14 天，要一直往後補）
 * - 點通知就打開新增餐點，餐別帶通知的那一餐
 */
export function ReminderSync() {
  const db = useSQLiteContext();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  // 冷啟動時導覽還沒準備好就 push 會失敗，等它好了再處理
  const navReady = !!useRootNavigationState()?.key;

  useEffect(() => {
    const sync = () => scheduleReminders(db).catch(() => {});
    sync();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && sync());
    return () => sub.remove();
  }, [db]);

  useEffect(() => {
    if (!response || !navReady) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const mealType = response.notification.request.content.data?.mealType;
    if (typeof mealType === 'string') router.push({ pathname: '/add', params: { mealType } });
  }, [response, navReady]);

  return null;
}
