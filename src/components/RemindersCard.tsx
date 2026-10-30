import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import {
  ensurePermission,
  getReminderSettings,
  REMINDERS,
  ReminderKey,
  ReminderSetting,
  ReminderSettings,
  saveReminderSetting,
  scheduleReminders,
} from '@/lib/reminders';
import { useTheme } from './theme';

const pad = (n: number) => String(n).padStart(2, '0');

/** 設定頁的「記錄提醒」：每一餐可開關、改時間，改完馬上重排通知 */
export function RemindersCard() {
  const { colors, ui } = useTheme();
  const db = useSQLiteContext();
  const [settings, setSettings] = useState<ReminderSettings | null>(null);

  useFocusEffect(
    useCallback(() => {
      getReminderSettings(db).then(setSettings);
    }, [db]),
  );

  const apply = async (key: ReminderKey, next: ReminderSetting) => {
    try {
      if (next.enabled && !(await ensurePermission())) {
        Alert.alert('沒有通知權限', '請到手機的「設定 → 應用程式 → 飲食紀錄 → 通知」開啟。');
        return;
      }
      await saveReminderSetting(db, key, next);
      setSettings((s) => (s ? { ...s, [key]: next } : s));
      await scheduleReminders(db);
    } catch (e) {
      Alert.alert('提醒設定失敗', (e as Error).message);
    }
  };

  const pickTime = (key: ReminderKey, current: ReminderSetting) => {
    const [h, m] = current.time.split(':').map(Number);
    DateTimePickerAndroid.open({
      value: new Date(2000, 0, 1, h, m),
      mode: 'time',
      is24Hour: true,
      onValueChange: (_, d) => apply(key, { ...current, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }),
    });
  };

  if (!settings) return null;

  return (
    <View style={ui.card}>
      <Text style={ui.title}>記錄提醒</Text>
      <Text style={ui.muted}>到時間還沒記那一餐才會通知，已經記了就不吵你。</Text>
      {REMINDERS.map((r) => {
        const s = settings[r.key];
        return (
          <View key={r.key} style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={[ui.text, { width: 48 }]}>{r.label}</Text>
            <Pressable
              style={[ui.smallButton, { alignSelf: 'center' }, !s.enabled && { opacity: 0.4 }]}
              onPress={() => pickTime(r.key, s)}
              disabled={!s.enabled}
            >
              <Text style={ui.smallButtonText}>{s.time}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Switch
              value={s.enabled}
              onValueChange={(enabled) => apply(r.key, { ...s, enabled })}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={colors.card}
            />
          </View>
        );
      })}
    </View>
  );
}
