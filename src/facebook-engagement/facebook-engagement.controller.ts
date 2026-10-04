import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Put,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '../../entities/global.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import {
	AddCommentDto,
	BulkAddCommentsDto,
	BulkCommentIdsDto,
	BulkUpdateCommentsDto,
	CompleteOAuthDto,
	ConnectWithTokenDto,
	CreateCampaignDto,
	ListActivityQueryDto,
	ListCampaignsQueryDto,
	ListCommentsQueryDto,
	OAuthUrlQueryDto,
	PagePostsQueryDto,
	PublishCampaignDto,
	ReorderCommentsDto,
	ResolvePostDto,
	UpdateCampaignDto,
	UpdateCommentDto,
} from './dto/facebook-engagement.dto';
import { FbEngagementActivityService } from './services/fb-engagement-activity.service';
import { FbEngagementCampaignsService } from './services/fb-engagement-campaigns.service';
import { FbEngagementCommentsService } from './services/fb-engagement-comments.service';
import { FbEngagementConnectionsService } from './services/fb-engagement-connections.service';
import { FbEngagementOverviewService } from './services/fb-engagement-overview.service';
import { FbEngagementPostsService } from './services/fb-engagement-posts.service';

const ROLES = [UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN] as const;
const uuid = new ParseUUIDPipe();

@Controller('facebook-engagement')
export class FacebookEngagementController {
	constructor(
		private readonly overviewService: FbEngagementOverviewService,
		private readonly connections: FbEngagementConnectionsService,
		private readonly posts: FbEngagementPostsService,
		private readonly campaigns: FbEngagementCampaignsService,
		private readonly comments: FbEngagementCommentsService,
		private readonly activity: FbEngagementActivityService,
	) {}

	@Get('oauth/callback')
	oauthCallback(
		@Query('code') code: string | undefined,
		@Query('state') state: string | undefined,
		@Query('error_description') errorDescription: string | undefined,
		@Query('error') error: string | undefined,
		@Res() res: Response,
	) {
		return res.redirect(this.connections.callbackRedirect(code, state, errorDescription || error));
	}

	@Get('overview')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	overview(@Req() req: any) {
		return this.overviewService.overview(req.user.id);
	}

	@Get('config')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	config() {
		return this.connections.publicConfig();
	}

	@Get('oauth/url')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	oauthUrl(@Req() req: any, @Query() query: OAuthUrlQueryDto) {
		return this.connections.authUrl(
			req.user.id,
			query.locale,
			query.returnOrigin || req.headers?.origin,
			query.popup === '1' || query.popup === 'true',
		);
	}

	@Post('oauth/complete')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	completeOAuth(@Req() req: any, @Body() dto: CompleteOAuthDto) {
		return this.connections.completeOAuth(req.user.id, dto.claim);
	}

	@Get('connections')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	listConnections(@Req() req: any) {
		return this.connections.listConnections(req.user.id);
	}

	@Post('connections/token')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	connectWithToken(@Req() req: any, @Body() dto: ConnectWithTokenDto) {
		return this.connections.connectWithToken(req.user.id, dto.accessToken);
	}

	@Post('connections/:id/sync')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	syncConnection(@Req() req: any, @Param('id', uuid) id: string) {
		return this.connections.sync(req.user.id, id);
	}

	@Delete('connections/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	disconnect(@Req() req: any, @Param('id', uuid) id: string) {
		return this.connections.disconnect(req.user.id, id);
	}

	@Get('accounts')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	listAccounts(@Req() req: any) {
		return this.connections.listAccounts(req.user.id);
	}

	@Get('accounts/:id/posts')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	listPagePosts(@Req() req: any, @Param('id', uuid) id: string, @Query() query: PagePostsQueryDto) {
		return this.posts.listPagePosts(req.user.id, id, query.after);
	}

	@Post('posts/resolve')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	resolvePost(@Req() req: any, @Body() dto: ResolvePostDto) {
		return this.posts.resolve(req.user.id, dto);
	}

	@Get('posts/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	getPost(@Req() req: any, @Param('id', uuid) id: string) {
		return this.posts.get(req.user.id, id);
	}

