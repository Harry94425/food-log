export type FoodItem = {
  name: string;
  portion: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

export type Recognition = {
  items: FoodItem[];
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
  recognize(input: RecognizeInput): Promise<Recognition>;
}

export class RecognizerError extends Error {}
