import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	WhatsAppAccountAccess,
	WhatsAppConversation,
	WhatsAppMessage,
} from '../entities/whatsapp.entity';
import {
	OPEN_QUEUE_MAX_AGE_SECONDS,
	SLA_MEASURE_MAX_SECONDS,
	paceRank,
	staffPace,
	type StaffPace,
} from '../utils/whatsapp-staff-sla';
import { WhatsAppAccessService } from './whatsapp-access.service';

type SqlRow = Record<string, unknown>;

const CHAT_EXCLUSION = `
	AND LOWER(c.provider_chat_id) NOT LIKE '%@broadcast%'
	AND LOWER(c.provider_chat_id) NOT LIKE '%status@%'
`;

const REPLY_PAIR_CTE = `
	WITH ordered AS (
		SELECT
			m.conversation_id,
			m.direction,
			m.provider_timestamp,
			LAG(m.direction) OVER (
				PARTITION BY m.conversation_id
				ORDER BY m.provider_timestamp, m.created_at, m.id
			) AS prev_direction
		FROM whatsapp_messages m
		INNER JOIN whatsapp_conversations c ON c.id = m.conversation_id AND c.deleted_at IS NULL
		WHERE m.account_id = $1
			AND m.deleted_at IS NULL
			${CHAT_EXCLUSION}
	),
	waits AS (
		SELECT conversation_id, provider_timestamp AS wait_started_at
		FROM ordered
		WHERE direction = 'inbound'
			AND (prev_direction IS NULL OR prev_direction <> 'inbound')
	),
	replies AS (
		SELECT
			w.conversation_id,
			w.wait_started_at,
			r.sender_user_id AS "userId",
			EXTRACT(EPOCH FROM (r.provider_timestamp - w.wait_started_at)) AS wait_seconds,
			r.provider_timestamp AS replied_at
		FROM waits w
		JOIN LATERAL (
			SELECT m.sender_user_id, m.provider_timestamp
			FROM whatsapp_messages m
			WHERE m.conversation_id = w.conversation_id
				AND m.direction = 'outbound'
				AND m.deleted_at IS NULL
				AND m.provider_timestamp > w.wait_started_at
				AND m.sender_user_id IS NOT NULL
			ORDER BY m.provider_timestamp, m.created_at, m.id
			LIMIT 1
		) r ON true
		WHERE r.provider_timestamp BETWEEN $2 AND $3
			AND EXTRACT(EPOCH FROM (r.provider_timestamp - w.wait_started_at)) BETWEEN 0 AND $4
	)
`;

@Injectable()
export class WhatsAppReportsService {
	constructor(
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
		@InjectRepository(WhatsAppAccountAccess)
		private readonly accessRepo: Repository<WhatsAppAccountAccess>,
		private readonly access: WhatsAppAccessService,
	) {}

