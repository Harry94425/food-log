import { Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { ReminderSync } from '@/components/ReminderSync';
import { useTheme } from '@/components/theme';
import { DB_NAME, migrateDbIfNeeded } from '@/lib/db';

export default function RootLayout() {
  const { nav, dark } = useTheme();
  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={migrateDbIfNeeded}>
      {/* 標題列、分頁列跟著深色／淺色模式 */}
      <ThemeProvider value={nav}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <ReminderSync />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="add" options={{ title: '新增餐點', presentation: 'modal' }} />
          <Stack.Screen name="day/[date]" options={{ title: '當日紀錄' }} />
          <Stack.Screen name="strava-connect" options={{ title: '連結 Strava', presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </SQLiteProvider>
  );
}
