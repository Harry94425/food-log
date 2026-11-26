import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

const MAX_SIDE = 1024;

export type PickedPhoto = { uri: string; base64: string; mimeType: string };

/** 拍照當下在做什麼；Android 把 App 殺掉再叫回來時，要靠它接回原本的流程 */
export type PhotoPurpose = {
  /** meal：餐點照片；label：條碼查不到時拍的營養標示 */
  kind: 'meal' | 'label';
  barcode?: string;
  /** 新增畫面原本的參數，回來時照樣打開 */
  date?: string;
  mealType?: string;
  id?: string;
};

export type RecoveredPhoto = { photo: PickedPhoto; purpose: PhotoPurpose };

const purposeFile = () => new File(Paths.document, 'pending-photo.json');

function savePurpose(purpose: PhotoPurpose) {
  try {
    purposeFile().writeSync(JSON.stringify(purpose));
  } catch {
    // 寫不進去只是救不回流程，照片還是會當成餐點照片處理
  }
}

function takePurpose(): PhotoPurpose {
  const f = purposeFile();
  try {
    if (f.exists) {
      const p = JSON.parse(f.textSync()) as PhotoPurpose;
      f.delete();
      if (p?.kind === 'meal' || (p?.kind === 'label' && p.barcode)) return p;
    }
  } catch {
    // 壞掉的檔案就當作餐點照片
  }
  return { kind: 'meal' };
}

function clearPurpose() {
  try {
    const f = purposeFile();
    if (f.exists) f.delete();
  } catch {
    // 沒有就算了
  }
}

/** 縮到最長邊 1024px 並轉成 JPEG */
async function processAsset(asset: ImagePicker.ImagePickerAsset): Promise<PickedPhoto> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_SIDE) {
    context.resize(asset.width >= asset.height ? { width: MAX_SIDE, height: null } : { width: null, height: MAX_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  if (!saved.base64) throw new Error('照片處理失敗。');
  return { uri: saved.uri, base64: saved.base64, mimeType: 'image/jpeg' };
}

/** 相機或相簿已經開著時，連點按鈕不要再開第二次（第二次會失敗或把第一次的結果弄丟） */
let launching = false;

/** 拍照或選照片，縮到最長邊 1024px 並轉成 JPEG */
export async function pickPhoto(
  source: 'camera' | 'library',
  purpose: PhotoPurpose = { kind: 'meal' },
): Promise<PickedPhoto | null> {
  if (launching) return null;
  launching = true;
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) throw new Error('需要相機權限才能拍照。');
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    // 先記下用途：Android 記憶體不夠時會在相機開著的時候把 App 殺掉，回來後由 recoverPendingPhoto 接手
    savePurpose(purpose);
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    clearPurpose();
    if (result.canceled || !result.assets?.length) return null;
    return await processAsset(result.assets[0]);
  } finally {
    launching = false;
  }
}

/**
 * Android 有時會在相機開著的時候把 App 殺掉，拍好的照片就不會回到 pickPhoto。
 * App 重新啟動時呼叫這個把那張照片撈回來；其他平台或沒有遺失的照片時回傳 null。
 */
export async function recoverPendingPhoto(): Promise<RecoveredPhoto | null> {
  if (Platform.OS !== 'android') return null;
  const result = await ImagePicker.getPendingResultAsync();
  if (!result) return null;
  const purpose = takePurpose();
  if ('code' in result) throw new Error(result.message || '拍照失敗。');
  if (result.canceled || !result.assets?.length) return null;
  return { photo: await processAsset(result.assets[0]), purpose };
}

/** 撈回來的照片暫放這裡，等新增畫面打開時取走 */
let recovered: RecoveredPhoto | null = null;
export const stashRecoveredPhoto = (r: RecoveredPhoto) => {
  recovered = r;
};
export const takeRecoveredPhoto = () => {
  const r = recovered;
  recovered = null;
  return r;
};

/** 把暫存照片搬到 App 的文件資料夾，避免被系統清掉 */
export function persistPhoto(tempUri: string): string {
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create();
  const dest = new File(dir, `${Date.now()}.jpg`);
  new File(tempUri).copy(dest);
  return dest.uri;
}

export function deletePhoto(uri: string | null) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // 照片不存在就算了
  }
}
