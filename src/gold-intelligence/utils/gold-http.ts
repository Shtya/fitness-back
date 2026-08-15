import axios, { AxiosRequestConfig } from 'axios';

export const GOLD_UA =
  'So7baFitGoldIntelligence/1.0 (+https://so7bafit.com; research terminal; not a scraper bot)';

export async function goldHttpGet<T = any>(
  url: string,
  config: AxiosRequestConfig = {},
): Promise<{ data: T; status: number; latencyMs: number }> {
  const started = Date.now();
  const { headers, timeout, ...rest } = config;
  const response = await axios.get<T>(url, {
    timeout: timeout ?? 20000,
    maxRedirects: 5,
    validateStatus: () => true,
    ...rest,
    headers: {
      Accept: 'application/json,text/csv,text/plain,application/xml,*/*',
      'User-Agent': GOLD_UA,
      ...(headers || {}),
    },
  });
  return {
    data: response.data,
    status: response.status,
    latencyMs: Date.now() - started,
  };
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && value.trim() !== '.') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
