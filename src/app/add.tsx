import { File } from 'expo-file-system';
import { router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text, TextInput, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { DraftItem, emptyItem, fromDraft, ItemEditor, toDraft } from '@/components/ItemEditor';
import { KeyboardScrollView } from '@/components/KeyboardScrollView';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { LabelCard } from '@/components/LabelCard';
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
import { getSavedProduct, lookupOpenFoodFacts, saveProduct } from '@/lib/products';
import { LABEL_TASK, MEAL_TASK } from '@/lib/recognizer/tasks';
import type { FoodItem, LabelRecognition } from '@/lib/recognizer/types';
import { getRecognizer } from '@/lib/settings';

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

type Snapshot = {
  date: string;
  mealType: MealType;
  title: string;
  store: string;
  price: string;
  photo: string | null;
  items: FoodItem[];
};
/** 比對用：內容一樣就是沒有改過 */
const snap = (s: Snapshot) => JSON.stringify(s);

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
  /** 掃完營養標示、還沒決定吃幾份 */
  const [label, setLabel] = useState<LabelRecognition | null>(null);
  const [scanning, setScanning] = useState(false);
  const [hint, setHint] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(editId == null);
  /** 剛打開時的內容；新增是空白，編輯是讀進來的那筆 */
  const [initial, setInitial] = useState<string | null>(() =>
    editId == null ? snap({ date, mealType, title: '', store: '', price: '', photo: null, items: [] }) : null,
  );

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
      setItems(meal.items.map((i) => toDraft(i)));
      setInitial(
        snap({
          date: meal.date,
          mealType: meal.meal_type,
          title: meal.title,
          store: meal.store,
          price: meal.price != null ? String(meal.price) : '',
          photo: meal.photo_uri,
          items: meal.items.map((i) => fromDraft(toDraft(i))),
        }),
      );
      setLoaded(true);
    })();
  }, [db, editId]);

  // 新增時可搜尋吃過的餐點直接帶入，省掉辨識；沒輸入就不列
  const showPast = editId == null && items.length === 0;
  const searching = pastQuery.trim() !== '';
  useEffect(() => {
    if (!showPast || !searching) return;
    let alive = true;
    searchPastMeals(db, pastQuery, 5).then((r) => alive && setPastMeals(r));
    return () => {
      alive = false;
    };
  }, [db, pastQuery, showPast, searching]);
  const pastResults = searching ? pastMeals : [];

  const applyPast = async (id: number) => {
    const meal = await getMeal(db, id);
    if (!meal) return;
    setTitle(meal.title);
    setStore(meal.store);
    setPrice(meal.price != null ? String(meal.price) : '');
    setItems(meal.items.map((i) => toDraft(i)));
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
      const r = await recognizer.run(MEAL_TASK, {
        image: { base64: input.base64, mimeType: input.mimeType },
        hint: hint.trim(),
        onStatus: setStatus,
      });
      applyPhotoResult(
        r.title,
        r.items.map((i) => toDraft(i, 'photo')),
        r.note,
      );
    } catch (e) {
      Alert.alert('辨識失敗', (e as Error).message);
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  /**
   * 照片辨識結果：上一次辨識的品項直接換掉；
   * 還有其他品項（掃條碼、手動加的、編輯中的舊紀錄）時，問要加在後面還是全部取代。
   */
  const applyPhotoResult = (newTitle: string, photoItems: DraftItem[], newNote: string) => {
    const others = items.filter((i) => i.source !== 'photo');
    const replaceAll = () => {
      setTitle(newTitle);
      setItems(photoItems);
      setNote(newNote);
    };
    if (others.length === 0) {
      replaceAll();
      return;
    }
    Alert.alert('已經有其他品項', `辨識出 ${photoItems.length} 項，要怎麼處理？`, [
      { text: '全部取代', style: 'destructive', onPress: replaceAll },
      {
        text: '加在後面',
        onPress: () => {
          setItems([...others, ...photoItems]);
          if (!title.trim()) setTitle(newTitle);
          setNote(newNote);
        },
      },
    ]);
  };

  /** 條碼查不到時，拍一次營養標示讓 AI 讀並記在條碼底下；照片只用來讀數字，不存成這餐的照片 */
  const askLabelForBarcode = (barcode: string) =>
    Alert.alert(
      `查不到這個條碼（${barcode}）`,
      '拍一次包裝背面的「營養標示」，AI 讀完會記住，下次掃這個條碼就直接帶入。',
      [
        { text: '取消', style: 'cancel' },
        { text: '從相簿選', onPress: () => readLabel('library', barcode) },
        { text: '拍照', onPress: () => readLabel('camera', barcode) },
      ],
    );

  /** 條碼 → 自己記過的 → Open Food Facts → 都沒有就請 AI 讀標示並記住 */
  const onBarcode = async (barcode: string) => {
    setScanning(false);
    setBusy(true);
    setStatus('查詢商品中…');
    try {
      const saved = await getSavedProduct(db, barcode);
      if (saved) {
        setLabel(saved);
        return;
      }
      const found = await lookupOpenFoodFacts(barcode);
      if (found) {
        await saveProduct(db, found);
        setLabel(found);
        return;
      }
      askLabelForBarcode(barcode);
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const readLabel = async (source: 'camera' | 'library', barcode: string) => {
    let p: PickedPhoto | null;
    try {
      p = await pickPhoto(source);
    } catch (e) {
      Alert.alert('無法取得照片', (e as Error).message);
      return;
    }
    if (!p) return;
    setBusy(true);
    setStatus('讀取營養標示中…');
    try {
      const recognizer = await getRecognizer(db);
      const r = await recognizer.run(LABEL_TASK, {
        image: { base64: p.base64, mimeType: p.mimeType },
        onStatus: setStatus,
      });
      if (r.perServing.kcal > 0) await saveProduct(db, { ...r, barcode, source: 'label' });
      setLabel(r);
    } catch (e) {
      Alert.alert('讀取失敗', (e as Error).message);
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const addLabelItem = (item: FoodItem) => {
    setItems((prev) => [...prev, toDraft(item)]);
    // 只有一項包裝食品時，直接用商品名當餐點名稱
    if (!title.trim()) setTitle(item.name);
    setLabel(null);
  };

  const update = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  // 有改過還沒存就離開（返回鍵、手勢、左上角），先問一下
  const current = snap({
    date,
    mealType,
    title,
    store,
    price,
    photo: photo?.uri ?? savedPhotoUri,
    items: items.map(fromDraft),
  });
  const dirty = initial !== null && current !== initial;
  const allowLeave = usePreventRemove(dirty, ({ repeat }) =>
    Alert.alert('還沒儲存', '要放棄這次的修改嗎？', [
      { text: '繼續編輯', style: 'cancel' },
      // repeat 會先解除攔截再繼續離開
      { text: '放棄', style: 'destructive', onPress: repeat },
    ]),
  );

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
      allowLeave();
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
              // 一排四個
              { flexBasis: '22%', flexGrow: 1, paddingHorizontal: 0, paddingVertical: 8 },
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
          <TextInput
            style={ui.input}
            value={pastQuery}
            onChangeText={setPastQuery}
            placeholder="🔍 吃過的？搜尋店家或餐點名稱直接帶入"
            autoCorrect={false}
          />
          {searching && pastResults.length === 0 && <Text style={ui.muted}>找不到符合的紀錄。</Text>}
          {pastResults.map((m) => (
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
      <Pressable style={ui.buttonOutline} onPress={() => setScanning(true)} disabled={busy}>
        <Text style={ui.buttonOutlineText}>▦ 掃包裝條碼</Text>
      </Pressable>
      <BarcodeScanner visible={scanning} onScanned={onBarcode} onClose={() => setScanning(false)} />

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

      {label && <LabelCard label={label} onAdd={addLabelItem} onCancel={() => setLabel(null)} />}

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

      {items.map((it) => (
        <ItemEditor
          key={it.key}
          item={it}
          onChange={(patch) => update(it.key, patch)}
          onRemove={() => setItems((p) => p.filter((x) => x.key !== it.key))}
        />
      ))}

      <Pressable style={ui.buttonOutline} onPress={() => setItems((p) => [...p, emptyItem()])}>
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
