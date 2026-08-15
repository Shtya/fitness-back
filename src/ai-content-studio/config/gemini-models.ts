/**
 * Central Gemini model map for the Content Studio.
 * Change models here — pipeline/UI read from this file (and the frontend mirror in studio-ui-meta.js).
 */
export const GEMINI_MODELS = {
  brandAnalysis: 'gemini-2.5-flash',
  trending: 'gemini-2.5-flash',
  searchQueries: 'gemini-2.5-flash',
  researchAnalysis: 'gemini-2.5-flash',
  topic: 'gemini-2.5-flash',
  content: 'gemini-2.5-pro',
  imagePrompt: 'gemini-2.5-flash',
  image: 'gemini-3-pro-image',
  imageFallback: 'gemini-2.5-flash-image',
  validation: 'gemini-2.5-flash',
} as const;

export type GeminiStudioTask = keyof typeof GEMINI_MODELS;

export function geminiModelFor(task: GeminiStudioTask): string {
  return GEMINI_MODELS[task];
}
