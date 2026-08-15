export type StudioErrorKind =
  | 'IMAGE_QUOTA_WAIT'
  | 'IMAGE_QUOTA_UNAVAILABLE'
  | 'TEXT_QUOTA'
  | 'NOT_CONFIGURED'
  | 'PUBLIC_URL_REQUIRED'
  | 'FB_LOGIN_REQUIRED'
  | 'IG_LOGIN_REQUIRED'
  | 'FB_POST_FAILED'
  | 'GENERIC';

export type ClassifiedStudioError = {
  kind: StudioErrorKind;
  code: string;
  retryAfterSeconds: number;
  title: string;
  message: string;
  action: string;
  quotaModel?: string;
  quotaLimit?: number;
};

function parseQuotaMeta(err: any) {
  const msg = String(err?.message || err?.raw?.error?.message || '');
  const model = String(
    msg.match(/model:\s*([a-z0-9._-]+)/i)?.[1] || err?.model || '',
  ).replace(/^models\//, '');
  const limit = Number(msg.match(/limit:\s*(\d+)/i)?.[1] || err?.quotaLimit || 0);
  return {
    model,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    label: friendlyGeminiName(model),
  };
}

function friendlyGeminiName(id: string) {
  const raw = String(id || '').replace(/^models\//, '').trim();
  if (!raw) return 'Gemini';
  return raw.replace(/^gemini-?/i, 'Gemini ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseRetrySeconds(err: any): number {
  const explicit = Number(err?.retryAfterSeconds);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(120, Math.ceil(explicit));
  const msg = String(err?.message || err?.raw?.error?.message || '');
  const named =
    msg.match(/retry in\s+~?([\d.]+)\s*s/i) ||
    msg.match(/wait\s+~?([\d.]+)\s*s/i);
  if (named) return Math.min(120, Math.ceil(Number(named[1])));
  const details = err?.raw?.error?.details;
  if (Array.isArray(details)) {
    for (const item of details) {
      const delay = item?.retryDelay || item?.retry_delay;
      if (typeof delay === 'string') {
        const m = delay.match(/([\d.]+)\s*s/i);
        if (m) return Math.min(120, Math.ceil(Number(m[1])));
      }
    }
  }
  return 0;
}

function isQuota(err: any, msg: string, code: string, status: number) {
  return (
    status === 429 ||
    code === 'RESOURCE_EXHAUSTED' ||
    /quota|rate limit|resource_exhausted|exhausted your current quota|free-tier may be 0/i.test(msg)
  );
}

function copyFor(
  kind: StudioErrorKind,
  seconds: number,
  module: string,
  quota: { model: string; limit: number; label: string },
): Pick<ClassifiedStudioError, 'title' | 'message' | 'action'> {
  const wait = Math.max(seconds, 1);
  const modelLabel = quota.label || 'Gemini';
  const limitBit = quota.limit > 0 ? ` (${quota.limit} requests)` : '';
  switch (kind) {
    case 'IMAGE_QUOTA_WAIT':
      return {
        title: 'Image generation is paused',
        message: `Google’s free image limit is full right now. Wait about ${wait} seconds, then retry.`,
        action: 'If it fails again, switch Image to Gemini 2.5 Flash Image, or enable billing for Nano Banana Pro in Google AI Studio.',
      };
    case 'IMAGE_QUOTA_UNAVAILABLE':
      return {
        title: 'This image model isn’t available on the free plan',
        message: 'Nano Banana Pro needs a billed Google AI Studio key. Switch Image to Gemini 2.5 Flash Image to keep generating for free.',
        action: 'Open the Image node → Model → Gemini 2.5 Flash Image, then retry. Or enable billing at https://aistudio.google.com',
      };
    case 'TEXT_QUOTA':
      return {
        title: 'Google paused writing — free limit is full',
        message: seconds
          ? `No post was written. ${modelLabel} on the free plan is out of requests${limitBit}. Wait ${wait} seconds, then tap Retry. Your API key is fine.`
          : `No post was written. ${modelLabel} on the free plan is out of requests${limitBit}. Wait a minute, then tap Retry. Your API key is fine.`,
        action: 'If it happens again: Content node → Model → Gemini 2.5 Flash. Or enable billing in Google AI Studio. You do not need a new API key.',
      };
    case 'NOT_CONFIGURED':
      return {
        title: 'This step is missing its API key',
        message: `Add the required key in Settings, then retry ${module}.`,
        action: module === 'facebook' || module === 'instagram'
          ? 'Use Browser publish, or save the page token in Settings.'
          : 'Open Settings → API keys, paste the key, Save, then retry.',
      };
    case 'PUBLIC_URL_REQUIRED':
      return {
        title: 'Instagram needs a public image link',
        message: 'The app cannot share a private image URL with Instagram.',
        action: 'Set AI_CONTENT_STUDIO_PUBLIC_BASE_URL on the server, then retry.',
      };
    case 'FB_LOGIN_REQUIRED':
      return {
        title: 'Facebook login is needed',
        message: 'So7baFit Chrome opened. Sign in there, then publish again.',
        action: 'Look for the Chrome popup — not your everyday browser — and log in once.',
      };
    case 'IG_LOGIN_REQUIRED':
      return {
        title: 'Instagram login is needed',
        message: 'So7baFit Chrome opened. Sign in there, then publish again.',
        action: 'Look for the Chrome popup — not your everyday browser — and log in once.',
      };
    case 'FB_POST_FAILED':
      return {
        title: 'Facebook did not publish yet',
        message: 'The draft is in the Chrome window. You can click Post there.',
        action: 'Finish the post in the So7baFit Chrome window, or click Publish Facebook again.',
      };
    default:
      return {
        title: `${module} failed`,
        message: 'This step stopped before it finished.',
        action: `Retry ${module}, or open Settings and check the provider.`,
      };
  }
}

export function classifyStudioError(e: any, module = 'pipeline'): ClassifiedStudioError {
  const msg = String(e?.message || e?.raw?.error?.message || '');
  const code = String(e?.code || e?.raw?.error?.status || 'ERROR');
  const status = Number(e?.status || 0);
  const retryAfterSeconds = parseRetrySeconds(e);
  const quota = parseQuotaMeta(e);
  const knownKind = String(e?.kind || '') as StudioErrorKind;
  const known: StudioErrorKind[] = [
    'IMAGE_QUOTA_WAIT',
    'IMAGE_QUOTA_UNAVAILABLE',
    'TEXT_QUOTA',
    'NOT_CONFIGURED',
    'PUBLIC_URL_REQUIRED',
    'FB_LOGIN_REQUIRED',
    'IG_LOGIN_REQUIRED',
    'FB_POST_FAILED',
    'GENERIC',
  ];

  let kind: StudioErrorKind = known.includes(knownKind) ? knownKind : 'GENERIC';

  if (kind === 'GENERIC') {
    if (code === 'NOT_CONFIGURED') kind = 'NOT_CONFIGURED';
    else if (code === 'PUBLIC_URL_REQUIRED') kind = 'PUBLIC_URL_REQUIRED';
    else if (code === 'FB_LOGIN_REQUIRED') kind = 'FB_LOGIN_REQUIRED';
    else if (code === 'IG_LOGIN_REQUIRED') kind = 'IG_LOGIN_REQUIRED';
    else if (code === 'FB_POST_CLICK_FAILED' || code === 'FB_NOT_POSTED') kind = 'FB_POST_FAILED';
    else if (isQuota(e, msg, code, status)) {
      const imageish = module === 'image' || /image|nano banana|gemini-.*-image/i.test(msg);
      const hardZero = /limit:\s*0|free-tier may be 0/i.test(msg);
      if (imageish && retryAfterSeconds > 0) kind = 'IMAGE_QUOTA_WAIT';
      else if (imageish && hardZero) kind = 'IMAGE_QUOTA_UNAVAILABLE';
      else if (imageish) kind = 'IMAGE_QUOTA_UNAVAILABLE';
      else kind = 'TEXT_QUOTA';
    }
  }

  const copy = copyFor(kind, retryAfterSeconds, module, quota);
  return {
    kind,
    code: code || 'ERROR',
    retryAfterSeconds,
    quotaModel: quota.model,
    quotaLimit: quota.limit,
    ...copy,
  };
}
