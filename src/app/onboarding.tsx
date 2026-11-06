import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { Input } from '@/components/Input';
import { KeyboardScrollView } from '@/components/KeyboardScrollView';
import { useTheme } from '@/components/theme';
import { getLatestWeight, getWeight, setWeight, toDateKey, Totals } from '@/lib/db';
import {
  Activity,
  ACTIVITY_LABELS,
  bmi,
  bmiLabel,
  formulaGoals,
  GOAL_LABELS,
  GoalType,
  getProfile,
  HEALTHY_BMI,
  Profile,
  saveProfile,
  Sex,
  SEX_LABELS,
  suggestGoals,
  suggestTargetWeight,
  weightForBmi,
} from '@/lib/profile';
import { RecognizerError } from '@/lib/recognizer/types';
import { getApiKey, getSettings, PROVIDERS, saveSettings, setApiKey, Settings } from '@/lib/settings';

const GOAL_FIELDS: { key: keyof Totals; label: string; unit: string }[] = [
  { key: 'kcal', label: '熱量', unit: 'kcal' },
  { key: 'protein', label: '蛋白質', unit: 'g' },
  { key: 'carbs', label: '碳水', unit: 'g' },
  { key: 'fat', label: '脂肪', unit: 'g' },
];

type Draft = {
  sex: Sex | null;
  age: string;
  height: string;
  weight: string;
  goal: GoalType | null;
  activity: Activity | null;
  /** 空白就用依 BMI 建議的目標體重 */
  target: string;
};
type GoalDraft = Record<keyof Totals, string>;

const toGoalDraft = (g: Totals): GoalDraft => ({
  kcal: String(g.kcal),
  protein: String(g.protein),
  fat: String(g.fat),
  carbs: String(g.carbs),
});

