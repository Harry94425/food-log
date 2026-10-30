import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { colors, ui } from '@/components/theme';
import {
  DaySummary,
  emptyDay,
  getDaySummaries,
  getMonthSpending,
  getWeights,
  toDateKey,
  Totals,
  weekdayLabel,
} from '@/lib/db';
import { getSettings, goalsForDay } from '@/lib/settings';

/** 列表固定顯示最近幾天（沒紀錄的也列出來） */
const RECENT_DAYS = 30;
/** 今天過了這個時間還沒記，才標示缺午餐／晚餐 */
const LUNCH_DEADLINE_HOUR = 14;
const DINNER_DEADLINE_HOUR = 21;

type MonthSpend = { label: string; total: number; days: number; meals: number };

/** 最近 RECENT_DAYS 天每天一列，再接上更早有紀錄的日子 */
function fillDays(summaries: DaySummary[]): DaySummary[] {
  const byDate = new Map(summaries.map((s) => [s.date, s]));
  const days: DaySummary[] = [];
  const d = new Date();
  for (let i = 0; i < RECENT_DAYS; i++) {
    const key = toDateKey(d);
    days.push(byDate.get(key) ?? emptyDay(key));
    byDate.delete(key);
    d.setDate(d.getDate() - 1);
  }
  return [...days, ...[...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))];
}

/** 這一天要提醒的缺漏 */
function missingLabels(day: DaySummary): string[] {
  const isToday = day.date === toDateKey();
  const hour = new Date().getHours();
  if (day.meal_count === 0) {
    return isToday && hour < LUNCH_DEADLINE_HOUR ? [] : ['沒有紀錄'];
  }
  const missing: string[] = [];
  if (!day.has_lunch && (!isToday || hour >= LUNCH_DEADLINE_HOUR)) missing.push('缺午餐');
  if (!day.has_dinner && (!isToday || hour >= DINNER_DEADLINE_HOUR)) missing.push('缺晚餐');
  return missing;
}

/** 本月與上個月的 YYYY-MM */
function recentMonths(): { key: string; label: string }[] {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return [
    { key: toDateKey(now).slice(0, 7), label: '本月' },
    { key: toDateKey(prev).slice(0, 7), label: '上個月' },
  ];
}

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
  const [months, setMonths] = useState<MonthSpend[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const since = new Date();
        since.setDate(since.getDate() - 28);
        const monthKeys = recentMonths();
        const [d, s, w, ...m] = await Promise.all([
          getDaySummaries(db),
          getSettings(db),
          getWeights(db, toDateKey(since)),
          ...monthKeys.map((mk) => getMonthSpending(db, mk.key)),
        ]);
        setDays(fillDays(d));
        setGoals(s.goals);
        setWeeks(weeklyAverages(w));
        setMonths(monthKeys.map((mk, i) => ({ label: mk.label, ...m[i] })));
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
        <View style={{ gap: 12, marginBottom: 4 }}>
          <View style={ui.card}>
            <Text style={ui.title}>餐費</Text>
            {months.map((m) => (
              <Text key={m.label} style={ui.text}>
                {m.label}：${Math.round(m.total)}
                {m.days > 0 && (
                  <Text style={ui.muted}>
                    {'  '}（{m.meals} 餐，有記帳的日子平均每天 ${Math.round(m.total / m.days)}）
                  </Text>
                )}
              </Text>
            ))}
          </View>
          <View style={ui.card}>
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
        </View>
      }
      renderItem={({ item }) => {
        const g = goals ? goalsForDay(goals, item.exercise_kcal) : null;
        const kcalOk = g ? item.kcal >= g.kcal * 0.95 : false;
        const proteinOk = g ? item.protein >= g.protein * 0.95 : false;
        const missing = missingLabels(item);
        const empty = item.meal_count === 0;
        return (
          <Pressable
            style={[
              ui.card,
              { marginBottom: 8 },
              missing.length > 0 && {
                borderColor: empty ? colors.danger : colors.fat,
                borderWidth: 1,
                backgroundColor: empty ? '#FEF2F2' : '#FFFBEB',
              },
            ]}
            onPress={() => router.push({ pathname: '/day/[date]', params: { date: item.date } })}
          >
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={[ui.text, { fontWeight: '700' }]}>
                {item.date} <Text style={ui.muted}>{weekdayLabel(item.date)}</Text>
              </Text>
              <Text style={ui.muted}>
                {item.spent > 0 ? `$${Math.round(item.spent)}` : ''}
                {item.spent > 0 && item.weight != null ? ' · ' : ''}
                {item.weight != null ? `${item.weight} kg` : ''}
              </Text>
            </View>
            {missing.length > 0 && (
              <View style={ui.row}>
                {missing.map((m) => (
                  <Text
                    key={m}
                    style={{
                      color: '#fff',
                      backgroundColor: empty ? colors.danger : colors.fat,
                      borderRadius: 6,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      fontSize: 12,
                      fontWeight: '600',
                      overflow: 'hidden',
                    }}
                  >
                    {m}
                  </Text>
                ))}
                <Text style={ui.muted}>點一下補記</Text>
              </View>
            )}
            {!empty && (
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
            )}
            {item.exercise_kcal > 0 && <Text style={ui.muted}>運動 +{item.exercise_kcal} kcal</Text>}
          </Pressable>
        );
      }}
    />
  );
}
