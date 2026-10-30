import { useIsFocused } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  ScrollViewInstance,
  ScrollViewProps,
  TextInput,
} from 'react-native';

/** 輸入框和鍵盤之間至少留這麼多空間 */
const GAP = 120;

/**
 * 會避開鍵盤的 ScrollView：鍵盤彈出時縮小可視區域，
 * 並把目前輸入框捲到鍵盤上方。（Expo Go 沒有 keyboard-controller，所以自己處理）
 */
export function KeyboardScrollView({ onScroll, ...props }: ScrollViewProps) {
  const headerHeight = useHeaderHeight();
  const ref = useRef<ScrollViewInstance>(null);
  const scrollY = useRef(0);
  // 分頁切走後畫面還掛著，只讓目前看得到的這頁處理
  const focused = useIsFocused();

  useEffect(() => {
    if (!focused) return;
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      const input = TextInput.State.currentlyFocusedInput();
      if (!input) return;
      // 等 KeyboardAvoidingView 調整完高度再量
      setTimeout(() => {
        input.measureInWindow((_x, y, _w, h) => {
          const overlap = y + h + GAP - e.endCoordinates.screenY;
          if (overlap > 0) ref.current?.scrollTo({ y: scrollY.current + overlap, animated: true });
        });
      }, 50);
    });
    return () => sub.remove();
  }, [focused]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <ScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
          onScroll?.(e);
        }}
        {...props}
      />
    </KeyboardAvoidingView>
  );
}
