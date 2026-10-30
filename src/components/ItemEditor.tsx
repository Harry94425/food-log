import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { searchPastItems } from '@/lib/db';
import { ITEM_TEXT_TASK } from '@/lib/recognizer/tasks';
import type { FoodItem } from '@/lib/recognizer/types';
import { getRecognizer } from '@/lib/settings';
import { Input } from './Input';
import { useTheme } from './theme';

type NumField = 'kcal' | 'protein' | 'fat' | 'carbs';

/** 編輯中的數字先存字串，才能輸入「12.」這種中間狀態 */
export type DraftItem = Omit<FoodItem, NumField> &
  Record<NumField, string> & {
    /** 列表裡固定的識別碼；不能用索引，刪除品項時非同步的估算才不會填錯格 */
    key: string;
    /** 熱量是自己打的，就不再用三大營養素自動算 */
    kcalManual?: boolean;
    /** 數字從哪來：history / ai 顯示提醒；photo 是照片辨識的，重新辨識時會被換掉 */
    source?: 'history' | 'ai' | 'photo';
  };

const NUM_FIELDS: { key: NumField; label: string }[] = [
  { key: 'kcal', label: '熱量' },
  { key: 'protein', label: '蛋白' },
  { key: 'carbs', label: '碳水' },
  { key: 'fat', label: '脂肪' },
];

let nextKey = 0;
const newKey = () => String(++nextKey);

export const emptyItem = (): DraftItem => ({
  key: newKey(),
  name: '',
  portion: '',
  kcal: '',
  protein: '',
  fat: '',
  carbs: '',
});

const draftFields = (i: FoodItem) => ({
  name: i.name,
  portion: i.portion,
  kcal: String(i.kcal),
  protein: String(i.protein),
  fat: String(i.fat),
  carbs: String(i.carbs),
});

export const toDraft = (i: FoodItem, source?: DraftItem['source']): DraftItem => ({
  key: newKey(),
  ...draftFields(i),
  source,
});

export const fromDraft = (d: DraftItem): FoodItem => ({
  name: d.name.trim() || '未命名',
  portion: d.portion.trim(),
  kcal: Number(d.kcal) || 0,
  protein: Number(d.protein) || 0,
  fat: Number(d.fat) || 0,
  carbs: Number(d.carbs) || 0,
});

/** 蛋白質、碳水 4 kcal/g，脂肪 9 kcal/g */
const kcalFromMacros = (d: Pick<DraftItem, 'protein' | 'carbs' | 'fat'>) =>
  String(Math.round((Number(d.protein) || 0) * 4 + (Number(d.carbs) || 0) * 4 + (Number(d.fat) || 0) * 9));

const hasNumbers = (d: DraftItem) => NUM_FIELDS.some((f) => d[f.key].trim() !== '');

type Props = {
  item: DraftItem;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
};

/**
 * 一個品項的編輯框：
 * - 打名稱時列出吃過的同名品項，點一下帶入
 * - 名稱打完（數字都還空著）自動帶入：吃過的優先，沒有就請 AI 估算
 * - 改蛋白質、碳水、脂肪時自動算熱量（除非熱量是自己打的）
 */
export function ItemEditor({ item, onChange, onRemove }: Props) {
  const { colors, ui } = useTheme();
  const db = useSQLiteContext();
  const [suggestions, setSuggestions] = useState<FoodItem[]>([]);
  const [nameFocused, setNameFocused] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState('');

  const showSuggestions = nameFocused && !hasNumbers(item);
  useEffect(() => {
    if (!showSuggestions) return;
    let alive = true;
    searchPastItems(db, item.name).then((r) => alive && setSuggestions(r));
    return () => {
      alive = false;
    };
  }, [db, item.name, showSuggestions]);

  const fill = (from: FoodItem, source: DraftItem['source'], keepName: boolean) =>
    onChange({
      ...draftFields(from),
      name: keepName ? item.name : from.name,
      // 份量自己有寫就保留
      portion: item.portion.trim() || from.portion,
      kcalManual: false,
      source,
    });

  const estimate = async () => {
    const desc = `${item.name.trim()} ${item.portion.trim()}`.trim();
    if (!item.name.trim()) return;
    setEstimating(true);
    setError('');
    try {
      const recognizer = await getRecognizer(db);
      fill(await recognizer.run(ITEM_TEXT_TASK, { hint: desc }), 'ai', true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEstimating(false);
    }
  };

  const onNameDone = async () => {
    setNameFocused(false);
    const name = item.name.trim();
    if (!name || hasNumbers(item)) return;
    const exact = (await searchPastItems(db, name)).find((s) => s.name === name);
    if (exact) fill(exact, 'history', false);
    else estimate();
  };

  const onNumber = (key: NumField, v: string) => {
    if (key === 'kcal') {
      // 清空熱量就恢復自動計算
      onChange({ kcal: v, kcalManual: v.trim() !== '' });
      return;
    }
    const next = { ...item, [key]: v };
    onChange(item.kcalManual ? { [key]: v } : { [key]: v, kcal: kcalFromMacros(next) });
  };

  return (
    <View style={ui.card}>
      <View style={ui.row}>
        <Input
          style={[{ flex: 2 }]}
          value={item.name}
          onChangeText={(v) => onChange({ name: v })}
          onFocus={() => setNameFocused(true)}
          onEndEditing={onNameDone}
          placeholder="食物，例如：白飯"
        />
        <Input
          style={[{ flex: 2 }]}
          value={item.portion}
          onChangeText={(v) => onChange({ portion: v })}
          placeholder="份量，例如：半碗"
        />
        <Pressable style={[ui.smallDangerButton, { alignSelf: 'center' }]} onPress={onRemove} hitSlop={4}>
          <Text style={ui.smallDangerButtonText}>✕</Text>
        </Pressable>
      </View>

      {showSuggestions &&
        suggestions.map((s) => (
          <Pressable key={s.name} onPress={() => fill(s, 'history', false)} style={ui.listItem}>
            <Text style={ui.text}>
              {s.name}{' '}
              <Text style={ui.muted}>
                {s.portion} · {Math.round(s.kcal)} kcal · 蛋白 {s.protein}g
              </Text>
            </Text>
          </Pressable>
        ))}

      <View style={ui.row}>
        {NUM_FIELDS.map((f) => (
          <View key={f.key} style={{ flex: 1, gap: 2 }}>
            {/* 標籤保持一行，四個輸入框才會對齊；熱量是否自動算寫在下方說明 */}
            <Text style={ui.muted} numberOfLines={1}>
              {f.label}
              {f.key === 'kcal' ? '' : '(g)'}
            </Text>
            <Input value={item[f.key]} onChangeText={(v) => onNumber(f.key, v)} keyboardType="decimal-pad" />
          </View>
        ))}
      </View>

      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[ui.muted, item.source === 'ai' && { color: colors.fat }]}>
            {estimating
              ? 'AI 估算中…'
              : error
                ? `⚠️ ${error}`
                : item.source === 'ai'
                  ? '⚠️ AI 估算，請確認'
                  : item.source === 'history'
                    ? '用上次吃的數字'
                    : ''}
          </Text>
          {!item.kcalManual && hasNumbers(item) && <Text style={ui.muted}>熱量依蛋白質、碳水、脂肪自動計算</Text>}
        </View>
        {estimating ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          item.name.trim() !== '' && (
            <Pressable style={ui.smallButton} onPress={estimate} hitSlop={4}>
              <Text style={ui.smallButtonText}>AI 估算</Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}
