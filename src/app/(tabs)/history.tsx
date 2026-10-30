import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { colors, ui } from '@/components/theme';
import { DaySummary, getDaySummaries, getWeights, toDateKey, Totals } from '@/lib/db';
import { getSettings, goalsForDay } from '@/lib/settings';

type WeekAvg = { label: string; avg: number; count: number };

/** 最近 4 週（每 7 天一組）的平均體重，新的在前 */
function weeklyAverages(weights: { date: string; kg: number }[]): WeekAvg[] {
  const today = new Date();
  const weeks: WeekAvg[] = [];
  for (let w = 0; w < 4; w++) {
    const end = new Date(today);
    end.setDate(today.getDate() - w * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    const [s, e] = [toDateKey(start), toDateKey(end)];
    const inWeek = weights.filter((x) => x.date >= s && x.date <= e);
    if (inWeek.length) {
      weeks.push({
        label: w === 0 ? '最近 7 天' : `${w * 7}–${w * 7 + 6} 天前`,
        avg: inWeek.reduce((a, x) => a + x.kg, 0) / inWeek.length,
        count: inWeek.length,
      });
    }
  }
  return weeks;
}

export default function HistoryScreen() {
  const db = useSQLiteContext();
  const [days, setDays] = useState<DaySummary[]>([]);
  const [goals, setGoals] = useState<Totals | null>(null);
  const [weeks, setWeeks] = useState<WeekAvg[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const since = new Date();
        since.setDate(since.getDate() - 28);
        const [d, s, w] = await Promise.all([getDaySummaries(db), getSettings(db), getWeights(db, toDateKey(since))]);
        setDays(d);
        setGoals(s.goals);
        setWeeks(weeklyAverages(w));
      })();
    }, [db]),
  );

  // 連續兩週平均體重沒增加就提醒
  const stalled = weeks.length >= 3 && weeks[0].avg - weeks[2].avg < 0.2;

  return (
    <FlatList
      style={ui.screen}
      contentContainerStyle={ui.content}
      data={days}
      keyExtractor={(d) => d.date}
      ListHeaderComponent={
        <View style={[ui.card, { marginBottom: 4 }]}>
          <Text style={ui.title}>體重週平均</Text>
          {weeks.length === 0 && <Text style={ui.muted}>還沒有體重紀錄，建議每週量 3 次。</Text>}
          {weeks.map((w, i) => {
            const prev = weeks[i + 1];
            const diff = prev ? w.avg - prev.avg : null;
            return (
              <Text key={w.label} style={ui.text}>
                {w.label}：{w.avg.toFixed(1)} kg <Text style={ui.muted}>（{w.count} 筆）</Text>
                {diff != null && (
                  <Text style={{ color: diff >= 0 ? colors.carbs : colors.danger }}>
                    {'  '}
                    {diff >= 0 ? '+' : ''}
                    {diff.toFixed(2)}
                  </Text>
                )}
              </Text>
            );
          })}
          <Text style={ui.muted}>目標：每週增加 0.25–0.4 kg</Text>
          {stalled && (
            <Text style={[ui.text, { color: colors.fat }]}>
              ⚠️ 兩週體重幾乎沒增加，建議每天多吃約 200 kcal（可到設定調高熱量目標）。
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={<Text style={ui.muted}>還沒有任何紀錄。</Text>}
      renderItem={({ item }) => {
        const g = goals ? goalsForDay(goals, item.exercise_kcal) : null;
        const kcalOk = g ? item.kcal >= g.kcal * 0.95 : false;
        const proteinOk = g ? item.protein >= g.protein * 0.95 : false;
        return (
          <Pressable
            style={[ui.card, { marginBottom: 8 }]}
            onPress={() => router.push({ pathname: '/day/[date]', params: { date: item.date } })}
          >
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={[ui.text, { fontWeight: '700' }]}>{item.date}</Text>
              {item.weight != null && <Text style={ui.muted}>{item.weight} kg</Text>}
            </View>
            <Text style={ui.text}>
              <Text style={{ color: kcalOk ? colors.carbs : colors.text }}>
                {Math.round(item.kcal)}
                {g ? ` / ${g.kcal}` : ''} kcal
              </Text>
              {'  ·  '}
              <Text style={{ color: proteinOk ? colors.carbs : colors.protein }}>
                蛋白 {Math.round(item.protein)}
                {g ? ` / ${g.protein}` : ''} g
              </Text>
            </Text>
            {item.exercise_kcal > 0 && <Text style={ui.muted}>運動 +{item.exercise_kcal} kcal</Text>}
          </Pressable>
        );
      }}
    />
  );
}
