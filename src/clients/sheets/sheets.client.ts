import { createSign } from 'crypto';
import { env } from 'lua-cli';

export const CHECKINS_TAB = 'checkins';
export const CHECKINS_HEADER = [
  'timestamp',
  'date',
  'team_lead_id',
  'team_lead_name',
  'employee_id',
  'employee_name',
  'department',
  'country',
  'accomplished',
  'blockers',
  'rating',
  'channel',
  'language',
] as const;

/** Column index for each checkins field, so tools never hardcode magic numbers. */
export const CHECKINS_COL = Object.fromEntries(CHECKINS_HEADER.map((name, i) => [name, i])) as Record<
  (typeof CHECKINS_HEADER)[number],
  number
>;

export const WEEKLY_DIGEST_TAB = 'weekly_digest';
export const WEEKLY_DIGEST_HEADER = [
  'week_start',
  'team_lead_name',
  'employee_name',
  'avg_rating',
  'checkin_count',
  'top_blocker',
] as const;

/**
 * Thin Google Sheets client using raw fetch + a hand-signed service-account
 * JWT, not the googleapis SDK. The SDK's HTTP transport (gaxios) needs
 * `ReadableStream`, which isn't present in Lua's tool execution sandbox —
 * fetch and node:crypto are, so this talks to the REST API directly.
 * Never silently no-ops — every failure throws a readable error, per PRD §8.
 */

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getCredentials(): { client_email: string; private_key: string } {
  const b64 = env('GOOGLE_SERVICE_ACCOUNT_JSON_B64');
  if (!b64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_B64 is not set — cannot authenticate to Google Sheets.');
  }
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (err) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON_B64 is not valid base64-encoded JSON: ${(err as Error).message}`);
  }
}

function getSheetId(): string {
  const id = env('GOOGLE_SHEET_ID');
  if (!id) throw new Error('GOOGLE_SHEET_ID is not set — cannot locate the performance-tracking spreadsheet.');
  return id;
}

/** Signs a Google service-account JWT and exchanges it for a bearer access token. */
async function getAccessToken(): Promise<string> {
  const creds = getCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = base64url(createSign('RSA-SHA256').update(`${header}.${claims}`).sign(creds.private_key));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth token request failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function sheetsFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API_BASE}/${getSheetId()}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Google Sheets API request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function ensureHeader(tab: string, header: readonly string[]) {
  const lastCol = String.fromCharCode(64 + header.length);
  const range = `${tab}!A1:${lastCol}1`;
  const existing = await sheetsFetch(`/values/${encodeURIComponent(range)}`);
  if (!existing.values || existing.values.length === 0) {
    await sheetsFetch(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: { values: [header] },
    });
  }
}

/** Appends one row to the checkins tab, creating the header row if this is the first write. */
export async function appendCheckinRow(row: string[]): Promise<void> {
  try {
    await ensureHeader(CHECKINS_TAB, CHECKINS_HEADER);
    await sheetsFetch(
      `/values/${encodeURIComponent(`${CHECKINS_TAB}!A:A`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: { values: [row] } },
    );
  } catch (err) {
    throw new Error(`Failed to write check-in to Google Sheets: ${(err as Error).message}`);
  }
}

/** Returns every checkins data row (excluding the header) as raw string arrays. */
export async function getCheckinRows(): Promise<string[][]> {
  try {
    const lastCol = String.fromCharCode(64 + CHECKINS_HEADER.length);
    const range = `${CHECKINS_TAB}!A2:${lastCol}`;
    const result = await sheetsFetch(`/values/${encodeURIComponent(range)}`);
    return result.values ?? [];
  } catch (err) {
    throw new Error(`Failed to read check-ins from Google Sheets: ${(err as Error).message}`);
  }
}
