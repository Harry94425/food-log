import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Tabs, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { DayView } from '@/components/DayView';
import { useTheme } from '@/components/theme';
import { fromDateKey, toDateKey, weekdayLabel } from '@/lib/db';

/** 水平滑超過這個距離才換日期 */
const SWIPE_DISTANCE = 60;

function shiftDate(key: string, days: number) {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** 主頁：一次顯示一天，標題列左右箭頭或左右滑換日期，點日期跳日曆 */
export default function TodayScreen() {
  const { colors, ui } = useTheme();
  // 從歷史頁點某一天會帶 date 進來；t 讓連點同一天也會切過去
  const params = useLocalSearchParams<{ date?: string; t?: string }>();
  const [date, setDate] = useState(params.date ?? toDateKey());
  const todayRef = useRef(toDateKey());

  // 參數變了（從歷史頁又點了一天）就切過去；在 render 時調整，避免 effect 裡 setState
  const paramKey = `${params.date}|${params.t}`;
  const [seenParamKey, setSeenParamKey] = useState(paramKey);
  if (paramKey !== seenParamKey) {
    setSeenParamKey(paramKey);
    if (params.date) setDate(params.date);
  }

  // 跨過午夜回到畫面：原本停在「今天」就換成新的今天，停在別天就不動
  useFocusEffect(
    useCallback(() => {
      const today = toDateKey();
      if (today !== todayRef.current) {
        setDate((d) => (d === todayRef.current ? today : d));
        todayRef.current = today;
      }
    }, []),
  );

  const today = toDateKey();
  const isToday = date === today;
  const go = useCallback((days: number) => setDate((d) => (days > 0 && d >= toDateKey() ? d : shiftDate(d, days))), []);

  const pickDate = () =>
    DateTimePickerAndroid.open({
      value: fromDateKey(date),
      mode: 'date',
      maximumDate: new Date(),
      onValueChange: (_, d) => setDate(toDateKey(d)),
    });

  // 只有明顯的水平滑動才搶走手勢，上下捲動照常交給 ScrollView
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderRelease: (_, g) => {
          if (g.dx <= -SWIPE_DISTANCE) go(1);
          else if (g.dx >= SWIPE_DISTANCE) go(-1);
        },
      }),
    [go],
  );

  const d = fromDateKey(date);
  const label = `${isToday ? '今天 ' : ''}${d.getMonth() + 1}/${d.getDate()} ${weekdayLabel(date)}`;
  const arrow = (glyph: string, onPress: () => void, disabled = false) => (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={12} style={{ paddingHorizontal: 12, opacity: disabled ? 0.25 : 1 }}>
      <Text style={{ fontSize: 22, color: colors.primary, fontWeight: '700' }}>{glyph}</Text>
    </Pressable>
  );

  return (
    <>
      {/* 只改上方標題，底部分頁仍叫「今天」 */}
      <Tabs.Screen
        options={{
          headerTitleAlign: 'center',
          headerTitle: () => (
            <View style={ui.row}>
              {arrow('‹', () => go(-1))}
              <Pressable onPress={pickDate} hitSlop={8}>
                <Text style={[ui.title, { fontSize: 17 }]}>{label}</Text>
              </Pressable>
              {arrow('›', () => go(1), isToday)}
            </View>
          ),
          headerRight: isToday
            ? undefined
            : () => (
                <Pressable onPress={() => setDate(toDateKey())} hitSlop={8} style={{ paddingHorizontal: 16 }}>
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>回今天</Text>
                </Pressable>
              ),
        }}
      />
      <View style={{ flex: 1 }} {...pan.panHandlers}>
        <DayView date={date} />
      </View>
    </>
  );
}
