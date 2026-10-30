import type { RecognitionTask } from './tasks';

export type Nutrients = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

export type FoodItem = Nutrients & {
  name: string;
  portion: string;
};

export type Recognition = {
  /** 整份餐點的名稱，例如「豬排咖哩飯」 */
  title: string;
  items: FoodItem[];
  note: string;
};

/** 包裝上的營養標示 */
export type LabelRecognition = {
  name: string;
  /** 照標示寫的每份份量，例如「30 公克」 */
  servingSize: string;
  servingGrams: number | null;
  /** 本包裝含幾份；看不到是 null */
  servingsPerPackage: number | null;
  perServing: Nutrients;
  note: string;
};

export type RecognizeInput = {
  imageBase64: string;
  mimeType: string;
  /** 使用者補充說明，例如「飯只吃一半」 */
  hint?: string;
  /** 重試等進度訊息 */
  onStatus?: (message: string) => void;
};

/** 換 AI 供應商時只要實作這個介面 */
export interface FoodRecognizer {
  run<T>(task: RecognitionTask<T>, input: RecognizeInput): Promise<T>;
}

export class RecognizerError extends Error {}