	async summary(user: User, accountId: string, from?: string, to?: string) {
		await this.assertReportsRead(user, accountId);
		const range = this.range(from, to);
		const [totals, replyBundle, volume, members, recentQueue, assignedCounts] = await Promise.all([
			this.loadTotals(accountId, range),
			this.loadReplyStats(accountId, range),
			this.loadVolume(accountId, range),
			this.loadMembers(accountId),
			this.loadWaiting(accountId),
			this.loadAssignedCounts(accountId),
		]);
		const replyStats = replyBundle.byUser;
		const assignedWaiting = recentQueue.filter((item) => item.assignedUserId);
		const unassignedWaiting = recentQueue.filter((item) => !item.assignedUserId);

		const waitingByUser = new Map<string, typeof assignedWaiting>();
		for (const item of assignedWaiting) {
			const list = waitingByUser.get(item.assignedUserId) || [];
			list.push(item);
			waitingByUser.set(item.assignedUserId, list);
		}

		const staff = members
			.map((member) =>
				this.toStaffRow(
					member,
					replyStats.get(member.userId),
					volume.get(member.userId),
					waitingByUser.get(member.userId) || [],
					assignedCounts.get(member.userId),
				),
			)
			.filter((item) => item.assignedConversations > 0 || item.waitingConversations > 0)
			.sort((left, right) => {
				const rank = paceRank(left.pace) - paceRank(right.pace);
				if (rank) return rank;
				if (right.waitingConversations !== left.waitingConversations) {
					return right.waitingConversations - left.waitingConversations;
				}
				return (
					Number(right.medianResponseSeconds || 0) - Number(left.medianResponseSeconds || 0)
				);
			});

		const bestToAssign =
			staff.find((item) => item.pace === 'fast' && item.waitingConversations < 3) ||
			staff.find((item) => item.pace === 'ok' && item.waitingConversations < 2) ||
			null;

		return {
			period: { from: range.from.toISOString(), to: range.to.toISOString() },
			totals: {
				...totals,
				waitingConversations: assignedWaiting.length,
				overdueConversations: assignedWaiting.filter(
					(item) => Number(item.waitSeconds) >= 15 * 60,
				).length,
				unassignedWaiting: unassignedWaiting.length,
				repliesMeasured: replyBundle.team.replies,
			},
			averageResponseSeconds: replyBundle.team.medianResponseSeconds,
			bestToAssign: bestToAssign
				? { userId: bestToAssign.userId, name: bestToAssign.name, pace: bestToAssign.pace }
				: null,
			staff,
			waiting: assignedWaiting.slice(0, 40),
		};
	}

	async staffDetail(user: User, accountId: string, staffUserId: string, from?: string, to?: string) {
		await this.assertReportsRead(user, accountId);
		const members = await this.loadMembers(accountId);
		const member = members.find((item) => item.userId === staffUserId);
		if (!member) throw new NotFoundException('Staff member is not on this WhatsApp account');
		const range = this.range(from, to);
		const [replyBundle, volume, assignedCounts, replies, waiting] = await Promise.all([
			this.loadReplyStats(accountId, range),
			this.loadVolume(accountId, range),
			this.loadAssignedCounts(accountId),
			this.loadReplyDetails(accountId, staffUserId, range, 40),
			this.loadWaiting(accountId, staffUserId),
		]);
		return {
			period: { from: range.from.toISOString(), to: range.to.toISOString() },
			staff: this.toStaffRow(
				member,
				replyBundle.byUser.get(staffUserId),
				volume.get(staffUserId),
				waiting,
				assignedCounts.get(staffUserId),
			),
			replies,
			waiting,
		};
	}

	private async assertReportsRead(user: User, accountId: string) {
		const access = await this.access.getAccountAccess(user, accountId);
		if (!access.canManage && !access.canAssign) {
			throw new ForbiddenException('WhatsApp account permission denied: canAssign');
		}
	}

	private toStaffRow(
		member: { userId: string; name: string },
		stats:
			| {
					replies: number;
					avgResponseSeconds: number | null;
					medianResponseSeconds: number | null;
					p90ResponseSeconds: number | null;
					fastestResponseSeconds: number | null;
					slowestResponseSeconds: number | null;
					fastReplies5m: number;
					slowReplies15m: number;
					slowReplies1h: number;
			  }
			| undefined,
		volumeRow: { sentMessages: number; successfulMessages: number } | undefined,
		queue: Array<{ waitSeconds: number; inboundWaiting: number }>,
		assigned?: { assigned: number; unread: number },
	) {
		const oldestWaitSeconds = queue.reduce(
			(max, item) => Math.max(max, Number(item.waitSeconds) || 0),
			0,
		);
		const waitingInboundMessages = queue.reduce(
			(sum, item) => sum + (Number(item.inboundWaiting) || 0),
			0,
		);
		const payload = {
			userId: member.userId,
			name: member.name,
			replies: stats?.replies || 0,
			avgResponseSeconds: stats?.avgResponseSeconds ?? null,
			medianResponseSeconds: stats?.medianResponseSeconds ?? null,
			p90ResponseSeconds: stats?.p90ResponseSeconds ?? null,
			fastestResponseSeconds: stats?.fastestResponseSeconds ?? null,
			slowestResponseSeconds: stats?.slowestResponseSeconds ?? null,
			slowReplies15m: stats?.slowReplies15m || 0,
			slowReplies1h: stats?.slowReplies1h || 0,
			fastReplies5m: stats?.fastReplies5m || 0,
			sentMessages: volumeRow?.sentMessages || 0,
			successfulMessages: volumeRow?.successfulMessages || 0,
			assignedConversations: assigned?.assigned || 0,
			waitingConversations: queue.length,
			waitingInboundMessages,
			unreadMessages: assigned?.unread || 0,
			oldestWaitSeconds: queue.length ? oldestWaitSeconds : null,
		};
		const pace: StaffPace = staffPace(payload);
		return { ...payload, pace };
	}

