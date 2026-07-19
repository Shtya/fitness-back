import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	NotificationAudience,
	NotificationType,
	User,
} from '../../../entities/global.entity';
import { NotificationService } from '../../notification/notification.service';
import {
	WhatsAppAccountAccess,
	WhatsAppConversation,
	WhatsAppConversationAssignment,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';

@Injectable()
export class WhatsAppAssignmentService {
	constructor(
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
		@InjectRepository(WhatsAppConversationAssignment)
		private readonly assignmentRepo: Repository<WhatsAppConversationAssignment>,
		@InjectRepository(WhatsAppAccountAccess)
		private readonly accountAccessRepo: Repository<WhatsAppAccountAccess>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		private readonly access: WhatsAppAccessService,
		private readonly notifications: NotificationService,
		private readonly gateway: WhatsAppGateway,
		private readonly audit: WhatsAppAuditService,
	) {}

	async changeAssignment(
		actor: User,
		conversationId: string,
		targetUserId?: string | null,
		note?: string,
	) {
		const conversation = await this.conversationRepo.findOne({
			where: { id: conversationId },
			relations: ['contact', 'group', 'assignedUser'],
		});
		if (!conversation) throw new NotFoundException('WhatsApp conversation not found');

		const currentUserId = conversation.assignedUserId;
		const action = !targetUserId
			? 'unassign'
			: currentUserId && currentUserId !== targetUserId
				? 'transfer'
				: 'assign';
		const requiredPermission = action === 'transfer' ? 'canTransfer' : 'canAssign';
		await this.access.assertAccountPermission(
			actor,
			conversation.accountId,
			requiredPermission,
		);

		if (targetUserId === currentUserId) {
			throw new BadRequestException('Conversation is already assigned to this user');
		}

		let target: User | null = null;
		if (targetUserId) {
			target = await this.userRepo.findOne({ where: { id: targetUserId } });
			if (!target) throw new NotFoundException('Target user not found');
			const targetAccess = await this.accountAccessRepo.findOne({
				where: { accountId: conversation.accountId, userId: targetUserId },
			});
			if (!targetAccess?.canView || !targetAccess?.canUse) {
				throw new ForbiddenException(
					'Target user must have view and use access to this WhatsApp account',
				);
			}
		}

		await this.conversationRepo.manager.transaction(async manager => {
			await manager.update(WhatsAppConversation, conversationId, {
				assignedUserId: targetUserId || null,
			});
			await manager.save(
				WhatsAppConversationAssignment,
				manager.create(WhatsAppConversationAssignment, {
					conversationId,
					assignedUserId: targetUserId || null,
					assignedByUserId: actor.id,
					previousUserId: currentUserId || null,
					action,
					note: note || null,
				}),
			);
		});

		const payload = {
			conversationId,
			accountId: conversation.accountId,
			action,
			assignedUserId: targetUserId || null,
			previousUserId: currentUserId || null,
			assignedBy: { id: actor.id, name: actor.name },
		};
		this.gateway.emitAccountEvent(
			conversation.accountId,
			'conversation_assignment',
			payload,
		);
		this.gateway.emitConversationEvent(
			conversationId,
			'conversation_assignment',
			payload,
		);
		if (target) {
			this.gateway.emitToUser(target.id, 'whatsapp:assignment', payload);
			await this.notifications.create({
				type: NotificationType.WHATSAPP_ASSIGNMENT,
				title: 'WhatsApp conversation assigned',
				message: `A WhatsApp conversation was assigned to ${target.name}`,
				data: payload,
				audience: NotificationAudience.USER,
				userId: target.id,
			});
		}

		await this.audit.write({
			actorUserId: actor.id,
			accountId: conversation.accountId,
			action: `whatsapp.conversation.${action}`,
			targetType: 'WhatsAppConversation',
			targetId: conversationId,
			metadata: payload,
		});
		return { ok: true, ...payload };
	}

	async history(user: User, conversationId: string) {
		await this.accessConversation(user, conversationId);
		return this.assignmentRepo.find({
			where: { conversationId },
			relations: ['assignedUser', 'assignedByUser'],
			order: { created_at: 'DESC' },
		});
	}

	private async accessConversation(user: User, conversationId: string) {
		const conversation = await this.conversationRepo.findOne({
			where: { id: conversationId },
		});
		if (!conversation) throw new NotFoundException('WhatsApp conversation not found');
		const accountAccess = await this.access.getAccountAccess(user, conversation.accountId);
		const maySeeConversation =
			this.access.canSeeAllConversations(user, accountAccess) ||
			conversation.assignedUserId === user.id;
		if (!accountAccess.canView || !maySeeConversation) {
			throw new ForbiddenException('WhatsApp conversation access denied');
		}
		return conversation;
	}
}
