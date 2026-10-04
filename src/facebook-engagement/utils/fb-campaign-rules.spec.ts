import { FbCampaignStatus } from '../entities/facebook-engagement.entity';
import {
	applyFindReplace,
	deriveCampaignStatus,
	emptyStatusCounts,
	normalizeCommentMessage,
	planRunTimes,
} from './fb-campaign-rules';

const counts = (patch: Partial<ReturnType<typeof emptyStatusCounts>>) => ({ ...emptyStatusCounts(), ...patch });

describe('deriveCampaignStatus', () => {
	it('is queued before anything ran and processing afterwards', () => {
		expect(deriveCampaignStatus(counts({ pending: 3 }), FbCampaignStatus.DRAFT)).toBe(FbCampaignStatus.QUEUED);
		expect(deriveCampaignStatus(counts({ pending: 2, published: 1 }), FbCampaignStatus.QUEUED)).toBe(
			FbCampaignStatus.PROCESSING,
		);
		expect(deriveCampaignStatus(counts({ processing: 1 }), FbCampaignStatus.QUEUED)).toBe(FbCampaignStatus.PROCESSING);
	});

	it('resolves final states', () => {
		expect(deriveCampaignStatus(counts({ published: 3 }), FbCampaignStatus.PROCESSING)).toBe(FbCampaignStatus.COMPLETED);
		expect(deriveCampaignStatus(counts({ published: 2, failed: 1 }), FbCampaignStatus.PROCESSING)).toBe(
			FbCampaignStatus.COMPLETED_WITH_ERRORS,
		);
		expect(deriveCampaignStatus(counts({ failed: 2 }), FbCampaignStatus.PROCESSING)).toBe(FbCampaignStatus.FAILED);
		expect(deriveCampaignStatus(counts({ draft: 4 }), FbCampaignStatus.DRAFT)).toBe(FbCampaignStatus.DRAFT);
		expect(deriveCampaignStatus(counts({ cancelled: 2 }), FbCampaignStatus.QUEUED)).toBe(FbCampaignStatus.CANCELLED);
	});

	it('keeps a user cancellation once nothing is left running', () => {
		expect(deriveCampaignStatus(counts({ published: 1, cancelled: 2 }), FbCampaignStatus.CANCELLED)).toBe(
			FbCampaignStatus.CANCELLED,
		);
		expect(deriveCampaignStatus(counts({ processing: 1 }), FbCampaignStatus.CANCELLED)).toBe(FbCampaignStatus.PROCESSING);
	});
});

describe('comment helpers', () => {
	it('normalizes messages for duplicate detection', () => {
		expect(normalizeCommentMessage('  Great   Post!\n')).toBe(normalizeCommentMessage('great post!'));
	});

	it('spaces run times by pacing', () => {
		const start = new Date('2026-01-01T00:00:00Z');
		expect(planRunTimes(3, 30, start).map((date) => date.toISOString())).toEqual([
			'2026-01-01T00:00:00.000Z',
			'2026-01-01T00:00:30.000Z',
			'2026-01-01T00:01:00.000Z',
		]);
	});

	it('replaces every occurrence literally', () => {
		expect(applyFindReplace('a.b.a', 'a', 'x')).toBe('x.b.x');
	});
});
