import type { MealType, Totals } from './db';

export type MealSection = {
  label: string;
  types: MealType[];
  /** 今天到了這個時間才出現（已經記了就提早出現） */
  fromHour: number;
  /** 過了這個時間還沒記，當作跳過，份額分給後面的餐 */
  untilHour: number;
  /** 佔一天目標的比例 */
  share: number;
};

export const MEAL_SECTIONS: MealSection[] = [
  { label: '早餐', types: ['breakfast'], fromHour: 5, untilHour: 11, share: 0.25 },
  { label: '午餐', types: ['lunch'], fromHour: 11, untilHour: 14, share: 0.35 },
  { label: '晚餐', types: ['dinner'], fromHour: 17, untilHour: 21, share: 0.3 },
  {
    label: '其他（宵夜、點心、飲料、補給）',
    types: ['late_night', 'snack', 'drink', 'ride_fuel'],
    fromHour: 0,
    untilHour: 24,
    share: 0.1,
  },
];

export type MealTarget = { kcal: number; protein: number };

/**
 * 每一區建議吃多少（熱量、蛋白質）。
 * 已經記了的區照固定比例；還沒記的區，把今天剩下的量依比例分給還來得及吃的餐，
 * 所以前面吃多了後面就少一點、早餐沒吃午晚餐就多一點。過去的日子只照固定比例。
 */
export function mealTargets(goals: Totals, eaten: MealTarget[], isToday: boolean, hour: number): MealTarget[] {
  const fixed = MEAL_SECTIONS.map((s) => ({ kcal: goals.kcal * s.share, protein: goals.protein * s.share }));
  if (!isToday) return fixed.map(round);

  const upcoming = MEAL_SECTIONS.map((s, i) => eaten[i].kcal === 0 && hour < s.untilHour);
  const total = eaten.reduce((a, e) => ({ kcal: a.kcal + e.kcal, protein: a.protein + e.protein }), { kcal: 0, protein: 0 });
  const remaining = { kcal: Math.max(0, goals.kcal - total.kcal), protein: Math.max(0, goals.protein - total.protein) };
  const upcomingShare = MEAL_SECTIONS.reduce((a, s, i) => a + (upcoming[i] ? s.share : 0), 0);

  return MEAL_SECTIONS.map((s, i) =>
    round(
      upcoming[i]
        ? { kcal: (remaining.kcal * s.share) / upcomingShare, protein: (remaining.protein * s.share) / upcomingShare }
        : fixed[i],
    ),
  );
}

const round = (t: MealTarget): MealTarget => ({ kcal: Math.round(t.kcal / 10) * 10, protein: Math.round(t.protein) });
