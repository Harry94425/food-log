import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ui } from '@/components/theme';
import { exportCsv, toDateKey, Totals } from '@/lib/db';
import {
  DEFAULT_GOALS,
  getApiKey,
  getSettings,
  Provider,
  PROVIDERS,
  saveSettings,
  setApiKey,
} from '@/lib/settings';

const PROVIDER_KEYS = Object.keys(PROVIDERS) as Provider[];
const defaultModels = () =>
  Object.fromEntries(PROVIDER_KEYS.map((p) => [p, PROVIDERS[p].defaultModel])) as Record<Provider, string>;

const GOAL_FIELDS: { key: keyof Totals; label: string; unit: string }[] = [
  { key: 'kcal', label: '熱量', unit: 'kcal' },
  { key: 'protein', label: '蛋白質', unit: 'g' },
  { key: 'carbs', label: '碳水', unit: 'g' },
  { key: 'fat', label: '脂肪', unit: 'g' },
];

type GoalDraft = Record<keyof Totals, string>;
const toDraft = (g: Totals): GoalDraft => ({
  kcal: String(g.kcal),
  protein: String(g.protein),
  fat: String(g.fat),
  carbs: String(g.carbs),
});

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [provider, setProvider] = useState<Provider>('gemini');
  const [models, setModels] = useState(defaultModels);
  const [keyDraft, setKeyDraft] = useState('');
  const [hasKey, setHasKey] = useState<Record<Provider, boolean>>({ gemini: false, openai: false });
  const [goals, setGoals] = useState<GoalDraft>(toDraft(DEFAULT_GOALS));

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [s, ...keys] = await Promise.all([getSettings(db), ...PROVIDER_KEYS.map(getApiKey)]);
        setProvider(s.provider);
        setModels(s.models);
        setHasKey(Object.fromEntries(PROVIDER_KEYS.map((p, i) => [p, !!keys[i]])) as Record<Provider, boolean>);
        setGoals(toDraft(s.goals));
      })();
    }, [db]),
  );

  const save = async () => {
    const parsed = Object.fromEntries(
      GOAL_FIELDS.map((f) => [f.key, Number(goals[f.key]) || DEFAULT_GOALS[f.key]]),
    ) as Totals;
    const cleanModels = Object.fromEntries(
      PROVIDER_KEYS.map((p) => [p, models[p].trim() || PROVIDERS[p].defaultModel]),
    ) as Record<Provider, string>;
    await saveSettings(db, { provider, models: cleanModels, goals: parsed });
    if (keyDraft.trim()) {
      await setApiKey(provider, keyDraft.trim());
      setKeyDraft('');
      setHasKey((h) => ({ ...h, [provider]: true }));
    }
    setModels(cleanModels);
    setGoals(toDraft(parsed));
    Alert.alert('已儲存');
  };

  const removeKey = async () => {
    await setApiKey(provider, '');
    setHasKey((h) => ({ ...h, [provider]: false }));
  };

  const switchProvider = (p: Provider) => {
    setProvider(p);
    setKeyDraft('');
  };

  const onExport = async () => {
    try {
      const file = new File(Paths.cache, `飲食紀錄-${toDateKey()}.csv`);
      if (file.exists) file.delete();
      file.create();
      file.write(await exportCsv(db));
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (e) {
      Alert.alert('匯出失敗', (e as Error).message);
    }
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <View style={ui.card}>
        <Text style={ui.title}>AI 辨識</Text>
        <View style={ui.row}>
          {PROVIDER_KEYS.map((p) => (
            <Pressable
              key={p}
              onPress={() => switchProvider(p)}
              style={[provider === p ? ui.button : ui.buttonOutline, { flex: 1, paddingVertical: 8 }]}
            >
              <Text style={provider === p ? ui.buttonText : ui.buttonOutlineText}>{PROVIDERS[p].label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={ui.muted}>
          {hasKey[provider]
            ? '✅ 已設定金鑰（存在手機加密區）'
            : `尚未設定。到 ${PROVIDERS[provider].keyUrl} 取得金鑰。`}
        </Text>
        <TextInput
          style={ui.input}
          value={keyDraft}
          onChangeText={setKeyDraft}
          placeholder={hasKey[provider] ? '輸入新金鑰以更換' : '貼上 API 金鑰'}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        {hasKey[provider] && (
          <Pressable onPress={removeKey}>
            <Text style={ui.muted}>移除金鑰</Text>
          </Pressable>
        )}
        <Text style={ui.muted}>模型</Text>
        <TextInput
          style={ui.input}
          value={models[provider]}
          onChangeText={(v) => setModels((m) => ({ ...m, [provider]: v }))}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={ui.muted}>選好之後按下方「儲存設定」，之後辨識就會用這個。</Text>
      </View>

      <View style={ui.card}>
        <Text style={ui.title}>每日目標（不含運動）</Text>
        <Text style={ui.muted}>運動日會自動加上消耗熱量，並用碳水補足。</Text>
        {GOAL_FIELDS.map((f) => (
          <View key={f.key} style={ui.row}>
            <Text style={[ui.text, { width: 60 }]}>{f.label}</Text>
            <TextInput
              style={[ui.input, { flex: 1 }]}
              value={goals[f.key]}
              onChangeText={(v) => setGoals((g) => ({ ...g, [f.key]: v }))}
              keyboardType="numeric"
            />
            <Text style={[ui.muted, { width: 36 }]}>{f.unit}</Text>
          </View>
        ))}
        <Pressable onPress={() => setGoals(toDraft(DEFAULT_GOALS))}>
          <Text style={ui.muted}>恢復預設（增肌：2350 kcal / 蛋白 90g）</Text>
        </Pressable>
      </View>

      <Pressable style={ui.button} onPress={save}>
        <Text style={ui.buttonText}>儲存設定</Text>
      </Pressable>

      <Pressable style={ui.buttonOutline} onPress={onExport}>
        <Text style={ui.buttonOutlineText}>匯出 CSV 備份</Text>
      </Pressable>
    </ScrollView>
  );
}
