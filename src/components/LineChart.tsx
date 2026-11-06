import { useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { fromDateKey } from '@/lib/db';
import { useTheme } from './theme';

export type Point = { date: string; value: number };

type Props = {
  /** 依日期排好的點；沒有資料的日子不用放，線會直接連過去 */
  data: Point[];
  /** X 軸範圍（YYYY-MM-DD），不一定每天都有點 */
  from: string;
  to: string;
  color: string;
  format: (v: number) => string;
  /** Y 軸從 0 開始（金額）；體重這種只看變化的就不要 */
  zeroBased?: boolean;
};

const HEIGHT = 150;
const PAD = { top: 12, right: 12, bottom: 22, left: 40 };
const DAY = 86_400_000;

/** 把範圍切成 2–3 段整數刻度 */
function niceTicks(min: number, max: number): number[] {
  if (min === max) return [min];
  const raw = (max - min) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

const md = (key: string) => {
  const d = fromDateKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 單一數列的折線圖：2px 線、終點標值，手指按住拖曳看每一天 */
export function LineChart({ data, from, to, color, format, zeroBased }: Props) {
  const { colors, ui } = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (data.length === 0) return null;

  const t0 = fromDateKey(from).getTime();
  const span = Math.max(DAY, fromDateKey(to).getTime() - t0);
  const values = data.map((p) => p.value);
  const lo = zeroBased ? 0 : Math.min(...values);
  const hi = Math.max(...values);
  // 不從 0 開始時上下各留一點空間，平的線也不會貼邊
  const pad = zeroBased ? 0 : Math.max((hi - lo) * 0.15, 0.5);
  const ticks = niceTicks(lo - pad, hi + pad);
  const yMin = Math.min(ticks[0], lo - pad);
  const yMax = Math.max(ticks[ticks.length - 1], hi + pad);

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (key: string) => PAD.left + ((fromDateKey(key).getTime() - t0) / span) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

  const path = data.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = data.length - 1;
  const shown = active ?? last;

  /** 手指位置找最近的一天 */
  const track = (e: GestureResponderEvent) => {
    const px = e.nativeEvent.locationX;
    let best = 0;
    data.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(data[best].date) - px)) best = i;
    });
    setActive(best);
  };

  return (
    <View style={{ gap: 4 }}>
      {/* 讀數：數值在前、日期在後；沒按著時顯示最新一筆 */}
      <Text style={ui.text}>
        <Text style={{ fontWeight: '700' }}>{format(data[shown].value)}</Text>
        <Text style={ui.muted}>
          {'  '}
          {md(data[shown].date)}
          {active == null ? '（最新）' : ''}
        </Text>
      </Text>
      <View
        onLayout={onLayout}
        style={{ height: HEIGHT }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // 拖曳時不要讓外層 ScrollView 搶走
        onResponderTerminationRequest={() => false}
        onResponderGrant={track}
        onResponderMove={track}
        onResponderRelease={() => setActive(null)}
        onResponderTerminate={() => setActive(null)}
      >
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            {ticks.map((t) => (
              <Line
                key={t}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={colors.border}
                strokeWidth={1}
              />
            ))}
            {active != null && (
              <Line
                x1={x(data[active].date)}
                x2={x(data[active].date)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke={colors.muted}
                strokeWidth={1}
              />
            )}
            <Path d={path} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {/* 只有一筆時畫不出線，至少有個點 */}
            <Circle cx={x(data[shown].date)} cy={y(data[shown].value)} r={4} fill={color} stroke={colors.card} strokeWidth={2} />
          </Svg>
        )}
        {/* 刻度文字用 RN Text，字型和顏色跟 App 一致 */}
        {width > 0 &&
          ticks.map((t) => (
            <Text
              key={t}
              style={[ui.muted, { position: 'absolute', left: 0, width: PAD.left - 6, top: y(t) - 8, fontSize: 11, textAlign: 'right' }]}
            >
              {t >= 1000 ? `${Math.round(t / 100) / 10}K` : t}
            </Text>
          ))}
        {width > 0 && (
          <>
            <Text style={[ui.muted, { position: 'absolute', left: PAD.left, bottom: 0, fontSize: 11 }]}>{md(from)}</Text>
            <Text style={[ui.muted, { position: 'absolute', right: PAD.right, bottom: 0, fontSize: 11 }]}>{md(to)}</Text>
          </>
        )}
      </View>
    </View>
  );
}
