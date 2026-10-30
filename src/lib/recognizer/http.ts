import { Recognition, RecognizerError } from './types';

const TIMEOUT_MS = 45_000;

/** 伺服器忙線、逾時或斷線，可以重試 */
export class TransientError extends RecognizerError {}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 送出 JSON 請求；逾時或連線失敗丟 TransientError */
export async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new TransientError('逾時');
    throw new TransientError(`連線失敗：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 依 HTTP 狀態碼丟出對應錯誤 */
export function throwForStatus(provider: string, status: number, detail: string): never {
  if (status >= 500) throw new TransientError(`${status} ${detail}`);
  if (status === 429) throw new RecognizerError(`${provider} 額度暫時用完或請求太頻繁，請稍後再試。（${detail}）`);
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    throw new RecognizerError(`${provider} API 金鑰或模型設定有誤：${detail}`);
  }
  throw new RecognizerError(`${provider} 錯誤 (${status})：${detail}`);
}

export function parseRecognition(text: string): Recognition {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RecognizerError('無法解析 AI 回傳的內容。');
  }
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.round(v * 10) / 10) : 0);
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return {
    title: String(raw?.title ?? ''),
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
