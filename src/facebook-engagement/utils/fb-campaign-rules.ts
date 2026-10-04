import { FbCampaignStatus, FbCommentStatus } from '../entities/facebook-engagement.entity';

export const EDITABLE_COMMENT_STATUSES: readonly FbCommentStatus[] = [
	FbCommentStatus.DRAFT,
	FbCommentStatus.FAILED,
	FbCommentStatus.CANCELLED,
];

export const PUBLISHABLE_COMMENT_STATUSES: readonly FbCommentStatus[] = EDITABLE_COMMENT_STATUSES;

export type CommentStatusCounts = Record<FbCommentStatus, number>;

export function emptyStatusCounts(): CommentStatusCounts {
	return {
		[FbCommentStatus.DRAFT]: 0,
		[FbCommentStatus.PENDING]: 0,
		[FbCommentStatus.PROCESSING]: 0,
		[FbCommentStatus.PUBLISHED]: 0,
		[FbCommentStatus.FAILED]: 0,
		[FbCommentStatus.CANCELLED]: 0,
	};
}

export function normalizeCommentMessage(message: string) {
	return String(message ?? '')
		.normalize('NFKC')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

export function deriveCampaignStatus(counts: CommentStatusCounts, current: FbCampaignStatus): FbCampaignStatus {
	const { pending, processing, published, failed, cancelled } = counts;
	if (processing > 0) return FbCampaignStatus.PROCESSING;
	if (pending > 0) return published + failed > 0 ? FbCampaignStatus.PROCESSING : FbCampaignStatus.QUEUED;
	if (current === FbCampaignStatus.CANCELLED) return FbCampaignStatus.CANCELLED;
	if (published + failed === 0) return cancelled > 0 ? FbCampaignStatus.CANCELLED : FbCampaignStatus.DRAFT;
	if (failed === 0) return FbCampaignStatus.COMPLETED;
	if (published === 0) return FbCampaignStatus.FAILED;
	return FbCampaignStatus.COMPLETED_WITH_ERRORS;
}

export function isActiveCampaignStatus(status: FbCampaignStatus) {
	return status === FbCampaignStatus.QUEUED || status === FbCampaignStatus.PROCESSING;
}

/** Spreads jobs `pacingSeconds` apart, never earlier than `earliest`. */
export function planRunTimes(count: number, pacingSeconds: number, earliest: Date): Date[] {
	const start = earliest.getTime();
	return Array.from({ length: count }, (_, index) => new Date(start + index * pacingSeconds * 1000));
}

export function applyFindReplace(message: string, find: string, replace: string) {
	return message.split(find).join(replace);
}
