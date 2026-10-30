import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { deleteWeight, getLatestWeight, getWeight, setWeight } from '@/lib/db';
import { colors, ui } from './theme';

/** 輸入體重：按儲存或收鍵盤就存，清空存檔等於刪除 */
export function WeightCard({ date }: { date: string }) {
  const db = useSQLiteContext();
  const [weight, setWeightText] = useState('');
  /** 資料庫裡的體重，用來判斷有沒有改、輸入不合理時還原 */
  const [saved, setSaved] = useState('');
  /** 最近一次量的體重，當提示 */
  const [latest, setLatest] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  // 按「儲存」收鍵盤時 onEndEditing 也會觸發，用 ref 同步記住已存的值避免存兩次
  const savedRef = useRef('');

  const load = useCallback(async () => {
    const [w, l] = await Promise.all([getWeight(db, date), getLatestWeight(db, date)]);
    const text = w != null ? String(w) : '';
    setWeightText(text);
    setSaved(text);
    savedRef.current = text;
    setLatest(l);
  }, [db, date]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const flash = (text: string) => {
    setStatus(text);
    setTimeout(() => setStatus(''), 2500);
  };

  const onSave = async () => {
    const text = weight.trim();
    if (text === savedRef.current) return;
    if (text === '') {
      savedRef.current = '';
      await deleteWeight(db, date);
      setSaved('');
      flash('已刪除');
      return;
    }
    const kg = Number(text);
    if (!(kg > 20 && kg < 300)) {
      setWeightText(savedRef.current);
      flash('⚠️ 請輸入 20–300 之間的數字');
      return;
    }
    savedRef.current = String(kg);
    await setWeight(db, date, kg);
    setSaved(String(kg));
    setWeightText(String(kg));
    flash('✓ 已儲存');
  };

  const unchanged = weight.trim() === saved;

  return (
    <View style={ui.card}>
      <Text style={ui.title}>體重</Text>
      <View style={ui.row}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          value={weight}
          onChangeText={setWeightText}
          onEndEditing={onSave}
          placeholder={latest != null ? `上次 ${latest}` : '例如 48.2'}
          keyboardType="decimal-pad"
        />
        <Text style={ui.text}>kg</Text>
        <Pressable
          style={[ui.button, { paddingVertical: 9 }, unchanged && { opacity: 0.4 }]}
          onPress={() => {
            onSave();
            Keyboard.dismiss();
          }}
          disabled={unchanged}
        >
          <Text style={ui.buttonText}>儲存</Text>
        </Pressable>
      </View>
      <Text style={[ui.muted, status.startsWith('⚠️') && { color: colors.fat }]}>
        {status || (saved ? '清空後儲存可刪除這天的體重' : '建議每週量 3 次，早上起床量最準')}
      </Text>
    </View>
  );
}
