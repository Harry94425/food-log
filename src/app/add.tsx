import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { colors, ui } from '@/components/theme';
import { insertMeal, MEAL_LABELS, MealType, sumItems, toDateKey } from '@/lib/db';
import { persistPhoto, pickPhoto, PickedPhoto } from '@/lib/photo';
import type { FoodItem } from '@/lib/recognizer/types';
import { getRecognizer } from '@/lib/settings';

type NumField = 'kcal' | 'protein' | 'fat' | 'carbs';
/** 編輯中的數字先存字串，才能輸入「12.」這種中間狀態 */
type DraftItem = Omit<FoodItem, NumField> & Record<NumField, string>;

const NUM_FIELDS: { key: NumField; label: string }[] = [
  { key: 'kcal', label: '熱量' },
  { key: 'protein', label: '蛋白' },
  { key: 'carbs', label: '碳水' },
  { key: 'fat', label: '脂肪' },
];

function defaultMealType(): MealType {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17 && h < 21) return 'dinner';
  return 'snack';
}

const toDraft = (i: FoodItem): DraftItem => ({
  ...i,
  kcal: String(i.kcal),
  protein: String(i.protein),
  fat: String(i.fat),
  carbs: String(i.carbs),
});

const fromDraft = (d: DraftItem): FoodItem => ({
  name: d.name.trim() || '未命名',
  portion: d.portion.trim(),
  kcal: Number(d.kcal) || 0,
  protein: Number(d.protein) || 0,
  fat: Number(d.fat) || 0,
  carbs: Number(d.carbs) || 0,
});

const EMPTY: DraftItem = { name: '', portion: '', kcal: '', protein: '', fat: '', carbs: '' };

export default function AddMealScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = params.date ?? toDateKey();

  const [mealType, setMealType] = useState<MealType>(defaultMealType());
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [hint, setHint] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const choose = async (source: 'camera' | 'library') => {
    try {
      const p = await pickPhoto(source);
      if (p) {
        setPhoto(p);
        recognize(p);
      }
    } catch (e) {
      Alert.alert('無法取得照片', (e as Error).message);
    }
  };

  const recognize = async (p = photo) => {
    if (!p) return;
    setBusy(true);
    setStatus('辨識中…');
    try {
      const recognizer = await getRecognizer(db);
      const r = await recognizer.recognize({
        imageBase64: p.base64,
        mimeType: p.mimeType,
        hint: hint.trim(),
        onStatus: setStatus,
      });
      setItems(r.items.map(toDraft));
      setNote(r.note);
    } catch (e) {
      Alert.alert('辨識失敗', (e as Error).message);
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const update = (idx: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const save = async () => {
    const finalItems = items.map(fromDraft);
    if (!finalItems.length) {
      Alert.alert('沒有食物', '請先辨識照片或手動新增品項。');
      return;
    }
    setBusy(true);
    try {
      const photoUri = photo ? persistPhoto(photo.uri) : null;
      await insertMeal(db, { date, meal_type: mealType, photo_uri: photoUri, note, items: finalItems });
      router.back();
    } catch (e) {
      Alert.alert('儲存失敗', (e as Error).message);
      setBusy(false);
    }
  };

  const totals = sumItems(items.map(fromDraft));

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <View style={ui.row}>
        {(Object.keys(MEAL_LABELS) as MealType[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setMealType(t)}
            style={[
              mealType === t ? ui.button : ui.buttonOutline,
              { flex: 1, paddingHorizontal: 0, paddingVertical: 8 },
            ]}
          >
            <Text style={mealType === t ? ui.buttonText : ui.buttonOutlineText}>{MEAL_LABELS[t]}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={ui.muted}>日期：{date}</Text>

      <View style={ui.row}>
        <Pressable style={[ui.button, { flex: 1 }]} onPress={() => choose('camera')} disabled={busy}>
          <Text style={ui.buttonText}>📷 拍照</Text>
        </Pressable>
        <Pressable style={[ui.buttonOutline, { flex: 1 }]} onPress={() => choose('library')} disabled={busy}>
          <Text style={ui.buttonOutlineText}>🖼 選照片</Text>
        </Pressable>
      </View>

      {photo && <Image source={{ uri: photo.uri }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 12 }} />}

      <TextInput
        style={ui.input}
        value={hint}
        onChangeText={setHint}
        placeholder="補充說明（選填），例如：飯只吃一半、無糖"
      />
      {photo && (
        <Pressable style={ui.buttonOutline} onPress={() => recognize()} disabled={busy}>
          <Text style={ui.buttonOutlineText}>重新辨識</Text>
        </Pressable>
      )}

      {busy && (
        <View style={{ alignItems: 'center', gap: 4 }}>
          <ActivityIndicator size="large" color={colors.primary} />
          {status ? <Text style={ui.muted}>{status}</Text> : null}
        </View>
      )}

      {note ? <Text style={[ui.muted, { color: colors.fat }]}>⚠️ {note}</Text> : null}

      {items.map((it, idx) => (
        <View key={idx} style={ui.card}>
          <View style={ui.row}>
            <TextInput
              style={[ui.input, { flex: 2 }]}
              value={it.name}
              onChangeText={(v) => update(idx, { name: v })}
              placeholder="食物"
            />
            <TextInput
              style={[ui.input, { flex: 2 }]}
              value={it.portion}
              onChangeText={(v) => update(idx, { portion: v })}
              placeholder="份量"
            />
            <Pressable onPress={() => setItems((p) => p.filter((_, i) => i !== idx))} hitSlop={8}>
              <Text style={{ color: colors.danger, fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
          <View style={ui.row}>
            {NUM_FIELDS.map((f) => (
              <View key={f.key} style={{ flex: 1, gap: 2 }}>
                <Text style={ui.muted}>
                  {f.label}
                  {f.key === 'kcal' ? '' : '(g)'}
                </Text>
                <TextInput
                  style={ui.input}
                  value={it[f.key]}
                  onChangeText={(v) => update(idx, { [f.key]: v })}
                  keyboardType="decimal-pad"
                />
              </View>
            ))}
          </View>
        </View>
      ))}

      <Pressable style={ui.buttonOutline} onPress={() => setItems((p) => [...p, EMPTY])}>
        <Text style={ui.buttonOutlineText}>＋ 手動新增品項</Text>
      </Pressable>

      {items.length > 0 && (
        <View style={ui.card}>
          <Text style={ui.title}>這餐合計 {Math.round(totals.kcal)} kcal</Text>
          <Text style={ui.muted}>
            蛋白 {Math.round(totals.protein)}g · 碳水 {Math.round(totals.carbs)}g · 脂肪 {Math.round(totals.fat)}g
          </Text>
        </View>
      )}

      <Pressable style={[ui.button, busy && { opacity: 0.5 }]} onPress={save} disabled={busy}>
        <Text style={ui.buttonText}>儲存</Text>
      </Pressable>
    </ScrollView>
  );
}
