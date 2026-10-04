import { Injectable } from '@nestjs/common';
import { FbAccountType } from '../entities/facebook-engagement.entity';
import { FacebookGraphClient } from '../services/facebook-graph.client';
import { FacebookGraphError } from '../utils/fb-graph-errors';
import {
	CommentPublishInput,
	CommentPublishResult,
	CommentPublisher,
	CommentPublishTarget,
} from './comment-publisher';

@Injectable()
export class GraphPageCommentPublisher implements CommentPublisher {
	readonly id = 'graph-page-comment';

	constructor(private readonly graph: FacebookGraphClient) {}

	supports(target: CommentPublishTarget) {
		return target.accountType === FbAccountType.PAGE;
	}

	async publish({ target, message, accessToken }: CommentPublishInput): Promise<CommentPublishResult> {
		const result = await this.graph.post<{ id?: string }>(
			`/${encodeURIComponent(target.postExternalId)}/comments`,
			accessToken,
			{ message },
		);
		if (!result?.id) {
			throw new FacebookGraphError('Facebook did not return a comment id', 500, null, null, false);
		}
		return { externalCommentId: result.id };
	}
}