	private range(from?: string, to?: string) {
		const end = to ? new Date(to) : new Date();
		const start = from ? new Date(from) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
		return {
			from: Number.isNaN(start.getTime())
				? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
				: start,
			to: Number.isNaN(end.getTime()) ? new Date() : end,
		};
	}

	private async loadTotals(accountId: string, range: { from: Date; to: Date }) {
		const row: SqlRow = await this.messageRepo.query(
			`
			SELECT
				COUNT(*)::int AS messages,
				COUNT(*) FILTER (WHERE m.direction = 'inbound')::int AS inbound,
				COUNT(*) FILTER (WHERE m.direction = 'outbound')::int AS outbound,
				COUNT(*) FILTER (WHERE m.status = 'failed')::int AS failed,
				COUNT(DISTINCT m.conversation_id)::int AS "activeConversations"
			FROM whatsapp_messages m
			INNER JOIN whatsapp_conversations c ON c.id = m.conversation_id AND c.deleted_at IS NULL
			WHERE m.account_id = $1
				AND m.deleted_at IS NULL
				AND m.provider_timestamp BETWEEN $2 AND $3
				${CHAT_EXCLUSION}
			`,
			[accountId, range.from, range.to],
		).then((rows) => rows?.[0] || {});
		return {
			messages: Number(row?.messages || 0),
			inbound: Number(row?.inbound || 0),
			outbound: Number(row?.outbound || 0),
			failed: Number(row?.failed || 0),
			activeConversations: Number(row?.activeConversations || 0),
		};
	}

	private async loadVolume(accountId: string, range: { from: Date; to: Date }) {
		const rows = await this.messageRepo
			.createQueryBuilder('m')
			.select('m.sender_user_id', 'userId')
			.addSelect('COUNT(*)', 'sentMessages')
			.addSelect(
				`COUNT(*) FILTER (WHERE m.status IN ('sent', 'delivered', 'read', 'played'))`,
				'successfulMessages',
			)
			.where('m.accountId = :accountId', { accountId })
			.andWhere(`m.direction = 'outbound'`)
			.andWhere('m.sender_user_id IS NOT NULL')
			.andWhere('m.providerTimestamp BETWEEN :from AND :to', range)
			.groupBy('m.sender_user_id')
			.getRawMany();
		return new Map(
			rows.map((row) => [
				String(row.userId),
				{
					sentMessages: Number(row.sentMessages || 0),
					successfulMessages: Number(row.successfulMessages || 0),
				},
			]),
		);
	}

	private async loadMembers(accountId: string) {
		const rows = await this.accessRepo.find({
			where: { accountId },
			relations: ['user'],
		});
		return rows
			.filter((row) => row.canView || row.canUse)
			.map((row) => ({
				userId: row.userId,
				name: row.user?.name || 'Staff',
			}));
	}

