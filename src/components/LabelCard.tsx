import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { FoodItem, LabelRecognition } from '@/lib/recognizer/types';
import { colors, ui } from './theme';

type Props = {
  label: LabelRecognition;
  onAdd: (item: FoodItem) => void;
  onCancel: () => void;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 掃完營養標示後，選吃了幾份再加入品項 */
export function LabelCard({ label, onAdd, onCancel }: Props) {
  const [servings, setServings] = useState('1');
  const n = Number(servings) || 0;
  const p = label.perServing;

  const presets: { text: string; value: number }[] = [
    { text: '半份', value: 0.5 },
    { text: '1 份', value: 1 },
    ...(label.servingsPerPackage && label.servingsPerPackage !== 1
      ? [{ text: `整包（${label.servingsPerPackage} 份）`, value: label.servingsPerPackage }]
      : []),
  ];

  const add = () => {
    if (!(n > 0)) return;
    const grams = label.servingGrams ? `，約 ${round1(label.servingGrams * n)}g` : '';
    onAdd({
      name: label.name,
      portion: `${round1(n)} 份${grams}`,
      kcal: Math.round(p.kcal * n),
      protein: round1(p.protein * n),
      fat: round1(p.fat * n),
      carbs: round1(p.carbs * n),
    });
  };

  return (
    <View style={[ui.card, { borderColor: colors.primary, borderWidth: 1 }]}>
      <Text style={ui.title}>🏷 {label.name}</Text>
      <Text style={ui.muted}>
        每份 {label.servingSize || '—'}
        {label.servingsPerPackage ? `，本包裝 ${label.servingsPerPackage} 份` : ''}
      </Text>
      <Text style={ui.text}>
        每份 {p.kcal} kcal · 蛋白 {p.protein}g · 碳水 {p.carbs}g · 脂肪 {p.fat}g
      </Text>
      {label.note ? <Text style={[ui.muted, { color: colors.fat }]}>⚠️ {label.note}</Text> : null}

      <Text style={ui.muted}>吃了幾份？</Text>
      <View style={[ui.row, { flexWrap: 'wrap' }]}>
        {presets.map((pr) => (
          <Pressable
            key={pr.text}
            onPress={() => setServings(String(pr.value))}
            style={[n === pr.value ? ui.button : ui.buttonOutline, { paddingVertical: 6, paddingHorizontal: 10 }]}
          >
            <Text style={n === pr.value ? ui.buttonText : ui.buttonOutlineText}>{pr.text}</Text>
          </Pressable>
        ))}
        <TextInput
          style={[ui.input, { width: 70 }]}
          value={servings}
          onChangeText={setServings}
          keyboardType="decimal-pad"
        />
        <Text style={ui.text}>份</Text>
      </View>
      <Text style={ui.text}>
        = {Math.round(p.kcal * n)} kcal · 蛋白 {round1(p.protein * n)}g
      </Text>

      <View style={ui.row}>
        <Pressable style={[ui.buttonOutline, { flex: 1 }]} onPress={onCancel}>
          <Text style={ui.buttonOutlineText}>取消</Text>
        </Pressable>
        <Pressable style={[ui.button, { flex: 2 }, !(n > 0) && { opacity: 0.5 }]} onPress={add}>
          <Text style={ui.buttonText}>加入品項</Text>
        </Pressable>
      </View>
    </View>
  );
}
