import { Stack, useLocalSearchParams } from 'expo-router';
import { DayView } from '@/components/DayView';

export default function DayScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  return (
    <>
      <Stack.Screen options={{ title: date }} />
      <DayView date={date} />
    </>
  );
}