	private async loadAssignedCounts(accountId: string) {
		const rows: Array<{ userId: string; assigned: string; unread: string }> =
			await this.conversationRepo.query(
				`
				SELECT
					c.assigned_user_id AS "userId",
					COUNT(*)::int AS assigned,
					COALESCE(SUM(c.unread_count), 0)::int AS unread
				FROM whatsapp_conversations c
				WHERE c.account_id = $1
					AND c.deleted_at IS NULL
					AND c.assigned_user_id IS NOT NULL
					AND COALESCE(c.is_closed, false) = false
					${CHAT_EXCLUSION}
				GROUP BY c.assigned_user_id
				`,
				[accountId],
			);
		return new Map(
			rows.map((row) => [
				row.userId,
				{ assigned: Number(row.assigned || 0), unread: Number(row.unread || 0) },
			]),
		);
	}

	private async loadReplyStats(accountId: string, range: { from: Date; to: Date }) {
		const params = [accountId, range.from, range.to, SLA_MEASURE_MAX_SECONDS];
		const [rows, teamRows]: [SqlRow[], SqlRow[]] = await Promise.all([
			this.messageRepo.query(
				`
				${REPLY_PAIR_CTE}
				SELECT
					"userId",
					COUNT(*)::int AS replies,
					AVG(wait_seconds)::float AS "avgResponseSeconds",
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_seconds)::float AS "medianResponseSeconds",
					PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY wait_seconds)::float AS "p90ResponseSeconds",
					MIN(wait_seconds)::float AS "fastestResponseSeconds",
					MAX(wait_seconds)::float AS "slowestResponseSeconds",
					COUNT(*) FILTER (WHERE wait_seconds <= 300)::int AS "fastReplies5m",
					COUNT(*) FILTER (WHERE wait_seconds > 900)::int AS "slowReplies15m",
					COUNT(*) FILTER (WHERE wait_seconds > 3600)::int AS "slowReplies1h"
				FROM replies
				GROUP BY "userId"
				`,
				params,
			),
			this.messageRepo.query(
				`
				${REPLY_PAIR_CTE}
				SELECT
					COUNT(*)::int AS replies,
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_seconds)::float AS "medianResponseSeconds"
				FROM replies
				`,
				params,
			),
		]);
		const team = teamRows[0] || {};
		return {
			byUser: new Map(
				rows
					.filter((row) => row.userId)
					.map((row) => [
						String(row.userId),
						{
							replies: Number(row.replies || 0),
							avgResponseSeconds: this.numberOrNull(row.avgResponseSeconds),
							medianResponseSeconds: this.numberOrNull(row.medianResponseSeconds),
							p90ResponseSeconds: this.numberOrNull(row.p90ResponseSeconds),
							fastestResponseSeconds: this.numberOrNull(row.fastestResponseSeconds),
							slowestResponseSeconds: this.numberOrNull(row.slowestResponseSeconds),
							fastReplies5m: Number(row.fastReplies5m || 0),
							slowReplies15m: Number(row.slowReplies15m || 0),
							slowReplies1h: Number(row.slowReplies1h || 0),
						},
					]),
			),
			team: {
				replies: Number(team.replies || 0),
				medianResponseSeconds: this.numberOrNull(team.medianResponseSeconds),
			},
		};
	}

