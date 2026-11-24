/** Shared constants for the ProjectMind module. */

export const PM_LIMITS = {
	/** Max uploaded ZIP size (compressed). */
	maxZipBytes: 100 * 1024 * 1024,
	/** Max total uncompressed bytes read from one archive (ZIP-bomb guard). */
	maxUncompressedBytes: 400 * 1024 * 1024,
	/** Max entries in one archive. */
	maxEntries: 30_000,
	/** Max compression ratio per entry before it is treated as a bomb. */
	maxEntryRatio: 200,
	/** Files above this size are listed but not indexed. */
	maxIndexedFileBytes: 512 * 1024,
	/** Max indexed files per project. */
	maxIndexedFiles: 8_000,
	/** Chunk sizing. */
	chunkTargetLines: 70,
	chunkOverlapLines: 8,
	chunkMaxChars: 6_000,
	/** Retrieval. */
	retrievalTopK: 8,
	/** Max question length. */
	maxQuestionChars: 2_000,
	/** Max concurrent analysis jobs per process. */
	maxConcurrentJobs: 2,
} as const;

/** Exact wording required when evidence is insufficient. */
export const INSUFFICIENT_EVIDENCE_TEXT =
	"I couldn't verify this from the current codebase. More investigation is required before providing a definitive answer.";

export const PROJECT_STATUSES = ['draft', 'importing', 'analyzing', 'ready', 'failed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const GAP_STATUSES = ['not_started', 'investigating', 'understood', 'documented', 'resolved'] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export const GAP_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type GapPriority = (typeof GAP_PRIORITIES)[number];

export const NOTE_KINDS = ['question', 'answer', 'decision', 'follow_up', 'unresolved'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const ANSWER_STYLES = ['business', 'client', 'technical'] as const;
export type AnswerStyle = (typeof ANSWER_STYLES)[number];

export const SIM_SCENARIOS = ['client', 'technical_lead', 'manager', 'new_developer'] as const;
export type SimScenario = (typeof SIM_SCENARIOS)[number];

export const SIM_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type SimDifficulty = (typeof SIM_DIFFICULTIES)[number];

/** Simulator scoring dimensions, each 0-20 → total /100. */
export const SIM_DIMENSIONS = ['accuracy', 'clarity', 'completeness', 'evidence', 'confidence'] as const;

export const SIM_QUESTIONS_PER_SESSION = 5;

export const PM_AI_FEATURE = 'projectmind.chat';
