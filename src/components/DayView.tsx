import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import {
  deleteExercise,
  deleteMeal,
  Exercise,
  getExercises,
  getMeals,
  Meal,
  MEAL_LABELS,
  mealTitle,
  sumItems,
} from '@/lib/db';
import { isIncludedInGoal } from '@/lib/exercise';
import { deletePhoto } from '@/lib/photo';
import { scheduleReminders } from '@/lib/reminders';
import { autoSyncStrava } from '@/lib/stravaSync';
import { getSettings, goalsForDay } from '@/lib/settings';
import type { Totals } from '@/lib/db';
import { KeyboardScrollView } from './KeyboardScrollView';
import { ProgressBar } from './ProgressBar';
import { WeightCard } from './WeightCard';
import { useTheme } from './theme';

export function DayView({ date }: { date: string }) {
  const { colors, ui } = useTheme();
  const db = useSQLiteContext();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [baseGoals, setBaseGoals] = useState<Totals | null>(null);

  const load = useCallback(async () => {
    const [m, e, s] = await Promise.all([getMeals(db, date), getExercises(db, date), getSettings(db)]);
    setMeals(m);
    setExercises(e);
    setBaseGoals(s.goals);
  }, [db, date]);

  useFocusEffect(
    useCallback(() => {
      load();
      // 有連 Strava 就順便抓新活動，抓到才重新整理
      autoSyncStrava(db).then((changed) => {
        if (changed) load();
      });
    }, [db, load]),
  );

  const totals = sumItems(meals.flatMap((m) => m.items));
  const exerciseKcal = exercises.reduce((s, e) => s + e.kcal, 0);
  const spent = meals.reduce((s, m) => s + (m.price ?? 0), 0);
  const goals = baseGoals ? goalsForDay(baseGoals, exerciseKcal) : null;

  const onDeleteMeal = (meal: Meal) => {
    Alert.alert('刪除這一餐？', mealTitle(meal), [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          await deleteMeal(db, meal.id);
          deletePhoto(meal.photo_uri);
          // 刪掉今天的午餐／晚餐要把提醒排回來
          scheduleReminders(db).catch(() => {});
          load();
        },
      },
    ]);
  };

  return (
    <KeyboardScrollView style={ui.screen} contentContainerStyle={ui.content}>
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
        const title = mealTitle(meal);
        // 只有一個品項而且就是餐名時，不重複列出
        const itemNames = meal.items.map((i) => i.name).join('、');
        const showItems = itemNames !== '' && itemNames !== title;
        return (
          <Pressable
            key={meal.id}
            style={ui.card}
            onPress={() => router.push({ pathname: '/add', params: { id: String(meal.id) } })}
            onLongPress={() => onDeleteMeal(meal)}
          >
            <View style={[ui.row, { alignItems: 'center', gap: 12 }]}>
              {meal.photo_uri && (
                <Image source={{ uri: meal.photo_uri }} style={{ width: 56, height: 56, borderRadius: 8 }} />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={ui.muted} numberOfLines={1}>
                  {MEAL_LABELS[meal.meal_type]}
                  {meal.store ? ` · ${meal.store}` : ''}
                </Text>
                <Text style={[ui.text, { fontWeight: '700', fontSize: 16 }]} numberOfLines={1}>
                  {title}
                </Text>
                {showItems && (
                  <Text style={ui.muted} numberOfLines={1}>
                    {itemNames}
                  </Text>
                )}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={[ui.text, { fontWeight: '700', fontSize: 16 }]}>{Math.round(t.kcal)} kcal</Text>
                {meal.price != null && <Text style={ui.muted}>${meal.price}</Text>}
              </View>
            </View>
            <View style={[ui.row, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }]}>
              {(
                [
                  ['蛋白', t.protein, colors.protein],
                  ['碳水', t.carbs, colors.carbs],
                  ['脂肪', t.fat, colors.fat],
                ] as const
              ).map(([label, value, color]) => (
                <Text key={label} style={[ui.muted, { flex: 1, textAlign: 'center' }]}>
                  {label} <Text style={{ color, fontWeight: '700' }}>{Math.round(value)}g</Text>
                </Text>
              ))}
            </View>
          </Pressable>
        );
      })}
      {meals.length > 0 && <Text style={[ui.muted, { textAlign: 'center' }]}>點一下餐點編輯，長按刪除</Text>}

      <View style={ui.card}>
        <Text style={ui.title}>運動消耗</Text>
        {exercises.map((e) => (
          <Pressable
            key={e.id}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              gap: 2,
            }}
            // Strava 匯入的以 Strava 為準，要改請到 Strava 改
            onLongPress={
              e.strava_id
                ? undefined
                : async () => {
                    await deleteExercise(db, e.id);
                    load();
                  }
            }
          >
            <Text style={[ui.text, { fontWeight: '600' }]}>{e.name}</Text>
            <Text style={ui.muted}>
              {isIncludedInGoal(e.name) ? '已含在每日目標' : `${e.kcal} kcal`}
              {e.strava_id ? ' · 來自 Strava' : '（長按刪除）'}
            </Text>
          </Pressable>
        ))}
        {exercises.length === 0 && (
          <Text style={ui.muted}>沒有運動紀錄。運動會從 Strava 自動匯入，沒連結的話到「設定」連結。</Text>
        )}
      </View>

      <WeightCard date={date} />
    </KeyboardScrollView>
  );
}
