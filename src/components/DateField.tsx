import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Pressable, Text } from 'react-native';
import { fromDateKey, toDateKey, weekdayLabel } from '@/lib/db';
import { ui } from './theme';

type Props = { value: string; onChange: (dateKey: string) => void };

/** 點一下跳出 Android 日曆選日期，不能選未來 */
export function DateField({ value, onChange }: Props) {
  const open = () =>
    DateTimePickerAndroid.open({
      value: fromDateKey(value),
      mode: 'date',
      maximumDate: new Date(),
      onValueChange: (_, date) => onChange(toDateKey(date)),
    });

  return (
    <Pressable style={[ui.input, ui.row, { flex: 1, justifyContent: 'space-between' }]} onPress={open}>
      <Text style={ui.text}>
        {value} {weekdayLabel(value)}
      </Text>
      <Text style={ui.muted}>📅 更改</Text>
    </Pressable>
  );
}
