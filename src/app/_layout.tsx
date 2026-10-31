import { NavigationBar } from 'expo-navigation-bar';
import { Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { ReminderSync } from '@/components/ReminderSync';
import { useTheme } from '@/components/theme';
import { DB_NAME, migrateDbIfNeeded } from '@/lib/db';

export default function RootLayout() {
  const { nav, dark, colors } = useTheme();

  // App 開著時切換深色模式，Android 不會重建畫面，最上、最下的系統列要自己跟著換
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg);
  }, [colors.bg]);

  return (
    // 主題要包在 SQLiteProvider 外面：它的 memo 不比對 children，包在裡面的話切換深淺色時標題列、分頁列不會更新
    <ThemeProvider value={nav}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <NavigationBar style={dark ? 'light' : 'dark'} />
      <SQLiteProvider databaseName={DB_NAME} onInit={migrateDbIfNeeded}>
        <ReminderSync />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="add" options={{ title: '新增餐點', presentation: 'modal' }} />
          <Stack.Screen name="day/[date]" options={{ title: '當日紀錄' }} />
          <Stack.Screen name="strava-connect" options={{ title: '連結 Strava', presentation: 'modal' }} />
        </Stack>
      </SQLiteProvider>
    </ThemeProvider>
  );
}
