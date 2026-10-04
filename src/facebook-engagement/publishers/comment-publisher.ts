import { FbAccountStatus, FbAccountType } from '../entities/facebook-engagement.entity';

export type CommentPublishTarget = {
	accountType: FbAccountType;
	accountExternalId: string;
	postExternalId: string;
};

export type CommentPublishInput = {
	target: CommentPublishTarget;
	message: string;
	accessToken: string;
};

export type CommentPublishResult = {
	externalCommentId: string;
};

/**
 * One implementation per official publishing identity. Identities that Meta does not
 * allow to comment through the API (personal profiles, other people's Pages) have no
 * implementation, so the registry reports them as NOT_SUPPORTED instead of faking it.
 */
export interface CommentPublisher {
	readonly id: string;
	supports(target: CommentPublishTarget): boolean;
	publish(input: CommentPublishInput): Promise<CommentPublishResult>;
}

export const COMMENT_PUBLISHERS = Symbol('FB_ENGAGEMENT_COMMENT_PUBLISHERS');

export type PublisherEligibilityReason =
	| 'ACCOUNT_NOT_FOUND'
	| 'ACCOUNT_INACTIVE'
	| 'MISSING_PERMISSION'
	| 'NOT_POST_OWNER'
	| 'UNSUPPORTED_ACCOUNT_TYPE';

export type PublisherIneligibility = { reason: PublisherEligibilityReason; message: string };

type EligibilityAccount = {
	id: string;
	type: FbAccountType;
	status: FbAccountStatus;
	canPublishComments: boolean;
};

/** Returns why `account` cannot comment on `post`, or null when it can. */
export function publisherIneligibility(
	account: EligibilityAccount | null | undefined,
	post: { accountId: string },
): PublisherIneligibility | null {
	if (!account) {
		return { reason: 'ACCOUNT_NOT_FOUND', message: 'The publishing account is not connected.' };
	}
	if (account.type !== FbAccountType.PAGE) {
		return {
			reason: 'UNSUPPORTED_ACCOUNT_TYPE',
			message: 'Facebook only allows Pages to publish comments through the official API.',
		};
	}
	if (account.status !== FbAccountStatus.ACTIVE) {
		return { reason: 'ACCOUNT_INACTIVE', message: 'This Page connection is not active. Reconnect it first.' };
	}
	if (!account.canPublishComments) {
		return {
			reason: 'MISSING_PERMISSION',
			message: 'This Page does not have the MODERATE task / pages_manage_engagement permission.',
		};
	}
	if (account.id !== post.accountId) {
		return {
			reason: 'NOT_POST_OWNER',
			message: 'A Page can only comment on its own posts through the official API.',
		};
	}
	return null;
}
