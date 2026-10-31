import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/components/theme';
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
import { GoalType, getProfile } from '@/lib/profile';
import { getSettings, goalsForDay } from '@/lib/settings';

/** 沒紀錄的日子也列出來：至少最近 MIN_DAYS 天，最多往回到 MAX_DAYS 天 */
const MIN_DAYS = 7;
const MAX_DAYS = 30;
/** 今天過了這個時間還沒記，才標示缺午餐／晚餐 */
const LUNCH_DEADLINE_HOUR = 14;
const DINNER_DEADLINE_HOUR = 21;

type MonthSpend = { label: string; total: number; days: number; meals: number };

/**
 * 從今天往回每天一列，空白的日子也列：剛開始用只列一週，
 * 之後往回到第一筆紀錄那天（最多 MAX_DAYS 天），再接上更早有紀錄的日子
 */
function fillDays(summaries: DaySummary[]): DaySummary[] {
  const byDate = new Map(summaries.map((s) => [s.date, s]));
  const earliest = summaries.reduce((min, s) => (s.date < min ? s.date : min), toDateKey());
  const days: DaySummary[] = [];
  const d = new Date();
  for (let i = 0; i < MAX_DAYS; i++) {
    const key = toDateKey(d);
    if (i >= MIN_DAYS && key < earliest) break;
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

/** 吃到目標的 95% 就算達標 */
const HIT_RATIO = 0.95;

function hits(day: DaySummary, goals: Totals) {
  const g = goalsForDay(goals, day.exercise_kcal);
  return { g, kcal: day.kcal >= g.kcal * HIT_RATIO, protein: day.protein >= g.protein * HIT_RATIO };
}

type HitRate = { label: string; days: number; kcal: number; protein: number; both: number };

/** 最近 7、30 天的達標天數；只算有記錄的日子，今天還沒吃完不算 */
function hitRates(summaries: DaySummary[], goals: Totals): HitRate[] {
  const today = toDateKey();
  return [7, 30].map((n) => {
    const since = new Date();
    since.setDate(since.getDate() - n);
    const from = toDateKey(since);
    const rate: HitRate = { label: `最近 ${n} 天`, days: 0, kcal: 0, protein: 0, both: 0 };
    for (const d of summaries) {
      if (d.date < from || d.date >= today || d.meal_count === 0) continue;
      const h = hits(d, goals);
      rate.days++;
      if (h.kcal) rate.kcal++;
      if (h.protein) rate.protein++;
      if (h.kcal && h.protein) rate.both++;
    }
    return rate;
  });
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

/** 這週和上週比的變化方向對不對：增肌要升、減脂要降、維持不要差太多 */
function onTrack(goal: GoalType, diff: number) {
  if (goal === 'lose') return diff <= 0;
  if (goal === 'maintain') return Math.abs(diff) <= 0.25;
  return diff >= 0;
}

/** 每週體重變化的目標說明，以及最近兩週偏離目標時的建議 */
function weightAdvice(goal: GoalType, weeks: WeekAvg[]): { target: string; warning: string | null } {
  const latest = weeks[0]?.avg;
  // 比兩週前那週：單週平均波動大，看兩週比較穩
  const change = weeks.length >= 3 ? weeks[0].avg - weeks[2].avg : null;
  if (goal === 'lose') {
    const [lo, hi] = latest ? [latest * 0.005, latest * 0.01] : [0, 0];
    return {
      target: latest ? `目標：每週減少 ${lo.toFixed(1)}–${hi.toFixed(1)} kg（體重的 0.5–1%）` : '目標：每週減少體重的 0.5–1%',
      warning:
        change == null
          ? null
          : change > -0.2
            ? '⚠️ 兩週體重幾乎沒下降，建議每天少吃約 200 kcal（可到設定調低熱量目標）。'
            : change < -hi * 2
              ? '⚠️ 兩週掉太快，容易流失肌肉，建議每天多吃約 200 kcal、蛋白質吃足。'
              : null,
    };
  }
  if (goal === 'maintain') {
    return {
      target: '目標：體重維持，兩週變化在 0.5 kg 內',
      warning:
        change == null || Math.abs(change) <= 0.5
          ? null
          : change > 0
            ? '⚠️ 兩週體重增加超過 0.5 kg，建議每天少吃約 200 kcal。'
            : '⚠️ 兩週體重減少超過 0.5 kg，建議每天多吃約 200 kcal。',
    };
  }
  return {
    target: '目標：每週增加 0.25–0.4 kg',
    warning:
      change != null && change < 0.2
        ? '⚠️ 兩週體重幾乎沒增加，建議每天多吃約 200 kcal（可到設定調高熱量目標）。'
        : null,
  };
}

export default function HistoryScreen() {
  const { colors, ui } = useTheme();
  const db = useSQLiteContext();
  const [days, setDays] = useState<DaySummary[]>([]);
  const [goals, setGoals] = useState<Totals | null>(null);
  const [weeks, setWeeks] = useState<WeekAvg[]>([]);
  const [months, setMonths] = useState<MonthSpend[]>([]);
  const [rates, setRates] = useState<HitRate[]>([]);
  const [goalType, setGoalType] = useState<GoalType>('gain');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const since = new Date();
        since.setDate(since.getDate() - 28);
        const monthKeys = recentMonths();
        const [d, s, p, w, ...m] = await Promise.all([
          getDaySummaries(db),
          getSettings(db),
          getProfile(db),
          getWeights(db, toDateKey(since)),
          ...monthKeys.map((mk) => getMonthSpending(db, mk.key)),
        ]);
        setDays(fillDays(d));
        setGoals(s.goals);
        setRates(hitRates(d, s.goals));
        setGoalType(p?.goal ?? 'gain');
        setWeeks(weeklyAverages(w));
        setMonths(monthKeys.map((mk, i) => ({ label: mk.label, ...m[i] })));
      })();
    }, [db]),
  );

  const advice = weightAdvice(goalType, weeks);

  return (
    <FlatList
      style={ui.screen}
      contentContainerStyle={ui.content}
      data={days}
      keyExtractor={(d) => d.date}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <View style={ui.card}>
            <Text style={ui.title}>達標率</Text>
            {rates.every((r) => r.days === 0) && <Text style={ui.muted}>記滿一天後就會開始算。</Text>}
            {rates
              .filter((r) => r.days > 0)
              .map((r) => {
                const pct = (n: number) => `${Math.round((n / r.days) * 100)}%`;
                return (
                  <View key={r.label} style={{ gap: 2 }}>
                    <Text style={[ui.text, { fontWeight: '700' }]}>
                      {r.label} <Text style={ui.muted}>（有記錄 {r.days} 天）</Text>
                    </Text>
                    <Text style={ui.text}>
                      熱量 {pct(r.kcal)}
                      {'  ·  '}蛋白 {pct(r.protein)}
                      {'  ·  '}
                      <Text style={{ color: colors.carbs, fontWeight: '700' }}>都達標 {pct(r.both)}</Text>
                    </Text>
                  </View>
                );
              })}
            <Text style={ui.muted}>吃到目標 95% 算達標，今天還沒結束不算。</Text>
          </View>
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
                    <Text style={{ color: onTrack(goalType, diff) ? colors.carbs : colors.danger }}>
                      {'  '}
                      {diff >= 0 ? '+' : ''}
                      {diff.toFixed(2)}
                    </Text>
                  )}
                </Text>
              );
            })}
            <Text style={ui.muted}>{advice.target}</Text>
            {advice.warning && <Text style={[ui.text, { color: colors.fat }]}>{advice.warning}</Text>}
          </View>
        </View>
      }
      renderItem={({ item }) => {
        const h = goals ? hits(item, goals) : null;
        const g = h?.g;
        const kcalOk = !!h?.kcal;
        const proteinOk = !!h?.protein;
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
                backgroundColor: empty ? colors.dangerBg : colors.warnBg,
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
                      color: colors.onPrimary,
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
