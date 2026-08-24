import { createHash, randomInt } from "crypto";

const ARABIC_RE = /[\u0600-\u06FF]/;
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeLookupText(raw: string): string {
  return String(raw || "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function uniquenessKey(text: string): string {
  const normalized = normalizeLookupText(text);
  if (!normalized) return "";
  if (ARABIC_RE.test(normalized)) return normalized;
  return normalized.toLocaleLowerCase("en");
}

export function detectLang(text: string): "ar" | "en" {
  return ARABIC_RE.test(text) ? "ar" : "en";
}

export function isSingleWord(text: string): boolean {
  return normalizeLookupText(text).split(" ").filter(Boolean).length === 1;
}

export function hashPairingCode(code: string): string {
  return createHash("sha256")
    .update(
      String(code || "")
        .trim()
        .toUpperCase(),
    )
    .digest("hex");
}

export function randomPairingCode(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  }
  return out;
}

export function websiteOrigin(raw?: string | null): string {
  const first = String(
    raw || process.env.FRONTEND_URL || "https://so7bafit.com",
  )
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .find(Boolean);
  return first || "https://so7bafit.com";
}

export function parseDictionaryEntry(payload: any): {
  pronunciation: string | null;
  partOfSpeech: string | null;
  example: string | null;
} {
  const entry = Array.isArray(payload) ? payload[0] : payload;
  if (!entry || typeof entry !== "object") {
    return { pronunciation: null, partOfSpeech: null, example: null };
  }
  const pronunciation =
    String(entry.phonetic || "").trim() ||
    (Array.isArray(entry.phonetics)
      ? entry.phonetics
          .map((p: any) => String(p?.text || "").trim())
          .find(Boolean)
      : "") ||
    null;
  const meanings = Array.isArray(entry.meanings) ? entry.meanings : [];
  const first = meanings[0] || {};
  const defs = Array.isArray(first.definitions) ? first.definitions : [];
  return {
    pronunciation,
    partOfSpeech: first.partOfSpeech ? String(first.partOfSpeech) : null,
    example:
      defs.map((d: any) => String(d?.example || "").trim()).find(Boolean) ||
      null,
  };
}

export function parseAiEnrichment(raw: string): {
  pronunciation: string | null;
  partOfSpeech: string | null;
  example: string | null;
} {
  const match = String(raw || "").match(/\{[\s\S]*\}/);
  if (!match) return { pronunciation: null, partOfSpeech: null, example: null };
  try {
    const json = JSON.parse(match[0]);
    return {
      pronunciation: json.pronunciation
        ? String(json.pronunciation).slice(0, 120)
        : null,
      partOfSpeech: json.partOfSpeech
        ? String(json.partOfSpeech).slice(0, 64)
        : null,
      example: json.example ? String(json.example).slice(0, 400) : null,
    };
  } catch {
    return { pronunciation: null, partOfSpeech: null, example: null };
  }
}
