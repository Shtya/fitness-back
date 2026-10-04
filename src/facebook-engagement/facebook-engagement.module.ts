import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FB_ENGAGEMENT_ENTITIES } from './entities/facebook-engagement.entity';
import { FacebookEngagementController } from './facebook-engagement.controller';
import { FacebookEngagementScheduler } from './facebook-engagement.scheduler';
import { COMMENT_PUBLISHERS } from './publishers/comment-publisher';
import { CommentPublisherRegistry } from './publishers/comment-publisher.registry';
import { GraphPageCommentPublisher } from './publishers/graph-page-comment.publisher';
import { FacebookGraphClient } from './services/facebook-graph.client';
import { FbEngagementActivityService } from './services/fb-engagement-activity.service';
import { FbEngagementCampaignsService } from './services/fb-engagement-campaigns.service';
import { FbEngagementCommentsService } from './services/fb-engagement-comments.service';
import { FbEngagementConnectionsService } from './services/fb-engagement-connections.service';
import { FbEngagementCryptoService } from './services/fb-engagement-crypto.service';
import { FbEngagementJobsService } from './services/fb-engagement-jobs.service';
import { FbEngagementOverviewService } from './services/fb-engagement-overview.service';
import { FbEngagementPostsService } from './services/fb-engagement-posts.service';
import { FbEngagementWorkerService } from './services/fb-engagement-worker.service';

@Module({
	imports: [
		ConfigModule,
		TypeOrmModule.forFeature(FB_ENGAGEMENT_ENTITIES),
		JwtModule.registerAsync({
			useFactory: () => ({
				secret: process.env.JWT_SECRET,
			}),
		}),
	],
	controllers: [FacebookEngagementController],
	providers: [
		FacebookGraphClient,
		FbEngagementCryptoService,
		FbEngagementActivityService,
		FbEngagementJobsService,
		FbEngagementConnectionsService,
		FbEngagementPostsService,
		FbEngagementCampaignsService,
		FbEngagementCommentsService,
		FbEngagementOverviewService,
		GraphPageCommentPublisher,
		{
			provide: COMMENT_PUBLISHERS,
			useFactory: (graphPage: GraphPageCommentPublisher) => [graphPage],
			inject: [GraphPageCommentPublisher],
		},
		CommentPublisherRegistry,
		FbEngagementWorkerService,
		FacebookEngagementScheduler,
	],
})
export class FacebookEngagementModule {}
