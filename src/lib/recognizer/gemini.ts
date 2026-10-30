import { parseRecognition, postJson, sleep, throwForStatus, TransientError } from './http';
import { buildPrompt, RECOGNITION_SCHEMA } from './prompt';
import { FoodRecognizer, RecognizeInput, Recognition, RecognizerError } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
/** 每個模型最多試幾次（遇到 503 等暫時性錯誤才重試） */
const ATTEMPTS_PER_MODEL = 2;
const RETRY_DELAY_MS = 2_000;
/** 主模型一直忙線時改用的備用模型（同樣有免費額度） */
export const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

type InteractionResponse = {
  steps?: { type: string; content?: { type: string; text?: string }[] }[];
  error?: { message?: string };
};

export class GeminiRecognizer implements FoodRecognizer {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async recognize(input: RecognizeInput): Promise<Recognition> {
    const models = this.model === GEMINI_FALLBACK_MODEL ? [this.model] : [this.model, GEMINI_FALLBACK_MODEL];
    let lastError: Error | null = null;

    for (const model of models) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
        if (model !== this.model || attempt > 1) {
          input.onStatus?.(`伺服器忙碌，重試中（${model}）…`);
        }
        try {
          return await this.request(model, input);
        } catch (e) {
          if (!(e instanceof TransientError)) throw e;
          lastError = e;
          if (attempt < ATTEMPTS_PER_MODEL) await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }
    throw new RecognizerError(`Gemini 目前太忙，請過幾分鐘再試，或到設定改用 GPT。（${lastError?.message ?? ''}）`);
  }

  private async request(model: string, { imageBase64, mimeType, hint }: RecognizeInput): Promise<Recognition> {
    const { res, json } = await postJson(
      ENDPOINT,
      { 'x-goog-api-key': this.apiKey },
      {
        model,
        store: false,
        input: [
          { type: 'text', text: buildPrompt(hint) },
          { type: 'image', data: imageBase64, mime_type: mimeType },
        ],
        // 估熱量不需要深度推理，低思考量比較快
        generation_config: { thinking_level: 'low' },
        response_format: { type: 'text', mime_type: 'application/json', schema: RECOGNITION_SCHEMA },
      },
    );
    const body = json as InteractionResponse;
    if (!res.ok) throwForStatus('Gemini', res.status, body.error?.message ?? String(res.status));

    const output = body.steps?.filter((s) => s.type === 'model_output').pop();
    const text = output?.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (!text) throw new RecognizerError('Gemini 沒有回傳結果。');
    return parseRecognition(text);
  }
}
