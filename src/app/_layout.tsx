import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { DB_NAME, migrateDbIfNeeded } from '@/lib/db';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={migrateDbIfNeeded}>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add" options={{ title: '新增餐點', presentation: 'modal' }} />
        <Stack.Screen name="day/[date]" options={{ title: '當日紀錄' }} />
      </Stack>
    </SQLiteProvider>
  );
}
