import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  addExercise,
  deleteExercise,
  deleteMeal,
  Exercise,
  getExercises,
  getMeals,
  getWeight,
  Meal,
  MEAL_LABELS,
  mealTitle,
  setWeight,
  sumItems,
} from '@/lib/db';
import { deletePhoto } from '@/lib/photo';
import { getSettings, goalsForDay } from '@/lib/settings';
import type { Totals } from '@/lib/db';
import { ProgressBar } from './ProgressBar';
import { colors, ui } from './theme';

export function DayView({ date }: { date: string }) {
  const db = useSQLiteContext();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [baseGoals, setBaseGoals] = useState<Totals | null>(null);
  const [weight, setWeightState] = useState('');
  const [exName, setExName] = useState('公路車');
  const [exKcal, setExKcal] = useState('');

  const load = useCallback(async () => {
    const [m, e, s, w] = await Promise.all([
      getMeals(db, date),
      getExercises(db, date),
      getSettings(db),
      getWeight(db, date),
    ]);
    setMeals(m);
    setExercises(e);
    setBaseGoals(s.goals);
    setWeightState(w != null ? String(w) : '');
  }, [db, date]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const totals = sumItems(meals.flatMap((m) => m.items));
  const exerciseKcal = exercises.reduce((s, e) => s + e.kcal, 0);
  const spent = meals.reduce((s, m) => s + (m.price ?? 0), 0);
  const goals = baseGoals ? goalsForDay(baseGoals, exerciseKcal) : null;

  const onAddExercise = async () => {
    const kcal = Number(exKcal);
    if (!exName.trim() || !(kcal > 0)) return;
    await addExercise(db, date, exName.trim(), kcal);
    setExKcal('');
    load();
  };

  const onSaveWeight = async () => {
    const kg = Number(weight);
    if (kg > 20 && kg < 300) await setWeight(db, date, kg);
  };

  const onDeleteMeal = (meal: Meal) => {
    Alert.alert('刪除這一餐？', mealTitle(meal), [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          await deleteMeal(db, meal.id);
          deletePhoto(meal.photo_uri);
          load();
        },
      },
    ]);
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
      {goals && (
        <View style={ui.card}>
          <ProgressBar label="熱量" value={totals.kcal} goal={goals.kcal} unit="kcal" color={colors.primary} />
          <ProgressBar label="蛋白質" value={totals.protein} goal={goals.protein} unit="g" color={colors.protein} />
          <ProgressBar label="碳水" value={totals.carbs} goal={goals.carbs} unit="g" color={colors.carbs} />
          <ProgressBar label="脂肪" value={totals.fat} goal={goals.fat} unit="g" color={colors.fat} />
          {exerciseKcal > 0 && <Text style={ui.muted}>已含運動消耗 +{exerciseKcal} kcal（用碳水補足）</Text>}
          <Text style={[ui.text, { fontWeight: '600' }]}>今日餐費 ${Math.round(spent)}</Text>
        </View>
      )}

      <Pressable style={ui.button} onPress={() => router.push({ pathname: '/add', params: { date } })}>
        <Text style={ui.buttonText}>＋ 新增餐點</Text>
      </Pressable>

      {meals.map((meal) => {
        const t = sumItems(meal.items);
        return (
          <Pressable
            key={meal.id}
            style={ui.card}
            onPress={() => router.push({ pathname: '/add', params: { id: String(meal.id) } })}
            onLongPress={() => onDeleteMeal(meal)}
          >
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={[ui.title, { flex: 1 }]} numberOfLines={1}>
                <Text style={ui.muted}>{MEAL_LABELS[meal.meal_type]} </Text>
                {mealTitle(meal)}
              </Text>
              <Text style={ui.text}>
                {Math.round(t.kcal)} kcal{meal.price != null ? ` · $${meal.price}` : ''}
              </Text>
            </View>
            <View style={[ui.row, { alignItems: 'flex-start' }]}>
              {meal.photo_uri && (
                <Image source={{ uri: meal.photo_uri }} style={{ width: 64, height: 64, borderRadius: 8 }} />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                {meal.items.map((i) => (
                  <Text key={i.id} style={ui.text}>
                    {i.name} <Text style={ui.muted}>{i.portion} · {Math.round(i.kcal)} kcal · 蛋白 {i.protein}g</Text>
                  </Text>
                ))}
              </View>
            </View>
            <Text style={ui.muted}>
              蛋白 {Math.round(t.protein)}g · 碳水 {Math.round(t.carbs)}g · 脂肪 {Math.round(t.fat)}g（點一下編輯，長按刪除）
            </Text>
          </Pressable>
        );
      })}

      <View style={ui.card}>
        <Text style={ui.title}>運動消耗</Text>
        {exercises.map((e) => (
          <Pressable
            key={e.id}
            onLongPress={async () => {
              await deleteExercise(db, e.id);
              load();
            }}
          >
            <Text style={ui.text}>
              {e.name} <Text style={ui.muted}>{e.kcal} kcal（長按刪除）</Text>
            </Text>
          </Pressable>
        ))}
        <View style={ui.row}>
          <TextInput style={[ui.input, { flex: 1 }]} value={exName} onChangeText={setExName} placeholder="項目" />
          <TextInput
            style={[ui.input, { width: 90 }]}
            value={exKcal}
            onChangeText={setExKcal}
            placeholder="kcal"
            keyboardType="numeric"
          />
          <Pressable style={[ui.button, { paddingVertical: 9 }]} onPress={onAddExercise}>
            <Text style={ui.buttonText}>加入</Text>
          </Pressable>
        </View>
      </View>

      <View style={ui.card}>
        <Text style={ui.title}>體重</Text>
        <View style={ui.row}>
          <TextInput
            style={[ui.input, { flex: 1 }]}
            value={weight}
            onChangeText={setWeightState}
            onEndEditing={onSaveWeight}
            placeholder="例如 48.2"
            keyboardType="decimal-pad"
          />
          <Text style={ui.text}>kg</Text>
        </View>
      </View>
    </ScrollView>
  );
}
