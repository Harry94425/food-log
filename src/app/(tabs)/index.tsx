import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { DayView } from '@/components/DayView';
import { toDateKey } from '@/lib/db';

export default function TodayScreen() {
  // 回到畫面時重新取得日期，跨過午夜也會換成新的一天
  const [date, setDate] = useState(toDateKey());
  useFocusEffect(useCallback(() => setDate(toDateKey()), []));
  return <DayView date={date} />;
}
