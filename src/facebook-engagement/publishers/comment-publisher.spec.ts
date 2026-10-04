import { FbAccountStatus, FbAccountType } from '../entities/facebook-engagement.entity';
import { FacebookGraphClient } from '../services/facebook-graph.client';
import { publisherIneligibility } from './comment-publisher';
import { CommentPublisherRegistry } from './comment-publisher.registry';
import { GraphPageCommentPublisher } from './graph-page-comment.publisher';

const page = (patch: Record<string, unknown> = {}) => ({
	id: 'acc-1',
	type: FbAccountType.PAGE,
	status: FbAccountStatus.ACTIVE,
	canPublishComments: true,
	...patch,
});

describe('publisherIneligibility', () => {
	it('allows the Page that owns the post', () => {
		expect(publisherIneligibility(page(), { accountId: 'acc-1' })).toBeNull();
	});

	it('rejects other Pages, inactive Pages and Pages without permission', () => {
		expect(publisherIneligibility(page(), { accountId: 'acc-2' })?.reason).toBe('NOT_POST_OWNER');
		expect(publisherIneligibility(page({ status: FbAccountStatus.ERROR }), { accountId: 'acc-1' })?.reason).toBe(
			'ACCOUNT_INACTIVE',
		);
		expect(publisherIneligibility(page({ canPublishComments: false }), { accountId: 'acc-1' })?.reason).toBe(
			'MISSING_PERMISSION',
		);
		expect(publisherIneligibility(null, { accountId: 'acc-1' })?.reason).toBe('ACCOUNT_NOT_FOUND');
		expect(publisherIneligibility(page({ type: 'profile' }), { accountId: 'acc-1' })?.reason).toBe(
			'UNSUPPORTED_ACCOUNT_TYPE',
		);
	});
});

describe('GraphPageCommentPublisher + registry', () => {
	const target = { accountType: FbAccountType.PAGE, accountExternalId: '111', postExternalId: '111_222' };

	it('posts the message to /{post-id}/comments with the Page token', async () => {
		const graph = { post: jest.fn().mockResolvedValue({ id: '111_222_333' }) } as unknown as FacebookGraphClient;
		const publisher = new GraphPageCommentPublisher(graph);
		await expect(publisher.publish({ target, message: 'Hello', accessToken: 'page-token' })).resolves.toEqual({
			externalCommentId: '111_222_333',
		});
		expect(graph.post).toHaveBeenCalledWith('/111_222/comments', 'page-token', { message: 'Hello' });
	});

	it('fails when Facebook returns no comment id', async () => {
		const graph = { post: jest.fn().mockResolvedValue({}) } as unknown as FacebookGraphClient;
		await expect(
			new GraphPageCommentPublisher(graph).publish({ target, message: 'Hi', accessToken: 't' }),
		).rejects.toThrow('did not return a comment id');
	});

	it('resolves only supported identity types', () => {
		const publisher = new GraphPageCommentPublisher({} as FacebookGraphClient);
		const registry = new CommentPublisherRegistry([publisher]);
		expect(registry.resolve(target)).toBe(publisher);
		expect(registry.resolve({ ...target, accountType: 'profile' as FbAccountType })).toBeNull();
	});
});
