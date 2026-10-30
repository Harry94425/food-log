import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';

// 用網頁版授權頁：在 App 內的 WebView 打開，行動版會想跳去 Strava App
const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';

const CLIENT_ID = 'strava_client_id';
const CLIENT_SECRET = 'strava_client_secret';
const TOKENS = 'strava_tokens';

type Tokens = { access_token: string; refresh_token: string; expires_at: number; athlete_name: string };

export type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  /** 本地時間的 YYYY-MM-DD */
  date: string;
  /** Strava 記錄的消耗；沒有就用功（kJ）估 */
  kcal: number;
};

export class StravaError extends Error {}

/**
 * 授權完導回的網址。localhost 是 Strava 一律接受的網域，Expo Go 和 APK 都一樣；
 * 這個網址不會真的打開，WebView 看到要前往它時就攔下來取授權碼。
 */
export const REDIRECT_URI = 'http://localhost/strava-auth';
export const CALLBACK_DOMAIN = 'localhost';

export async function getCredentials() {
  const [id, secret] = await Promise.all([
    SecureStore.getItemAsync(CLIENT_ID),
    SecureStore.getItemAsync(CLIENT_SECRET),
  ]);
  return { id: id ?? '', secret: secret ?? '' };
}

export async function saveCredentials(id: string, secret: string) {
  await SecureStore.setItemAsync(CLIENT_ID, id);
  await SecureStore.setItemAsync(CLIENT_SECRET, secret);
}

async function getTokens(): Promise<Tokens | null> {
  const raw = await SecureStore.getItemAsync(TOKENS);
  return raw ? (JSON.parse(raw) as Tokens) : null;
}

async function saveTokens(t: Tokens) {
  await SecureStore.setItemAsync(TOKENS, JSON.stringify(t));
}

/** 已連結時回傳 Strava 上的名字 */
export async function connectedAthlete() {
  return (await getTokens())?.athlete_name ?? null;
}

export async function disconnect() {
  await SecureStore.deleteItemAsync(TOKENS);
}

async function tokenRequest(params: Record<string, string>, athleteName?: string): Promise<Tokens> {
  const { id, secret } = await getCredentials();
  if (!id || !secret) throw new StravaError('請先填 Strava 的 Client ID 和 Client Secret。');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: id, client_secret: secret, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new StravaError(`Strava 授權失敗：${body.message ?? res.status}`);
  const name = body.athlete ? `${body.athlete.lastname ?? ''}${body.athlete.firstname ?? ''}` : athleteName;
  const tokens: Tokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at,
    athlete_name: name || 'Strava',
  };
  await saveTokens(tokens);
  return tokens;
}

export function authorizeUrl(clientId: string) {
  return (
    `${AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&approval_prompt=auto&scope=activity:read_all`
  );
}

/** 用導回網址裡的授權碼換 token */
export async function completeAuthorization(redirectedUrl: string) {
  const params = Linking.parse(redirectedUrl).queryParams ?? {};
  const param = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '');
  if (param('error')) throw new StravaError('你在 Strava 拒絕了授權。');
  const code = param('code');
  if (!code) throw new StravaError('Strava 沒有回傳授權碼。');
  if (!param('scope').includes('activity:read')) {
    throw new StravaError('需要勾選「查看活動」權限才能同步。');
  }
  await tokenRequest({ code, grant_type: 'authorization_code' });
}

/** 取得有效的 access token，快過期就自動換新 */
async function accessToken(): Promise<string> {
  const t = await getTokens();
  if (!t) throw new StravaError('還沒連結 Strava。');
  if (t.expires_at - 60 > Date.now() / 1000) return t.access_token;
  const fresh = await tokenRequest({ refresh_token: t.refresh_token, grant_type: 'refresh_token' }, t.athlete_name);
  return fresh.access_token;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 401) throw new StravaError('Strava 授權失效，請到設定重新連結。');
  if (res.status === 429) throw new StravaError('Strava 請求太頻繁，請 15 分鐘後再試。');
  if (!res.ok) throw new StravaError(`Strava 錯誤 (${res.status})`);
  return res.json() as Promise<T>;
}

type SummaryActivity = { id: number; name: string; sport_type: string; start_date_local: string };
type DetailedActivity = SummaryActivity & { calories?: number; kilojoules?: number };

/** 列出某時間之後的活動 id（不含熱量，熱量要另外查） */
export async function listActivitiesSince(afterEpochSec: number): Promise<SummaryActivity[]> {
  const all: SummaryActivity[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await api<SummaryActivity[]>(`/athlete/activities?after=${afterEpochSec}&per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/** 列表沒有熱量，只有單筆詳細資料才有 */
export async function getActivity(id: number): Promise<StravaActivity> {
  const a = await api<DetailedActivity>(`/activities/${id}`);
  return {
    id: a.id,
    name: a.name,
    sport_type: a.sport_type,
    // Strava 的 start_date_local 雖然帶 Z，其實是當地時間
    date: a.start_date_local.slice(0, 10),
    kcal: Math.round(a.calories || a.kilojoules || 0),
  };
}
