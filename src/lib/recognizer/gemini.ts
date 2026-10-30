import { FOOD_PROMPT, RECOGNITION_SCHEMA } from './prompt';
import { FoodRecognizer, RecognizeInput, Recognition, RecognizerError } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

type InteractionResponse = {
  status?: string;
  steps?: { type: string; content?: { type: string; text?: string }[] }[];
  error?: { message?: string };
};

export class GeminiRecognizer implements FoodRecognizer {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async recognize({ imageBase64, mimeType, hint }: RecognizeInput): Promise<Recognition> {
    const prompt = hint ? `${FOOD_PROMPT}\n\n使用者補充：${hint}` : FOOD_PROMPT;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        store: false,
        input: [
          { type: 'text', text: prompt },
          { type: 'image', data: imageBase64, mime_type: mimeType },
        ],
        response_format: { type: 'text', mime_type: 'application/json', schema: RECOGNITION_SCHEMA },
      }),
    });

    const body = (await res.json().catch(() => ({}))) as InteractionResponse;
    if (!res.ok) {
      if (res.status === 429) throw new RecognizerError('Gemini 免費額度暫時用完，請稍後再試。');
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new RecognizerError(`API 金鑰或模型設定有誤：${body.error?.message ?? res.status}`);
      }
      throw new RecognizerError(`Gemini 錯誤 (${res.status})：${body.error?.message ?? '未知錯誤'}`);
    }

    const output = body.steps?.filter((s) => s.type === 'model_output').pop();
    const text = output?.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (!text) throw new RecognizerError('Gemini 沒有回傳結果。');

    try {
      return normalize(JSON.parse(text));
    } catch {
      throw new RecognizerError('無法解析 Gemini 回傳的內容。');
    }
  }
}

function normalize(raw: any): Recognition {
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.round(v * 10) / 10) : 0);
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return {
    items: items.map((i: any) => ({
      name: String(i?.name ?? '未知食物'),
      portion: String(i?.portion ?? ''),
      kcal: Math.round(num(i?.kcal)),
      protein: num(i?.protein),
      fat: num(i?.fat),
      carbs: num(i?.carbs),
    })),
    note: String(raw?.note ?? ''),
  };
}
