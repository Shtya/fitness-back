/**
 * English-course lectures ("days"): the video link, the transcript, the words you picked out
 * (meaning, Arabic, example), your questions and answers, and your speaking sessions.
 * Stored as one jsonb object on the lecture; this file cleans it and builds the AI prompts.
 */

export const COURSE_KINDS = ['general', 'english'] as const;
export type CourseKind = (typeof COURSE_KINDS)[number];

export const EN_MAX_TRANSCRIPT = 200_000;
export const EN_MAX_WORDS = 400;
export const EN_MAX_QUESTIONS = 120;
export const EN_MAX_SPEAKING = 200;
export const EN_MAX_SPOKEN = 20_000;

/** `example`: a sentence to remember it by; `context`: the sentence from the video where you met it. */
export type EnglishWord = { id: string; text: string; meaning: string; translation: string; example: string; context: string; createdAt: number; fav: boolean };
export type EnglishQuestion = { id: string; q: string; a: string; source: 'own' | 'ai'; createdAt: number };
/** One correction of what you said: the words you used, the better version, why, and whether you ticked it as learned. */
export type EnglishFix = { id: string; wrong: string; right: string; why: string; kind: string; done: boolean };
/** The AI's overall look at what you said. */
export type EnglishAnalysis = { summary: string; level: string; tips: string[] };
/** A later try at the same talk (the original stays as it was). */
export type EnglishVersion = { id: string; at: number; text: string; corrected: string; fixes: EnglishFix[]; analysis: EnglishAnalysis | null };
/** A speaking session: `text` is what you said (speech-to-text, editable), `fixes` the corrections. */
export type EnglishSpeaking = {
	id: string;
	at: number;
	seconds: number;
	prompt: string;
	text: string;
	corrected: string;
	fixes: EnglishFix[];
	analysis: EnglishAnalysis | null;
	versions: EnglishVersion[];
};
export type EnglishDay = {
	videoUrl: string;
	transcript: string;
	words: EnglishWord[];
	questions: EnglishQuestion[];
	speaking: EnglishSpeaking[];
	/** words from the transcript tables you ticked as learned (lower-case) */
	learned: string[];
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,48}$/.test(v) ? v : '');
const num = (v: unknown, max = Number.MAX_SAFE_INTEGER) => {
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n)) : 0;
};
const list = (v: unknown) => (Array.isArray(v) ? v : []);
export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

const fixesOf = (v: unknown) =>
	list(v)
		.map((f: any, i: number) =>
			f && typeof f === 'object'
				? { id: id(f.id) || `f${i}`, wrong: str(f.wrong, 300), right: str(f.right, 300), why: str(f.why, 600), kind: str(f.kind, 60), done: Boolean(f.done) }
				: null,
		)
		.filter((f): f is EnglishFix => Boolean(f && (f.wrong || f.right)))
		.slice(0, 60);

const analysisOf = (v: unknown): EnglishAnalysis | null => {
	if (!v || typeof v !== 'object') return null;
	const o = v as Record<string, unknown>;
	const level = str(o.level, 4).toUpperCase();
	const out = {
		summary: str(o.summary, 1500).trim(),
		level: (CEFR as readonly string[]).includes(level) ? level : '',
		tips: list(o.tips)
			.map(t => str(t, 300).trim())
			.filter(Boolean)
			.slice(0, 5),
	};
	return out.summary || out.level || out.tips.length ? out : null;
};

export function emptyEnglish(): EnglishDay {
	return { videoUrl: '', transcript: '', words: [], questions: [], speaking: [], learned: [] };
}

/** Anything the client sends becomes a well-formed day (unknown keys dropped, limits applied). */
export function normalizeEnglish(raw: unknown): EnglishDay {
	const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const seen = new Set<string>();
	const unique = <T extends { id: string }>(x: T | null): x is T => {
		if (!x || !x.id || seen.has(x.id)) return false;
		seen.add(x.id);
		return true;
	};
	return {
		videoUrl: str(v.videoUrl, 600).trim(),
		transcript: str(v.transcript, EN_MAX_TRANSCRIPT),
		words: list(v.words)
			.map((w: any) =>
				w && typeof w === 'object'
					? {
							id: id(w.id),
							text: str(w.text, 120).trim(),
							meaning: str(w.meaning, 600),
							translation: str(w.translation, 300),
							example: str(w.example, 800),
							context: str(w.context, 800),
							createdAt: num(w.createdAt),
							fav: Boolean(w.fav),
						}
					: null,
			)
			.filter(unique)
			.filter(w => w.text)
			.slice(0, EN_MAX_WORDS),
		questions: list(v.questions)
			.map((q: any) =>
				q && typeof q === 'object'
					? { id: id(q.id), q: str(q.q, 1000), a: str(q.a, 6000), source: q.source === 'ai' ? ('ai' as const) : ('own' as const), createdAt: num(q.createdAt) }
					: null,
			)
			.filter(unique)
			.slice(0, EN_MAX_QUESTIONS),
		learned: [...new Set(list(v.learned).map(x => str(x, 120).trim().toLowerCase()).filter(Boolean))].slice(0, 2000),
		speaking: list(v.speaking)
			.map((s: any) =>
				s && typeof s === 'object'
					? {
							id: id(s.id),
							at: num(s.at),
							seconds: num(s.seconds, 3600),
							prompt: str(s.prompt, 600),
							text: str(s.text, EN_MAX_SPOKEN),
							corrected: str(s.corrected, EN_MAX_SPOKEN),
							fixes: fixesOf(s.fixes),
							analysis: analysisOf(s.analysis),
							versions: list(s.versions)
								.map((x: any) =>
									x && typeof x === 'object'
										? { id: id(x.id), at: num(x.at), text: str(x.text, EN_MAX_SPOKEN), corrected: str(x.corrected, EN_MAX_SPOKEN), fixes: fixesOf(x.fixes), analysis: analysisOf(x.analysis) }
										: null,
								)
								.filter((x): x is EnglishVersion => Boolean(x && x.id))
								.slice(0, 12),
						}
					: null,
			)
			.filter(unique)
			.slice(-EN_MAX_SPEAKING),
	};
}

