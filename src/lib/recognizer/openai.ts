import { postJson, sleep, throwForStatus, TransientError } from './http';
import type { RecognitionTask } from './tasks';
import { FoodRecognizer, RecognizeInput, RecognizerError } from './types';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;

type ResponsesResponse = {
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  error?: { message?: string };
};

export class OpenAIRecognizer implements FoodRecognizer {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async run<T>(task: RecognitionTask<T>, input: RecognizeInput): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (attempt > 1) input.onStatus?.('伺服器忙碌，重試中…');
      try {
        return task.parse(await this.request(task, input));
      } catch (e) {
        if (!(e instanceof TransientError)) throw e;
        lastError = e;
        if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
      }
    }
    throw new RecognizerError(`OpenAI 目前無法使用，請稍後再試。（${lastError?.message ?? ''}）`);
  }

  private async request(task: RecognitionTask<unknown>, { imageBase64, mimeType, hint }: RecognizeInput) {
    const { res, json } = await postJson(
      ENDPOINT,
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        store: false,
        reasoning: { effort: 'low' },
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: task.prompt(hint) },
              { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}` },
            ],
          },
        ],
        text: {
          format: { type: 'json_schema', name: task.name, strict: true, schema: task.strictSchema },
        },
      },
    );
    const body = json as ResponsesResponse;
    if (!res.ok) throwForStatus('OpenAI', res.status, body.error?.message ?? String(res.status));

    const parts = body.output?.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []) ?? [];
    const refusal = parts.find((p) => p.type === 'refusal')?.refusal;
    if (refusal) throw new RecognizerError(`OpenAI 拒絕回答：${refusal}`);
    const text = parts
      .filter((p) => p.type === 'output_text')
      .map((p) => p.text ?? '')
      .join('');
    if (!text) throw new RecognizerError('OpenAI 沒有回傳結果。');
    return text;
  }
}
