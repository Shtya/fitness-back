import { Inject, Injectable } from '@nestjs/common';
import { COMMENT_PUBLISHERS, CommentPublisher, CommentPublishTarget } from './comment-publisher';

@Injectable()
export class CommentPublisherRegistry {
	constructor(@Inject(COMMENT_PUBLISHERS) private readonly publishers: CommentPublisher[]) {}

	resolve(target: CommentPublishTarget): CommentPublisher | null {
		return this.publishers.find((publisher) => publisher.supports(target)) ?? null;
	}
}
