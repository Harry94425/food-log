import { Text, View } from 'react-native';
import { useTheme } from './theme';

type Props = { label: string; value: number; goal: number; unit: string; color: string };

export function ProgressBar({ label, value, goal, unit, color }: Props) {
  const { colors, ui } = useTheme();
  const ratio = goal > 0 ? Math.min(value / goal, 1) : 0;
  const left = Math.round(goal - value);
  return (
    <View style={{ gap: 4 }}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <Text style={[ui.text, { fontWeight: '600' }]}>{label}</Text>
        <Text style={ui.text}>
          {Math.round(value)} / {Math.round(goal)} {unit}
        </Text>
      </View>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' }}>
        <View style={{ width: `${ratio * 100}%`, height: '100%', backgroundColor: color }} />
      </View>
      <Text style={ui.muted}>{left > 0 ? `還差 ${left} ${unit}` : `已達標（+${-left} ${unit}）`}</Text>
    </View>
  );
}
