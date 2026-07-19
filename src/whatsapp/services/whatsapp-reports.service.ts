import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import { WhatsAppMessage } from '../entities/whatsapp.entity';
import { WhatsAppAccessService } from './whatsapp-access.service';

@Injectable()
export class WhatsAppReportsService {
	constructor(
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		private readonly access: WhatsAppAccessService,
	) {}

	async summary(user: User, accountId: string, from?: string, to?: string) {
		await this.access.assertAccountPermission(user, accountId, 'canManage');
		const params: any = { accountId };
		const filters = ['m.account_id = :accountId'];
		if (from) {
			filters.push('m.provider_timestamp >= :from');
			params.from = new Date(from);
		}
		if (to) {
			filters.push('m.provider_timestamp <= :to');
			params.to = new Date(to);
		}
		const where = filters.join(' AND ');

		const totals = await this.messageRepo
			.createQueryBuilder('m')
			.select('COUNT(*)', 'messages')
			.addSelect(
				`COUNT(*) FILTER (WHERE m.direction = 'inbound')`,
				'inbound',
			)
			.addSelect(
				`COUNT(*) FILTER (WHERE m.direction = 'outbound')`,
				'outbound',
			)
			.addSelect(
				`COUNT(*) FILTER (WHERE m.status = 'failed')`,
				'failed',
			)
			.addSelect('COUNT(DISTINCT m.conversation_id)', 'activeConversations')
			.where(where, params)
			.getRawOne();

		const response = await this.messageRepo
			.createQueryBuilder('outbound')
			.select(
				`AVG(EXTRACT(EPOCH FROM (outbound.provider_timestamp - inbound.provider_timestamp)))`,
				'averageResponseSeconds',
			)
			.innerJoin(
				WhatsAppMessage,
				'inbound',
				`inbound.conversation_id = outbound.conversation_id
				 AND inbound.direction = 'inbound'
				 AND inbound.provider_timestamp = (
					SELECT MAX(previous.provider_timestamp)
					FROM whatsapp_messages previous
					WHERE previous.conversation_id = outbound.conversation_id
					  AND previous.direction = 'inbound'
					  AND previous.provider_timestamp < outbound.provider_timestamp
				 )`,
			)
			.where(`outbound.direction = 'outbound'`)
			.andWhere(where.replace(/\bm\./g, 'outbound.'), params)
			.getRawOne();

		const staff = await this.messageRepo
			.createQueryBuilder('m')
			.leftJoin('m.senderUser', 'sender')
			.select('m.sender_user_id', 'userId')
			.addSelect('sender.name', 'name')
			.addSelect('COUNT(*)', 'sentMessages')
			.addSelect(
				`COUNT(*) FILTER (WHERE m.status IN ('sent', 'delivered', 'read', 'played'))`,
				'successfulMessages',
			)
			.where(where, params)
			.andWhere(`m.direction = 'outbound'`)
			.andWhere('m.sender_user_id IS NOT NULL')
			.groupBy('m.sender_user_id')
			.addGroupBy('sender.name')
			.orderBy('COUNT(*)', 'DESC')
			.getRawMany();

		return {
			totals: {
				messages: Number(totals?.messages || 0),
				inbound: Number(totals?.inbound || 0),
				outbound: Number(totals?.outbound || 0),
				failed: Number(totals?.failed || 0),
				activeConversations: Number(totals?.activeConversations || 0),
			},
			averageResponseSeconds:
				response?.averageResponseSeconds == null
					? null
					: Number(response.averageResponseSeconds),
			staff: staff.map(row => ({
				userId: row.userId,
				name: row.name,
				sentMessages: Number(row.sentMessages || 0),
				successfulMessages: Number(row.successfulMessages || 0),
			})),
		};
	}
}
