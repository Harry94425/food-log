import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { recoverPendingPhoto, RecoveredPhoto, stashRecoveredPhoto } from '@/lib/photo';

/**
 * Android 在相機開著時把 App 殺掉的話，App 會從首頁重新開始，拍好的照片也不見了。
 * 啟動時把那張照片撈回來，再打開新增畫面接著辨識。
 */
export function PhotoRecovery() {
  const [found, setFound] = useState<RecoveredPhoto | null>(null);
  // 冷啟動時導覽還沒準備好就 push 會失敗，等它好了再處理
  const navReady = !!useRootNavigationState()?.key;
  const handled = useRef(false);

  useEffect(() => {
    recoverPendingPhoto()
      .then((r) => r && setFound(r))
      .catch((e) => Alert.alert('照片沒有拍成功', `${(e as Error).message}\n請再拍一次。`));
  }, []);

  useEffect(() => {
    if (!found || !navReady || handled.current) return;
    handled.current = true;
    stashRecoveredPhoto(found);
    const { date, mealType, id } = found.purpose;
    const params: Record<string, string> = { recovered: '1' };
    if (date) params.date = date;
    if (mealType) params.mealType = mealType;
    if (id) params.id = id;
    router.push({ pathname: '/add', params });
  }, [found, navReady]);

  return null;
}
