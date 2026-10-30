import { Tabs } from 'expo-router';
import { Text } from 'react-native';

const icon = (glyph: string) => () => <Text style={{ fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: '今天', tabBarIcon: icon('🍱') }} />
      <Tabs.Screen name="history" options={{ title: '歷史', tabBarIcon: icon('📅') }} />
      <Tabs.Screen name="settings" options={{ title: '設定', tabBarIcon: icon('⚙️') }} />
    </Tabs>
  );
}
