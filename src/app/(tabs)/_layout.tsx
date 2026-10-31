import { router, Tabs } from 'expo-router';
import { PlatformPressable } from 'expo-router/react-navigation';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { getProfile } from '@/lib/profile';

function TabIcon({ glyph }: { glyph: string }) {
  return <Text style={{ fontSize: 18 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const db = useSQLiteContext();

  // 第一次使用（還沒填基本資料）先去填，才有適合自己的目標
  useEffect(() => {
    getProfile(db).then((p) => !p && router.replace('/onboarding'));
  }, [db]);

  return (
    <Tabs
      screenOptions={{
        // 打字時隱藏分頁列，避免被鍵盤頂上來擋住輸入框
        tabBarHideOnKeyboard: true,
        // 點分頁不要水波紋和變淡的效果
        tabBarButton: (props) => (
          <PlatformPressable {...props} android_ripple={{ color: 'transparent' }} pressOpacity={1} />
        ),
      }}
    >
      <Tabs.Screen name="index" options={{ title: '今天', tabBarIcon: () => <TabIcon glyph="🍱" /> }} />
      <Tabs.Screen name="history" options={{ title: '歷史', tabBarIcon: () => <TabIcon glyph="📅" /> }} />
      <Tabs.Screen name="settings" options={{ title: '設定', tabBarIcon: () => <TabIcon glyph="⚙️" /> }} />
    </Tabs>
  );
}