/* ───── AI ───── */

export const EN_AI_SYSTEM =
	'You are a friendly English teacher for an Arabic-speaking (Egyptian) learner at an intermediate level. ' +
	'Always answer with one JSON object only, no markdown, no commentary.';

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** Speaking / discussion questions about the day's topic, using its words when natural. */
export function questionsPrompt(input: { topic: string; transcript?: string; words?: string[]; count?: number; existing?: string[] }) {
	const count = Math.min(10, Math.max(3, Number(input.count) || 6));
	return [
		`Topic of today's lesson: "${clip(input.topic, 200)}".`,
		input.transcript ? `Part of the video transcript:\n"""${clip(input.transcript, 3500)}"""` : '',
		input.words?.length ? `Words the learner is practising today: ${input.words.slice(0, 40).join(', ')}.` : '',
		input.existing?.length ? `Do not repeat these questions: ${input.existing.slice(0, 30).map(q => `"${clip(q, 140)}"`).join('; ')}.` : '',
		`Write ${count} open questions the learner can answer out loud for 30–90 seconds each, about the topic and their own life.`,
		'Mix easy and slightly harder ones; use some of the practice words where natural. Keep each question under 25 words.',
		'Return: {"questions": ["...", "..."]}',
	]
		.filter(Boolean)
		.join('\n');
}

/** Meaning of a word or phrase as used in a sentence. */
export function wordPrompt(input: { word: string; context?: string }) {
	return [
		`Word or phrase: "${clip(input.word, 120)}".`,
		input.context ? `It appears in this sentence: "${clip(input.context, 500)}".` : '',
		'Explain it for this learner, as it is used here.',
		'Return: {"translation": "short Arabic translation (Egyptian or Modern Standard)", "meaning": "simple English definition, max 15 words", "examples": ["2 new natural, everyday example sentences, max 16 words each"]}',
	]
		.filter(Boolean)
		.join('\n');
}

/** First JSON object in a model reply (tolerates code fences and chatter). */
export function parseJsonObject(text: string): Record<string, any> | null {
	const t = String(text || '')
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```\s*$/i, '');
	const s = t.indexOf('{');
	const e = t.lastIndexOf('}');
	if (s < 0 || e <= s) return null;
	try {
		const o = JSON.parse(t.slice(s, e + 1));
		return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
	} catch {
		return null;
	}
}

export function readQuestions(o: Record<string, any> | null): string[] {
	return list(o?.questions)
		.map(q => (typeof q === 'string' ? q.trim() : ''))
		.filter(q => q && q.length <= 400)
		.slice(0, 10);
}

/** Corrections of something the learner said out loud (from speech-to-text). */
export function correctPrompt(input: { text: string; topic?: string }) {
	return [
		input.topic ? `The learner was talking about: "${clip(input.topic, 200)}".` : '',
		`This is what they said (automatic speech-to-text, so ignore missing punctuation and capital letters):\n"""${clip(input.text, 6000)}"""`,
		'Find the real English mistakes (grammar, tense, wrong word, unnatural phrasing, missing words, prepositions, articles). Ignore filler words like "um". Max 15 mistakes, most useful first.',
		'For each one give: the exact words they used ("wrong"), the corrected words ("right"), the grammar point in 1-3 words ("kind", e.g. "Past simple", "Present perfect", "Word choice", "Article", "Preposition", "Word order", "Plural", "Collocation"), and "why": one or two short sentences in simple English that teach the rule (e.g. "Use the past simple for a finished time like yesterday: go → went").',
		'Also give the whole text corrected ("corrected"), keeping their meaning and level — do not make it fancier.',
		'Then look at the whole talk: "summary" — 2-3 short sentences on how they did and the main thing to work on; "level" — their CEFR level (A1, A2, B1, B2, C1 or C2); "tips" — up to 3 short, concrete tips for next time.',
		'Return: {"corrected": "...", "fixes": [{"wrong": "...", "right": "...", "kind": "...", "why": "..."}], "summary": "...", "level": "B1", "tips": ["..."]}',
	]
		.filter(Boolean)
		.join('\n');
}

export function readCorrection(o: Record<string, any> | null) {
	if (!o) return null;
	const fixes = list(o.fixes)
		.map((f: any) =>
			f && typeof f === 'object' ? { wrong: str(f.wrong, 300).trim(), right: str(f.right, 300).trim(), kind: str(f.kind, 60).trim(), why: str(f.why, 600).trim() } : null,
		)
		.filter((f): f is { wrong: string; right: string; kind: string; why: string } => Boolean(f && f.right && f.wrong !== f.right))
		.slice(0, 15);
	return { corrected: str(o.corrected, EN_MAX_SPOKEN).trim(), fixes, analysis: analysisOf(o) };
}

export function readWord(o: Record<string, any> | null) {
	if (!o) return null;
	const translation = str(o.translation, 300).trim();
	const meaning = str(o.meaning, 600).trim();
	if (!meaning && !translation) return null;
	const examples = [...list(o.examples), o.example]
		.map(e => (typeof e === 'string' ? e.trim() : ''))
		.filter((e, i, a) => e && e.length <= 300 && a.indexOf(e) === i)
		.slice(0, 3);
	return { meaning, translation, example: examples[0] || '', examples };
}