	@Post('posts/:id/refresh')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	refreshPost(@Req() req: any, @Param('id', uuid) id: string) {
		return this.posts.refresh(req.user.id, id);
	}

	@Get('campaigns')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	listCampaigns(@Req() req: any, @Query() query: ListCampaignsQueryDto) {
		return this.campaigns.list(req.user.id, query);
	}

	@Post('campaigns')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	createCampaign(@Req() req: any, @Body() dto: CreateCampaignDto) {
		return this.campaigns.create(req.user.id, dto);
	}

	@Get('campaigns/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	getCampaign(@Req() req: any, @Param('id', uuid) id: string) {
		return this.campaigns.get(req.user.id, id);
	}

	@Patch('campaigns/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	updateCampaign(@Req() req: any, @Param('id', uuid) id: string, @Body() dto: UpdateCampaignDto) {
		return this.campaigns.update(req.user.id, id, dto);
	}

	@Delete('campaigns/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	deleteCampaign(@Req() req: any, @Param('id', uuid) id: string) {
		return this.campaigns.remove(req.user.id, id);
	}

	@Post('campaigns/:id/duplicate')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	duplicateCampaign(@Req() req: any, @Param('id', uuid) id: string) {
		return this.campaigns.duplicate(req.user.id, id);
	}

	@Post('campaigns/:id/publish')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	publishCampaign(@Req() req: any, @Param('id', uuid) id: string, @Body() dto: PublishCampaignDto) {
		return this.campaigns.publish(req.user.id, id, dto.commentIds, 'publish');
	}

	@Post('campaigns/:id/retry-failed')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	retryFailed(@Req() req: any, @Param('id', uuid) id: string, @Body() dto: PublishCampaignDto) {
		return this.campaigns.publish(req.user.id, id, dto.commentIds, 'retry');
	}

	@Post('campaigns/:id/cancel')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	cancelCampaign(@Req() req: any, @Param('id', uuid) id: string) {
		return this.campaigns.cancel(req.user.id, id);
	}

	@Post('campaigns/:id/comments')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	addComment(@Req() req: any, @Param('id', uuid) id: string, @Body() dto: AddCommentDto) {
		return this.comments.add(req.user.id, id, dto);
	}

	@Post('campaigns/:id/comments/bulk')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	bulkAddComments(@Req() req: any, @Param('id', uuid) id: string, @Body() dto: BulkAddCommentsDto) {
		return this.comments.bulkAdd(req.user.id, id, dto);
	}

	@Put('campaigns/:id/comments/order')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	reorderComments(@Req() req: any, @Param('id', uuid) id: string, @Body() dto: ReorderCommentsDto) {
		return this.comments.reorder(req.user.id, id, dto.ids);
	}

	@Get('comments')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	listComments(@Req() req: any, @Query() query: ListCommentsQueryDto) {
		return this.comments.list(req.user.id, query);
	}

	@Post('comments/bulk-delete')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	bulkDeleteComments(@Req() req: any, @Body() dto: BulkCommentIdsDto) {
		return this.comments.bulkRemove(req.user.id, dto.ids);
	}

	@Post('comments/bulk-update')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	bulkUpdateComments(@Req() req: any, @Body() dto: BulkUpdateCommentsDto) {
		return this.comments.bulkUpdate(req.user.id, dto);
	}

	@Post('comments/bulk-retry')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	bulkRetryComments(@Req() req: any, @Body() dto: BulkCommentIdsDto) {
		return this.comments.bulkRetry(req.user.id, dto.ids);
	}

	@Patch('comments/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	updateComment(@Req() req: any, @Param('id', uuid) id: string, @Body() dto: UpdateCommentDto) {
		return this.comments.update(req.user.id, id, dto);
	}

	@Post('comments/:id/duplicate')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	duplicateComment(@Req() req: any, @Param('id', uuid) id: string) {
		return this.comments.duplicate(req.user.id, id);
	}

	@Delete('comments/:id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	deleteComment(@Req() req: any, @Param('id', uuid) id: string) {
		return this.comments.remove(req.user.id, id);
	}

	@Get('activity')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(...ROLES)
	listActivity(@Req() req: any, @Query() query: ListActivityQueryDto) {
		return this.activity.list(req.user.id, query);
	}
}
