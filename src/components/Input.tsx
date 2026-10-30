import { TextInput, TextInputProps } from 'react-native';
import { useTheme } from './theme';

/**
 * App 裡所有輸入框都用這個：預設帶 ui.input 樣式和看得見的提示字顏色。
 * Android 正式版的預設提示字顏色會跟背景太接近，深色、淺色都看不到。
 */
export function Input({ style, ...props }: TextInputProps) {
  const { colors, ui } = useTheme();
  return <TextInput placeholderTextColor={colors.muted} style={[ui.input, style]} {...props} />;
}
