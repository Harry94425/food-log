import { File } from 'expo-file-system';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text, TextInput, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { KeyboardScrollView } from '@/components/KeyboardScrollView';
import { colors, ui } from '@/components/theme';
import {
  getMeal,
  insertMeal,
  MEAL_LABELS,
  MealType,
  PastMeal,
  searchPastMeals,
  sumItems,
  toDateKey,
  updateMeal,
} from '@/lib/db';
import { deletePhoto, persistPhoto, pickPhoto, PickedPhoto } from '@/lib/photo';
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

/** 依現在時間預設餐別：[開始小時, 結束小時(不含), 餐別]，其他時間算宵夜 */
const MEAL_HOURS: [number, number, MealType][] = [
  [5, 11, 'breakfast'], // 05:00–10:59
  [11, 14, 'lunch'], // 11:00–13:59
  [14, 17, 'snack'], // 14:00–16:59
  [17, 21, 'dinner'], // 17:00–20:59
];

function defaultMealType(): MealType {
  const h = new Date().getHours();
  return MEAL_HOURS.find(([start, end]) => h >= start && h < end)?.[2] ?? 'late_night';
}

const toDraft = (i: FoodItem): DraftItem => ({
  name: i.name,
  portion: i.portion,
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

/** 新增或編輯餐點；帶 id 參數時是編輯 */
export default function MealEditorScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ date?: string; id?: string }>();
  const editId = params.id ? Number(params.id) : null;

  const [date, setDate] = useState(params.date ?? toDateKey());
  const [mealType, setMealType] = useState<MealType>(defaultMealType());
  const [title, setTitle] = useState('');
  const [store, setStore] = useState('');
  const [price, setPrice] = useState('');
  const [pastQuery, setPastQuery] = useState('');
  const [pastMeals, setPastMeals] = useState<PastMeal[]>([]);
  /** 已存在資料庫裡的照片（編輯時） */
  const [savedPhotoUri, setSavedPhotoUri] = useState<string | null>(null);
  /** 這次新拍或新選的照片 */
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [hint, setHint] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(editId == null);

  useEffect(() => {
    if (editId == null) return;
    (async () => {
      const meal = await getMeal(db, editId);
      if (!meal) {
        Alert.alert('找不到這筆紀錄');
        router.back();
        return;
      }
      setDate(meal.date);
      setMealType(meal.meal_type);
      setTitle(meal.title);
      setStore(meal.store);
      setPrice(meal.price != null ? String(meal.price) : '');
      setSavedPhotoUri(meal.photo_uri);
      setNote(meal.note);
      setItems(meal.items.map(toDraft));
      setLoaded(true);
    })();
  }, [db, editId]);

  // 新增時列出吃過的餐點，可直接帶入省掉辨識
  const showPast = editId == null && items.length === 0;
  useEffect(() => {
    if (!showPast) return;
    searchPastMeals(db, pastQuery).then(setPastMeals);
  }, [db, pastQuery, showPast]);

  const applyPast = async (id: number) => {
    const meal = await getMeal(db, id);
    if (!meal) return;
    setTitle(meal.title);
    setStore(meal.store);
    setPrice(meal.price != null ? String(meal.price) : '');
    setItems(meal.items.map(toDraft));
    setNote('');
  };

  const photoUri = photo?.uri ?? savedPhotoUri;

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

  const recognize = async (p: PickedPhoto | null = photo) => {
    let input = p;
    // 編輯舊紀錄時，用已存的照片重新辨識
    if (!input && savedPhotoUri) {
      try {
        input = { uri: savedPhotoUri, base64: await new File(savedPhotoUri).base64(), mimeType: 'image/jpeg' };
      } catch {
        Alert.alert('讀不到原本的照片');
        return;
      }
    }
    if (!input) return;

    setBusy(true);
    setStatus('辨識中…');
    try {
      const recognizer = await getRecognizer(db);
      const r = await recognizer.recognize({
        imageBase64: input.base64,
        mimeType: input.mimeType,
        hint: hint.trim(),
        onStatus: setStatus,
      });
      setTitle(r.title);
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
    const priceNum = price.trim() === '' ? null : Number(price);
    if (priceNum != null && !(priceNum >= 0)) {
      Alert.alert('價錢格式不對', '請輸入數字，或留空。');
      return;
    }
    setBusy(true);
    try {
      const newPhotoUri = photo ? persistPhoto(photo.uri) : savedPhotoUri;
      const meal = {
        date,
        meal_type: mealType,
        title: title.trim(),
        store: store.trim(),
        price: priceNum,
        photo_uri: newPhotoUri,
        note,
        items: finalItems,
      };
      if (editId != null) {
        await updateMeal(db, editId, meal);
        // 換了新照片才刪舊的
        if (photo && savedPhotoUri) deletePhoto(savedPhotoUri);
      } else {
        await insertMeal(db, meal);
      }
      router.back();
    } catch (e) {
      Alert.alert('儲存失敗', (e as Error).message);
      setBusy(false);
    }
  };

  const totals = sumItems(items.map(fromDraft));

  if (!loaded) return <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.primary} />;

  return (
    <KeyboardScrollView style={ui.screen} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: editId != null ? '編輯餐點' : '新增餐點' }} />

      <View style={[ui.row, { flexWrap: 'wrap' }]}>
        {(Object.keys(MEAL_LABELS) as MealType[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setMealType(t)}
            style={[
              mealType === t ? ui.button : ui.buttonOutline,
              // 一排三個
              { flexBasis: '30%', flexGrow: 1, paddingHorizontal: 0, paddingVertical: 8 },
            ]}
          >
            <Text style={mealType === t ? ui.buttonText : ui.buttonOutlineText}>{MEAL_LABELS[t]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={ui.row}>
        <Text style={ui.muted}>日期</Text>
        <DateField value={date} onChange={setDate} />
      </View>

      {showPast && (
        <View style={ui.card}>
          <Text style={ui.title}>吃過一樣的？直接帶入</Text>
          <TextInput
            style={ui.input}
            value={pastQuery}
            onChangeText={setPastQuery}
            placeholder="搜尋店家或餐點名稱"
            autoCorrect={false}
          />
          {pastMeals.length === 0 && (
            <Text style={ui.muted}>{pastQuery ? '找不到符合的紀錄。' : '還沒有紀錄，存過的餐點會出現在這裡。'}</Text>
          )}
          {pastMeals.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => applyPast(m.id)}
              style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}
            >
              <Text style={ui.text}>
                {m.store ? <Text style={ui.muted}>{m.store}・</Text> : null}
                {m.title}
              </Text>
              <Text style={ui.muted}>
                {Math.round(m.kcal)} kcal{m.price != null ? ` · $${m.price}` : ''} · 吃過 {m.times} 次
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <TextInput
        style={ui.input}
        value={hint}
        onChangeText={setHint}
        placeholder="給 AI 的補充說明（選填），例如：飯只吃一半、無糖、大份"
      />
      <View style={ui.row}>
        <Pressable style={[ui.button, { flex: 1 }]} onPress={() => choose('camera')} disabled={busy}>
          <Text style={ui.buttonText}>📷 {photoUri ? '重拍' : '拍照'}</Text>
        </Pressable>
        <Pressable style={[ui.buttonOutline, { flex: 1 }]} onPress={() => choose('library')} disabled={busy}>
          <Text style={ui.buttonOutlineText}>🖼 選照片</Text>
        </Pressable>
      </View>

      {photoUri && <Image source={{ uri: photoUri }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 12 }} />}

      {photoUri && (
        <Pressable style={ui.buttonOutline} onPress={() => recognize()} disabled={busy}>
          <Text style={ui.buttonOutlineText}>重新辨識（會套用上面的補充說明）</Text>
        </Pressable>
      )}

      {busy && (
        <View style={{ alignItems: 'center', gap: 4 }}>
          <ActivityIndicator size="large" color={colors.primary} />
          {status ? <Text style={ui.muted}>{status}</Text> : null}
        </View>
      )}

      {note ? <Text style={[ui.muted, { color: colors.fat }]}>⚠️ {note}</Text> : null}

      <View style={ui.card}>
        <Text style={ui.muted}>餐點名稱</Text>
        <TextInput style={ui.input} value={title} onChangeText={setTitle} placeholder="例如：豬排咖哩飯" />
        <Text style={ui.muted}>店家（選填）</Text>
        <TextInput style={ui.input} value={store} onChangeText={setStore} placeholder="例如：學餐二樓、7-11" />
        <Text style={ui.muted}>價錢（元，選填）</Text>
        <TextInput
          style={ui.input}
          value={price}
          onChangeText={setPrice}
          placeholder="例如 120"
          keyboardType="numeric"
        />
      </View>

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
        <Text style={ui.buttonText}>{editId != null ? '儲存修改' : '儲存'}</Text>
      </Pressable>
    </KeyboardScrollView>
  );
}