/** 第一次使用填基本資料，讓 AI（或公式）設定每日目標；設定頁也能回來重填 */
export default function OnboardingScreen() {
  const { ui } = useTheme();
  const db = useSQLiteContext();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [keyDraft, setKeyDraft] = useState('');
  const [draft, setDraft] = useState<Draft>({
    sex: null,
    age: '',
    height: '',
    weight: '',
    goal: null,
    activity: null,
    target: '',
  });
  const [goals, setGoals] = useState<GoalDraft | null>(null);
  const [reason, setReason] = useState('');
  /** 目前的目標是哪個按鈕算的，那顆按鈕實心顯示 */
  const [method, setMethod] = useState<'ai' | 'formula' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [s, p, latest] = await Promise.all([getSettings(db), getProfile(db), getLatestWeight(db, toDateKey())]);
        setSettings(s);
        setHasKey(!!(await getApiKey(s.provider)));
        if (p) {
          setDraft({
            sex: p.sex,
            age: String(p.age),
            height: String(p.heightCm),
            weight: String(latest ?? p.weightKg),
            goal: p.goal,
            activity: p.activity,
            target: p.targetWeightKg ? String(p.targetWeightKg) : '',
          });
        } else if (latest != null) {
          setDraft((d) => ({ ...d, weight: String(latest) }));
        }
      })();
    }, [db]),
  );

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    // 基本資料改了，舊的建議目標就不準了
    setGoals(null);
    setReason('');
    setMethod(null);
  };

  // 身高體重填好就算 BMI；選了目標就給建議的目標體重
  const heightNum = Number(draft.height);
  const weightNum = Number(draft.weight);
  const bodyOk = heightNum >= 100 && heightNum <= 250 && weightNum >= 25 && weightNum <= 300;
  const suggestedTarget = bodyOk && draft.goal ? suggestTargetWeight(draft.goal, weightNum, heightNum) : null;

  /** 欄位都填好才回傳 Profile，否則提示缺什麼 */
  const toProfile = (): Profile | null => {
    const age = Number(draft.age);
    const heightCm = Number(draft.height);
    const weightKg = Number(draft.weight);
    const missing = [
      !draft.sex && '性別',
      !(age >= 10 && age <= 100) && '年齡',
      !(heightCm >= 100 && heightCm <= 250) && '身高',
      !(weightKg >= 25 && weightKg <= 300) && '體重',
      !draft.goal && '目標',
      !draft.activity && '運動量',
    ].filter(Boolean);
    if (missing.length) {
      Alert.alert('還沒填完', `請確認：${missing.join('、')}`);
      return null;
    }
    const typed = Number(draft.target);
    const targetWeightKg = typed >= 25 && typed <= 300 ? typed : (suggestedTarget ?? undefined);
    return { sex: draft.sex!, age, heightCm, weightKg, goal: draft.goal!, activity: draft.activity!, targetWeightKg };
  };

  const askAi = async () => {
    const p = toProfile();
    if (!p || !settings) return;
    try {
      if (!hasKey) {
        if (!keyDraft.trim()) {
          Alert.alert('需要 API 金鑰', `請先貼上金鑰，或改用公式估算。到 ${PROVIDERS[settings.provider].keyUrl} 可以免費申請。`);
          return;
        }
        await setApiKey(settings.provider, keyDraft.trim());
        setKeyDraft('');
        setHasKey(true);
      }
      setBusy('AI 計算中…');
      const s = await suggestGoals(db, p, setBusy);
      setGoals(toGoalDraft(s));
      setReason(s.reason);
      setMethod('ai');
    } catch (e) {
      const msg = e instanceof RecognizerError ? e.message : (e as Error).message;
      Alert.alert('AI 設定失敗', `${msg}\n\n可以先用公式估算。`);
    } finally {
      setBusy(null);
    }
  };

  const estimateByFormula = () => {
    const p = toProfile();
    if (!p) return;
    setGoals(toGoalDraft(formulaGoals(p)));
    setMethod('formula');
    setReason('用 Mifflin-St Jeor 公式估算每日消耗，再依目標加減熱量；蛋白質依體重計算，脂肪約佔 25% 熱量，其餘給碳水。');
  };

  const finish = async () => {
    const p = toProfile();
    if (!p || !goals || !settings) return;
    const parsed = Object.fromEntries(GOAL_FIELDS.map((f) => [f.key, Math.round(Number(goals[f.key]) || 0)])) as Totals;
    if (!parsed.kcal || !parsed.protein) {
      Alert.alert('目標不完整', '熱量和蛋白質要填數字。');
      return;
    }
    await saveProfile(db, p);
    await saveSettings(db, { ...settings, goals: parsed });
    // 順便記下今天的體重
    const today = toDateKey();
    if ((await getWeight(db, today)) == null) await setWeight(db, today, p.weightKg);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const chip = (selected: boolean, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      style={[selected ? ui.button : ui.buttonOutline, { paddingVertical: 8, paddingHorizontal: 12, flexGrow: 1 }]}
    >
      <Text style={[selected ? ui.buttonText : ui.buttonOutlineText, { fontSize: 14 }]}>{label}</Text>
    </Pressable>
  );

  const numberField = (label: string, unit: string, key: 'age' | 'height' | 'weight') => (
    <View style={ui.row}>
      <Text style={[ui.text, { width: 48 }]}>{label}</Text>
      <Input
        style={{ flex: 1 }}
        value={draft[key]}
        onChangeText={(v) => set(key, v)}
        keyboardType="decimal-pad"
        placeholder={unit}
      />
      <Text style={[ui.muted, { width: 28 }]}>{unit}</Text>
    </View>
  );

  return (
    <KeyboardScrollView style={ui.screen} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <View style={ui.card}>
        <Text style={ui.title}>基本資料</Text>
        <Text style={ui.muted}>用來設定每天要吃多少；只存在這支手機裡。</Text>
        <View style={ui.row}>
          <Text style={[ui.text, { width: 48 }]}>性別</Text>
          {(Object.keys(SEX_LABELS) as Sex[]).map((s) => chip(draft.sex === s, SEX_LABELS[s], () => set('sex', s)))}
        </View>
        {numberField('年齡', '歲', 'age')}
        {numberField('身高', 'cm', 'height')}
        {numberField('體重', 'kg', 'weight')}
        <Text style={ui.text}>目標</Text>
        <View style={ui.row}>
          {(Object.keys(GOAL_LABELS) as GoalType[]).map((g) => chip(draft.goal === g, GOAL_LABELS[g], () => set('goal', g)))}
        </View>
        {bodyOk && (
          <Text style={ui.muted}>
            BMI {bmi(weightNum, heightNum).toFixed(1)}（{bmiLabel(bmi(weightNum, heightNum))}）· 健康範圍{' '}
            {weightForBmi(HEALTHY_BMI[0], heightNum).toFixed(1)}–{weightForBmi(HEALTHY_BMI[1], heightNum).toFixed(1)} kg
          </Text>
        )}
        {suggestedTarget != null && (
          <View style={ui.row}>
            <Text style={[ui.text, { width: 72 }]}>目標體重</Text>
            <Input
              style={{ flex: 1 }}
              value={draft.target}
              onChangeText={(v) => set('target', v)}
              keyboardType="decimal-pad"
              placeholder={`建議 ${suggestedTarget}`}
            />
            <Text style={[ui.muted, { width: 28 }]}>kg</Text>
          </View>
        )}
        <Text style={ui.text}>運動量（重訓、球類等）</Text>
        <View style={[ui.row, { flexWrap: 'wrap' }]}>
          {(Object.keys(ACTIVITY_LABELS) as Activity[]).map((a) =>
            chip(draft.activity === a, ACTIVITY_LABELS[a], () => set('activity', a)),
          )}
        </View>
        <Text style={ui.muted}>騎車、跑步等連結 Strava 自動記錄的運動不用算，App 每天會另外加進目標。</Text>
      </View>

      <View style={ui.card}>
        <Text style={ui.title}>設定每日目標</Text>
        {!hasKey && settings && (
          <>
            <Text style={ui.muted}>
              讓 AI 設定需要 {PROVIDERS[settings.provider].label} 金鑰，到 {PROVIDERS[settings.provider].keyUrl}{' '}
              免費申請；之後拍照辨識也會用到。
            </Text>
            <Input
              value={keyDraft}
              onChangeText={setKeyDraft}
              placeholder="貼上 API 金鑰"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        )}
        <View style={ui.row}>
          {(
            [
              ['ai', 'AI 設定目標', askAi],
              ['formula', '用公式估算', estimateByFormula],
            ] as const
          ).map(([key, label, onPress]) => {
            const selected = method === key;
            return (
              <Pressable
                key={key}
                style={({ pressed }) => [
                  selected ? ui.button : ui.buttonOutline,
                  { flex: 1 },
                  (pressed || !!busy) && { opacity: 0.6 },
                ]}
                onPress={onPress}
                disabled={!!busy}
              >
                <Text style={selected ? ui.buttonText : ui.buttonOutlineText}>
                  {selected ? '✓ ' : ''}
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {busy && (
          <View style={ui.row}>
            <ActivityIndicator />
            <Text style={ui.muted}>{busy}</Text>
          </View>
        )}
        {goals && (
          <>
            {GOAL_FIELDS.map((f) => (
              <View key={f.key} style={ui.row}>
                <Text style={[ui.text, { width: 60 }]}>{f.label}</Text>
                <Input
                  style={{ flex: 1 }}
                  value={goals[f.key]}
                  onChangeText={(v) => setGoals((g) => (g ? { ...g, [f.key]: v } : g))}
                  keyboardType="numeric"
                />
                <Text style={[ui.muted, { width: 36 }]}>{f.unit}</Text>
              </View>
            ))}
            {!!reason && <Text style={ui.muted}>{reason}</Text>}
            <Text style={ui.muted}>數字可以自己再調整，之後也能到設定頁改。</Text>
          </>
        )}
      </View>

      <Pressable style={[ui.button, !goals && { opacity: 0.4 }]} onPress={finish} disabled={!goals || !!busy}>
        <Text style={ui.buttonText}>完成</Text>
      </Pressable>
    </KeyboardScrollView>
  );
}
