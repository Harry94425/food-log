import { Tabs, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { DayView } from '@/components/DayView';
import { fromDateKey, toDateKey, weekdayLabel } from '@/lib/db';

export default function TodayScreen() {
  // 回到畫面時重新取得日期，跨過午夜也會換成新的一天
  const [date, setDate] = useState(toDateKey());
  useFocusEffect(useCallback(() => setDate(toDateKey()), []));
  const d = fromDateKey(date);
  return (
    <>
      {/* 只改上方標題，底部分頁仍叫「今天」 */}
      <Tabs.Screen options={{ headerTitle: `今天 ${d.getMonth() + 1}/${d.getDate()} ${weekdayLabel(date)}` }} />
      <DayView date={date} />
    </>
  );
}