	private async loadWaiting(accountId: string, staffUserId?: string) {
		const params: unknown[] = [accountId, OPEN_QUEUE_MAX_AGE_SECONDS];
		let staffFilter = '';
		if (staffUserId) {
			params.push(staffUserId);
			staffFilter = `AND c.assigned_user_id = $3`;
		}
		const rows: SqlRow[] = await this.conversationRepo.query(
			`
			WITH last_msg AS (
				SELECT DISTINCT ON (m.conversation_id)
					m.conversation_id,
					m.direction,
					m.provider_timestamp
				FROM whatsapp_messages m
				WHERE m.account_id = $1
					AND m.deleted_at IS NULL
				ORDER BY m.conversation_id, m.provider_timestamp DESC, m.created_at DESC, m.id DESC
			),
			last_out AS (
				SELECT conversation_id, MAX(provider_timestamp) AS ts
				FROM whatsapp_messages
				WHERE account_id = $1
					AND direction = 'outbound'
					AND deleted_at IS NULL
				GROUP BY conversation_id
			),
			waiting_inbound AS (
				SELECT
					m.conversation_id,
					COUNT(*)::int AS inbound_waiting,
					MIN(m.provider_timestamp) AS wait_started_at
				FROM whatsapp_messages m
				LEFT JOIN last_out o ON o.conversation_id = m.conversation_id
				WHERE m.account_id = $1
					AND m.direction = 'inbound'
					AND m.deleted_at IS NULL
					AND (o.ts IS NULL OR m.provider_timestamp > o.ts)
				GROUP BY m.conversation_id
			)
			SELECT
				c.id AS "conversationId",
				c.assigned_user_id AS "assignedUserId",
				assigned_user.name AS "assignedUserName",
				COALESCE(NULLIF(contact.name, ''), NULLIF(grp.subject, ''), c.provider_chat_id) AS title,
				c.unread_count::int AS "unreadCount",
				w.inbound_waiting::int AS "inboundWaiting",
				EXTRACT(EPOCH FROM (NOW() - w.wait_started_at))::int AS "waitSeconds",
				w.wait_started_at AS "lastInboundAt"
			FROM whatsapp_conversations c
			INNER JOIN last_msg ON last_msg.conversation_id = c.id AND last_msg.direction = 'inbound'
			INNER JOIN waiting_inbound w ON w.conversation_id = c.id AND w.inbound_waiting > 0
			LEFT JOIN whatsapp_contacts contact ON contact.id = c.contact_id
			LEFT JOIN whatsapp_groups grp ON grp.id = c.group_id
			LEFT JOIN users assigned_user ON assigned_user.id = c.assigned_user_id
			WHERE c.account_id = $1
				AND c.deleted_at IS NULL
				AND COALESCE(c.is_closed, false) = false
				AND w.wait_started_at >= NOW() - ($2 * INTERVAL '1 second')
				${CHAT_EXCLUSION}
				${staffFilter}
			ORDER BY w.wait_started_at ASC
			`,
			params,
		);
		return rows.map((row) => ({
			conversationId: String(row.conversationId),
			assignedUserId: row.assignedUserId ? String(row.assignedUserId) : null,
			assignedUserName: row.assignedUserName ? String(row.assignedUserName) : null,
			title: String(row.title || 'Chat'),
			unreadCount: Number(row.unreadCount || 0),
			inboundWaiting: Number(row.inboundWaiting || 0),
			waitSeconds: Math.max(0, Number(row.waitSeconds || 0)),
			lastInboundAt: row.lastInboundAt,
		}));
	}

	private async loadReplyDetails(
		accountId: string,
		staffUserId: string,
		range: { from: Date; to: Date },
		limit: number,
	) {
		const rows: SqlRow[] = await this.messageRepo.query(
			`
			${REPLY_PAIR_CTE}
			SELECT
				rpl.conversation_id AS "conversationId",
				COALESCE(NULLIF(contact.name, ''), NULLIF(grp.subject, ''), c.provider_chat_id) AS title,
				rpl.wait_started_at AS "inboundAt",
				rpl.replied_at AS "repliedAt",
				rpl.wait_seconds::int AS "waitSeconds"
			FROM replies rpl
			INNER JOIN whatsapp_conversations c ON c.id = rpl.conversation_id
			LEFT JOIN whatsapp_contacts contact ON contact.id = c.contact_id
			LEFT JOIN whatsapp_groups grp ON grp.id = c.group_id
			WHERE rpl."userId" = $5
			ORDER BY rpl.replied_at DESC
			LIMIT $6
			`,
			[accountId, range.from, range.to, SLA_MEASURE_MAX_SECONDS, staffUserId, limit],
		);
		return rows.map((row) => ({
			conversationId: String(row.conversationId),
			title: String(row.title || 'Chat'),
			inboundAt: row.inboundAt,
			repliedAt: row.repliedAt,
			waitSeconds: Math.max(0, Number(row.waitSeconds || 0)),
		}));
	}

	private numberOrNull(value: unknown) {
		if (value == null || value === '') return null;
		const number = Number(value);
		return Number.isFinite(number) ? number : null;
	}
}
