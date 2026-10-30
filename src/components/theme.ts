import { DarkTheme, DefaultTheme } from 'expo-router';
import { StyleSheet, useColorScheme } from 'react-native';

const light = {
  bg: '#F6F7F9',
  card: '#FFFFFF',
  text: '#1B1F24',
  muted: '#6B7280',
  border: '#E5E7EB',
  inputBg: '#FFFFFF',
  primary: '#2563EB',
  /** 實心按鈕、標籤上的字 */
  onPrimary: '#FFFFFF',
  protein: '#DC2626',
  fat: '#D97706',
  carbs: '#059669',
  danger: '#DC2626',
  /** 歷史頁「沒有紀錄」「缺午餐／晚餐」的底色 */
  dangerBg: '#FEF2F2',
  warnBg: '#FFFBEB',
};

export type Colors = typeof light;

const dark: Colors = {
  bg: '#0B0F14',
  card: '#161B22',
  text: '#E6EDF3',
  muted: '#9AA4B2',
  border: '#2A313C',
  inputBg: '#0F141A',
  primary: '#3B82F6',
  onPrimary: '#FFFFFF',
  protein: '#F87171',
  fat: '#FBBF24',
  carbs: '#34D399',
  danger: '#F87171',
  dangerBg: '#2A1416',
  warnBg: '#2A2112',
};

function makeUi(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    card: {
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    title: { fontSize: 18, fontWeight: '700', color: c.text },
    text: { fontSize: 15, color: c.text },
    muted: { fontSize: 13, color: c.muted },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 15,
      color: c.text,
      backgroundColor: c.inputBg,
    },
    button: {
      backgroundColor: c.primary,
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    buttonText: { color: c.onPrimary, fontSize: 16, fontWeight: '600' },
    buttonOutline: {
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    buttonOutlineText: { color: c.primary, fontSize: 16, fontWeight: '600' },
    /** 小按鈕（原本只有文字的操作，如「AI 估算」「移除金鑰」），一樣有外框才看得出能按 */
    smallButton: {
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 8,
      paddingVertical: 5,
      paddingHorizontal: 12,
      alignItems: 'center',
      alignSelf: 'flex-start',
    },
    smallButtonText: { color: c.primary, fontSize: 13, fontWeight: '600' },
    /** 刪除、中斷這類破壞性的小按鈕 */
    smallDangerButton: {
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: 8,
      paddingVertical: 5,
      paddingHorizontal: 12,
      alignItems: 'center',
      alignSelf: 'flex-start',
    },
    smallDangerButtonText: { color: c.danger, fontSize: 13, fontWeight: '600' },
    /** 可以點的清單列（搜尋結果、吃過的品項） */
    listItem: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 2,
    },
  });
}

/** 標題列、分頁列等導覽元件的配色，跟 App 的卡片、背景一致 */
function navTheme(c: Colors, base: typeof DefaultTheme) {
  return {
    ...base,
    colors: { ...base.colors, primary: c.primary, background: c.bg, card: c.card, text: c.text, border: c.border },
  };
}

const themes = {
  light: { colors: light, ui: makeUi(light), nav: navTheme(light, DefaultTheme), dark: false },
  dark: { colors: dark, ui: makeUi(dark), nav: navTheme(dark, DarkTheme), dark: true },
};

/** 跟著手機的深色／淺色模式切換 */
export function useTheme() {
  return useColorScheme() === 'dark' ? themes.dark : themes.light;
}
