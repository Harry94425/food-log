import { Tabs } from 'expo-router';
import { Text } from 'react-native';

function TabIcon({ glyph }: { glyph: string }) {
  return <Text style={{ fontSize: 18 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: '今天', tabBarIcon: () => <TabIcon glyph="🍱" /> }} />
      <Tabs.Screen name="history" options={{ title: '歷史', tabBarIcon: () => <TabIcon glyph="📅" /> }} />
      <Tabs.Screen name="settings" options={{ title: '設定', tabBarIcon: () => <TabIcon glyph="⚙️" /> }} />
    </Tabs>
  );
}
