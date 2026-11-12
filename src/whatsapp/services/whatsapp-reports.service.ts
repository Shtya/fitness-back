import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	WhatsAppAccountAccess,
	WhatsAppConversation,
	WhatsAppMessage,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
	OPEN_QUEUE_MAX_AGE_SECONDS,
	SLA_MEASURE_MAX_SECONDS,
	paceRank,
	staffPace,
	type StaffPace,
} from '../utils/whatsapp-staff-sla';
import {
	STAFF_SESSION_ACTION,
	buildStaffSessions,
	type StaffActivityEvent,
} from '../utils/whatsapp-staff-activity';
import { WhatsAppAccessService } from './whatsapp-access.service';

type SqlRow = Record<string, unknown>;
type Range = { from: Date; to: Date };

const CHAT_EXCLUSION = `
	AND LOWER(c.provider_chat_id) NOT LIKE '%@broadcast%'
	AND LOWER(c.provider_chat_id) NOT LIKE '%status@%'
`;

/** Audit actions that mean "this person had WhatsApp open". */
const PRESENCE_ACTIONS = [STAFF_SESSION_ACTION, 'whatsapp.conversation.read'];
/** How far back "last seen" looks when someone was not around in the period. */
const LAST_SEEN_LOOKBACK_DAYS = 90;

/**
 * First staff reply to each customer wait, for replies sent in the period.
 * Only messages from the period (and the 24h before it, for waits that started earlier) are
 * read — the old version ran a window function over the account's whole history.
 * $1 account, $2 from, $3 to, $4 longest wait counted (seconds).
 */
const REPLIES_SQL = `
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
			AND m.provider_timestamp >= $2::timestamptz - ($4 * INTERVAL '1 second')
			AND m.provider_timestamp <= $3
			${CHAT_EXCLUSION}
	),
	waits AS (
		SELECT conversation_id, provider_timestamp AS wait_started_at
		FROM ordered
		WHERE direction = 'inbound'
			AND (prev_direction IS NULL OR prev_direction <> 'inbound')
	)
	SELECT
		w.conversation_id AS "conversationId",
		w.wait_started_at AS "inboundAt",
		r.sender_user_id AS "userId",
		r.provider_timestamp AS "repliedAt",
		EXTRACT(EPOCH FROM (r.provider_timestamp - w.wait_started_at))::float AS "waitSeconds"
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
	ORDER BY r.provider_timestamp DESC
	LIMIT 20000
`;

export type ReplyRow = {
	conversationId: string;
	userId: string;
	inboundAt: string;
	repliedAt: string;
	waitSeconds: number;
};

export type ReplyStats = {
	replies: number;
	avgResponseSeconds: number | null;
	medianResponseSeconds: number | null;
	p90ResponseSeconds: number | null;
	fastestResponseSeconds: number | null;
	slowestResponseSeconds: number | null;
	fastReplies5m: number;
	slowReplies15m: number;
	slowReplies1h: number;
	lastReplyAt: string | null;
};

/** PERCENTILE_CONT: linear interpolation between the two nearest ranks. */
export function percentile(sorted: number[], fraction: number): number | null {
	if (!sorted.length) return null;
	const position = (sorted.length - 1) * fraction;
	const low = Math.floor(position);
	const high = Math.ceil(position);
	return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function replyStats(rows: ReplyRow[]): ReplyStats {
	const waits = rows.map(row => Number(row.waitSeconds) || 0).sort((a, b) => a - b);
	const lastReplyAt = rows.reduce<string | null>(
		(latest, row) => (!latest || String(row.repliedAt) > latest ? String(row.repliedAt) : latest),
		null,
	);
	return {
		replies: waits.length,
		avgResponseSeconds: waits.length ? waits.reduce((sum, value) => sum + value, 0) / waits.length : null,
		medianResponseSeconds: percentile(waits, 0.5),
		p90ResponseSeconds: percentile(waits, 0.9),
		fastestResponseSeconds: waits.length ? waits[0] : null,
		slowestResponseSeconds: waits.length ? waits[waits.length - 1] : null,
		fastReplies5m: waits.filter(value => value <= 300).length,
		slowReplies15m: waits.filter(value => value > 900).length,
		slowReplies1h: waits.filter(value => value > 3600).length,
		lastReplyAt,
	};
}

type StaffActivitySummary = {
	online: boolean;
	lastSeenAt: string | null;
	activeSeconds: number;
	sessions: number;
	chatsOpened: number;
	repliedChats: number;
	seenNoReply: number;
	/** [start, end] epoch ms of each sitting, oldest first (for the shift timeline). */
	sessionSpans: Array<[number, number]>;
};

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
		private readonly gateway: WhatsAppGateway,
	) {}

	async summary(user: User, accountId: string, from?: string, to?: string) {
		await this.assertReportsRead(user, accountId);
		const range = this.range(from, to);
		const [totals, replies, volume, members, queue, assignedCounts, activity] = await Promise.all([
			this.loadTotals(accountId, range),
			this.loadReplies(accountId, range),
			this.loadVolume(accountId, range),
			this.loadMembers(accountId),
			this.loadWaiting(accountId),
			this.loadAssignedCounts(accountId),
			this.loadActivityByUser(accountId, range),
		]);
		const repliesByUser = groupBy(replies, row => row.userId);
		const assignedWaiting = queue.filter(item => item.assignedUserId);
		const unassignedWaiting = queue.filter(item => !item.assignedUserId);
		const waitingByUser = groupBy(assignedWaiting, item => String(item.assignedUserId));

		const staff = members
			.map(member =>
				this.toStaffRow(
					member,
					replyStats(repliesByUser.get(member.userId) || []),
					volume.get(member.userId),
					waitingByUser.get(member.userId) || [],
					assignedCounts.get(member.userId),
					activity.get(member.userId),
					repliesByUser.get(member.userId) || [],
				),
			)
			.sort((left, right) => {
				// People online first, then whoever has chats waiting, then by last seen.
				if (left.online !== right.online) return left.online ? -1 : 1;
				const rank = paceRank(left.pace) - paceRank(right.pace);
				if (rank) return rank;
				if (right.waitingConversations !== left.waitingConversations) {
					return right.waitingConversations - left.waitingConversations;
				}
				return String(right.lastSeenAt || '').localeCompare(String(left.lastSeenAt || ''));
			});

		const bestToAssign =
			staff.find(item => item.online && item.pace === 'fast' && item.waitingConversations < 3) ||
			staff.find(item => item.pace === 'fast' && item.waitingConversations < 3) ||
			staff.find(item => item.pace === 'ok' && item.waitingConversations < 2) ||
			null;

		const team = replyStats(replies);
		const names = new Map(members.map(member => [member.userId, member.name]));
		const recent = replies.slice(0, 40);
		const titles = await this.loadTitles(accountId, recent.map(row => row.conversationId));

		return {
			period: { from: range.from.toISOString(), to: range.to.toISOString() },
			generatedAt: new Date().toISOString(),
			totals: {
				...totals,
				waitingConversations: assignedWaiting.length,
				overdueConversations: assignedWaiting.filter(item => Number(item.waitSeconds) >= 15 * 60)
					.length,
				unassignedWaiting: unassignedWaiting.length,
				repliesMeasured: team.replies,
				lateReplies: team.slowReplies15m,
				onlineNow: staff.filter(item => item.online).length,
			},
			averageResponseSeconds: team.medianResponseSeconds,
			bestToAssign: bestToAssign
				? { userId: bestToAssign.userId, name: bestToAssign.name, pace: bestToAssign.pace }
				: null,
			staff,
			waiting: assignedWaiting.slice(0, 40),
			unassigned: unassignedWaiting.slice(0, 20),
			recentReplies: recent.map(row => ({
				...row,
				userName: names.get(row.userId) || 'Staff',
				title: titles.get(row.conversationId) || 'Chat',
			})),
		};
	}

	async staffDetail(user: User, accountId: string, staffUserId: string, from?: string, to?: string) {
		await this.assertReportsRead(user, accountId);
		const members = await this.loadMembers(accountId);
		const member = members.find(item => item.userId === staffUserId);
		if (!member) throw new NotFoundException('Staff member is not on this WhatsApp account');
		const range = this.range(from, to);
		const [replies, volume, assignedCounts, waiting, activity, activityByUser] = await Promise.all([
			this.loadReplies(accountId, range, staffUserId),
			this.loadVolume(accountId, range),
			this.loadAssignedCounts(accountId),
			this.loadWaiting(accountId, staffUserId),
			this.loadActivity(accountId, staffUserId, range),
			this.loadActivityByUser(accountId, range, staffUserId),
		]);
		const titles = await this.loadTitles(
			accountId,
			replies.slice(0, 80).map(row => row.conversationId),
		);
		return {
			period: { from: range.from.toISOString(), to: range.to.toISOString() },
			staff: this.toStaffRow(
				member,
				replyStats(replies),
				volume.get(staffUserId),
				waiting,
				assignedCounts.get(staffUserId),
				activityByUser.get(staffUserId),
				replies,
			),
			replies: replies.slice(0, 80).map(row => ({
				...row,
				title: titles.get(row.conversationId) || 'Chat',
			})),
			waiting,
			activity,
		};
	}

	/**
	 * What one staff member did in the period: sessions, and per chat how often they opened it
	 * and how many messages they sent there.
	 */
	private async loadActivity(accountId: string, staffUserId: string, range: Range) {
		const [presence, sent]: [SqlRow[], SqlRow[]] = await Promise.all([
			this.messageRepo.query(
				`SELECT a.created_at AS at, a.action, a.target_id AS "conversationId"
				   FROM whatsapp_audit_logs a
				  WHERE a.account_id = $1 AND a.actor_user_id = $2
				    AND a.action = ANY($5::text[])
				    AND a.created_at BETWEEN $3 AND $4
				  ORDER BY a.created_at DESC
				  LIMIT 10000`,
				[accountId, staffUserId, range.from, range.to, PRESENCE_ACTIONS],
			),
			this.messageRepo.query(
				`SELECT m.provider_timestamp AS at, m.conversation_id AS "conversationId"
				   FROM whatsapp_messages m
				  WHERE m.account_id = $1 AND m.sender_user_id = $2
				    AND m.direction = 'outbound' AND m.deleted_at IS NULL
				    AND m.provider_timestamp BETWEEN $3 AND $4
				  ORDER BY m.provider_timestamp DESC
				  LIMIT 10000`,
				[accountId, staffUserId, range.from, range.to],
			),
		]);
		const opened = presence.filter(row => row.action === 'whatsapp.conversation.read');
		const events: StaffActivityEvent[] = [
			...presence.map(row => ({
				at: row.at as Date,
				kind: row.action === 'whatsapp.conversation.read' ? ('opened' as const) : ('present' as const),
				conversationId: row.action === 'whatsapp.conversation.read' ? String(row.conversationId || '') : null,
			})),
			...sent.map(row => ({
				at: row.at as Date,
				kind: 'replied' as const,
				conversationId: String(row.conversationId || ''),
			})),
		];
		const sessions = buildStaffSessions(events);

		const perChat = new Map<
			string,
			{ opened: number; lastOpenedAt: Date | null; sent: number; lastSentAt: Date | null }
		>();
		const touch = (id: string) => {
			let row = perChat.get(id);
			if (!row) {
				row = { opened: 0, lastOpenedAt: null, sent: 0, lastSentAt: null };
				perChat.set(id, row);
			}
			return row;
		};
		for (const row of opened) {
			const id = String(row.conversationId || '');
			if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
			const item = touch(id);
			item.opened += 1;
			const at = new Date(row.at as any);
			if (!item.lastOpenedAt || at > item.lastOpenedAt) item.lastOpenedAt = at;
		}
		for (const row of sent) {
			const id = String(row.conversationId || '');
			if (!id) continue;
			const item = touch(id);
			item.sent += 1;
			const at = new Date(row.at as any);
			if (!item.lastSentAt || at > item.lastSentAt) item.lastSentAt = at;
		}
		const ids = [...perChat.keys()];
		const titles = await this.loadTitles(accountId, ids);
		const chats = ids
			.filter(id => titles.has(id))
			.map(id => {
				const item = perChat.get(id)!;
				const last = [item.lastOpenedAt, item.lastSentAt]
					.filter((value): value is Date => Boolean(value))
					.sort((a, b) => b.getTime() - a.getTime())[0];
				return {
					conversationId: id,
					title: titles.get(id)!,
					timesOpened: item.opened,
					lastOpenedAt: item.lastOpenedAt?.toISOString() || null,
					messagesSent: item.sent,
					lastSentAt: item.lastSentAt?.toISOString() || null,
					lastActivityAt: last?.toISOString() || null,
				};
			})
			.sort((a, b) => String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || '')))
			.slice(0, 100);
		return {
			lastSeenAt: sessions[0]?.endedAt || null,
			totalActiveSeconds: sessions.reduce((sum, item) => sum + item.durationSeconds, 0),
			sessions: sessions.slice(0, 60),
			chats,
			openedChats: chats.filter(item => item.timesOpened > 0).length,
			repliedChats: chats.filter(item => item.messagesSent > 0).length,
		};
	}

	/**
	 * Per staff member: online now, last seen (looking back further than the period), time
	 * active and chats opened / answered in the period. Two queries for the whole team.
	 */
	private async loadActivityByUser(accountId: string, range: Range, onlyUserId?: string) {
		const userFilter = onlyUserId ? 'AND a.actor_user_id = $5' : '';
		const senderFilter = onlyUserId ? 'AND m.sender_user_id = $5' : '';
		const extra = onlyUserId ? [onlyUserId] : [];
		const [auditRows, sentRows, lastSeenRows]: [SqlRow[], SqlRow[], SqlRow[]] = await Promise.all([
			this.messageRepo.query(
				`SELECT a.actor_user_id AS "userId", a.created_at AS at, a.action, a.target_id AS "conversationId"
				   FROM whatsapp_audit_logs a
				  WHERE a.account_id = $1 AND a.actor_user_id IS NOT NULL
				    AND a.action = ANY($4::text[])
				    AND a.created_at BETWEEN $2 AND $3
				    ${userFilter}
				  LIMIT 50000`,
				[accountId, range.from, range.to, PRESENCE_ACTIONS, ...extra],
			),
			this.messageRepo.query(
				`SELECT m.sender_user_id AS "userId", m.provider_timestamp AS at, m.conversation_id AS "conversationId"
				   FROM whatsapp_messages m
				  WHERE m.account_id = $1 AND m.sender_user_id IS NOT NULL
				    AND m.direction = 'outbound' AND m.deleted_at IS NULL
				    AND m.provider_timestamp BETWEEN $2 AND $3
				    ${senderFilter.replace('$5', '$4')}
				  LIMIT 50000`,
				[accountId, range.from, range.to, ...extra],
			),
			this.messageRepo.query(
				`SELECT "userId", MAX(at) AS at FROM (
					SELECT a.actor_user_id AS "userId", MAX(a.created_at) AS at
					  FROM whatsapp_audit_logs a
					 WHERE a.account_id = $1 AND a.actor_user_id IS NOT NULL
					   AND a.action = ANY($2::text[])
					   AND a.created_at > NOW() - ($3 * INTERVAL '1 day')
					 GROUP BY a.actor_user_id
					UNION ALL
					SELECT m.sender_user_id AS "userId", MAX(m.provider_timestamp) AS at
					  FROM whatsapp_messages m
					 WHERE m.account_id = $1 AND m.sender_user_id IS NOT NULL
					   AND m.direction = 'outbound'
					   AND m.provider_timestamp > NOW() - ($3 * INTERVAL '1 day')
					 GROUP BY m.sender_user_id
				) seen GROUP BY "userId"`,
				[accountId, PRESENCE_ACTIONS, LAST_SEEN_LOOKBACK_DAYS],
			),
		]);
		const live = this.gateway.liveWatchersOfAccount(accountId);
		const eventsByUser = new Map<string, StaffActivityEvent[]>();
		const push = (userId: string, event: StaffActivityEvent) => {
			const list = eventsByUser.get(userId) || [];
			list.push(event);
			eventsByUser.set(userId, list);
		};
		for (const row of auditRows) {
			const opened = row.action === 'whatsapp.conversation.read';
			push(String(row.userId), {
				at: row.at as Date,
				kind: opened ? 'opened' : 'present',
				conversationId: opened ? String(row.conversationId || '') : null,
			});
		}
		for (const row of sentRows) {
			push(String(row.userId), {
				at: row.at as Date,
				kind: 'replied',
				conversationId: String(row.conversationId || ''),
			});
		}
		const lastSeen = new Map(lastSeenRows.map(row => [String(row.userId), new Date(row.at as any)]));
		const userIds = new Set([...eventsByUser.keys(), ...lastSeen.keys(), ...live.keys()]);
		const result = new Map<string, StaffActivitySummary>();
		for (const userId of userIds) {
			const events = eventsByUser.get(userId) || [];
			const sessions = buildStaffSessions(events);
			const opened = new Set(
				events.filter(event => event.kind === 'opened' && event.conversationId).map(event => String(event.conversationId)),
			);
			const replied = new Set(
				events.filter(event => event.kind === 'replied' && event.conversationId).map(event => String(event.conversationId)),
			);
			const liveAt = live.get(userId);
			const stored = lastSeen.get(userId);
			const seenAt = liveAt ? new Date(Math.max(liveAt, stored?.getTime() || 0)) : stored;
			result.set(userId, {
				online: live.has(userId),
				lastSeenAt: seenAt ? seenAt.toISOString() : null,
				activeSeconds: sessions.reduce((sum, item) => sum + item.durationSeconds, 0),
				sessions: sessions.length,
				chatsOpened: opened.size,
				repliedChats: replied.size,
				seenNoReply: [...opened].filter(id => !replied.has(id)).length,
				sessionSpans: sessions
					.slice(0, 400)
					.map(item => [Date.parse(item.startedAt), Date.parse(item.endedAt)] as [number, number])
					.reverse(),
			});
		}
		return result;
	}

	private async assertReportsRead(user: User, accountId: string) {
		const access = await this.access.getAccountAccess(user, accountId);
		if (!access.canManage && !access.canAssign) {
			throw new ForbiddenException('WhatsApp account permission denied: canAssign');
		}
	}

	private toStaffRow(
		member: { userId: string; name: string },
		stats: ReplyStats,
		volumeRow: { sentMessages: number; successfulMessages: number } | undefined,
		queue: Array<{ waitSeconds: number; inboundWaiting: number }>,
		assigned?: { assigned: number; unread: number },
		activity?: StaffActivitySummary,
		replyRows: ReplyRow[] = [],
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
			replies: stats.replies,
			avgResponseSeconds: stats.avgResponseSeconds,
			medianResponseSeconds: stats.medianResponseSeconds,
			p90ResponseSeconds: stats.p90ResponseSeconds,
			fastestResponseSeconds: stats.fastestResponseSeconds,
			slowestResponseSeconds: stats.slowestResponseSeconds,
			slowReplies15m: stats.slowReplies15m,
			slowReplies1h: stats.slowReplies1h,
			fastReplies5m: stats.fastReplies5m,
			lastReplyAt: stats.lastReplyAt,
			sentMessages: volumeRow?.sentMessages || 0,
			successfulMessages: volumeRow?.successfulMessages || 0,
			assignedConversations: assigned?.assigned || 0,
			waitingConversations: queue.length,
			waitingInboundMessages,
			unreadMessages: assigned?.unread || 0,
			oldestWaitSeconds: queue.length ? oldestWaitSeconds : null,
			online: Boolean(activity?.online),
			lastSeenAt: activity?.lastSeenAt || null,
			activeSeconds: activity?.activeSeconds || 0,
			sessions: activity?.sessions || 0,
			chatsOpened: activity?.chatsOpened || 0,
			repliedChats: activity?.repliedChats || 0,
			seenNoReply: activity?.seenNoReply || 0,
		};
		// Shift timeline: when they had WhatsApp open, and each reply with how long it took.
		const timeline = {
			sessions: activity?.sessionSpans || [],
			replies: replyRows
				.slice(0, 600)
				.map(row => [Date.parse(row.repliedAt), row.waitSeconds] as [number, number]),
		};
		const pace: StaffPace = staffPace(payload);
		return { ...payload, pace, timeline };
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

	private async loadTotals(accountId: string, range: Range) {
		const row: SqlRow = await this.messageRepo
			.query(
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
			)
			.then(rows => rows?.[0] || {});
		return {
			messages: Number(row?.messages || 0),
			inbound: Number(row?.inbound || 0),
			outbound: Number(row?.outbound || 0),
			failed: Number(row?.failed || 0),
			activeConversations: Number(row?.activeConversations || 0),
		};
	}

	private async loadReplies(accountId: string, range: Range, staffUserId?: string): Promise<ReplyRow[]> {
		const rows: SqlRow[] = await this.messageRepo.query(REPLIES_SQL, [
			accountId,
			range.from,
			range.to,
			SLA_MEASURE_MAX_SECONDS,
		]);
		return rows
			.filter(row => row.userId && (!staffUserId || String(row.userId) === staffUserId))
			.map(row => ({
				conversationId: String(row.conversationId),
				userId: String(row.userId),
				inboundAt: new Date(row.inboundAt as any).toISOString(),
				repliedAt: new Date(row.repliedAt as any).toISOString(),
				waitSeconds: Math.max(0, Math.round(Number(row.waitSeconds) || 0)),
			}));
	}

	private async loadVolume(accountId: string, range: Range) {
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
			rows.map(row => [
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
			.filter(row => row.canView || row.canUse)
			.map(row => ({
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
					COALESCE(SUM(au.unread_count), 0)::int AS unread
				FROM whatsapp_conversations c
				LEFT JOIN whatsapp_assignee_unread au
					ON au.conversation_id = c.id AND au.user_id = c.assigned_user_id
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
			rows.map(row => [
				row.userId,
				{ assigned: Number(row.assigned || 0), unread: Number(row.unread || 0) },
			]),
		);
	}

	/**
	 * Chats whose customer is waiting for a reply. Only the open-queue window is read: an
	 * outbound reply to a recent message is itself recent, so older messages never matter.
	 */
	private async loadWaiting(accountId: string, staffUserId?: string) {
		const params: unknown[] = [accountId, OPEN_QUEUE_MAX_AGE_SECONDS];
		let staffFilter = '';
		if (staffUserId) {
			params.push(staffUserId);
			staffFilter = `AND c.assigned_user_id = $3`;
		}
		const rows: SqlRow[] = await this.conversationRepo.query(
			`
			WITH recent AS (
				SELECT m.conversation_id, m.direction, m.provider_timestamp, m.created_at, m.id
				FROM whatsapp_messages m
				WHERE m.account_id = $1
					AND m.deleted_at IS NULL
					AND m.provider_timestamp >= NOW() - ($2 * INTERVAL '1 second')
			),
			last_msg AS (
				SELECT DISTINCT ON (conversation_id) conversation_id, direction
				FROM recent
				ORDER BY conversation_id, provider_timestamp DESC, created_at DESC, id DESC
			),
			last_out AS (
				SELECT conversation_id, MAX(provider_timestamp) AS ts
				FROM recent
				WHERE direction = 'outbound'
				GROUP BY conversation_id
			),
			waiting_inbound AS (
				SELECT
					r.conversation_id,
					COUNT(*)::int AS inbound_waiting,
					MIN(r.provider_timestamp) AS wait_started_at
				FROM recent r
				LEFT JOIN last_out o ON o.conversation_id = r.conversation_id
				WHERE r.direction = 'inbound'
					AND (o.ts IS NULL OR r.provider_timestamp > o.ts)
				GROUP BY r.conversation_id
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
				${CHAT_EXCLUSION}
				${staffFilter}
			ORDER BY w.wait_started_at ASC
			`,
			params,
		);
		return rows.map(row => ({
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

	private async loadTitles(accountId: string, conversationIds: string[]) {
		const ids = [...new Set(conversationIds.filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
		const titles = new Map<string, string>();
		if (!ids.length) return titles;
		const rows: SqlRow[] = await this.conversationRepo.query(
			`SELECT c.id, COALESCE(NULLIF(contact.name, ''), NULLIF(grp.subject, ''), c.provider_chat_id) AS title
			   FROM whatsapp_conversations c
			   LEFT JOIN whatsapp_contacts contact ON contact.id = c.contact_id
			   LEFT JOIN whatsapp_groups grp ON grp.id = c.group_id
			  WHERE c.account_id = $1 AND c.id = ANY($2::uuid[])`,
			[accountId, ids],
		);
		for (const row of rows) titles.set(String(row.id), String(row.title || 'Chat'));
		return titles;
	}
}

function groupBy<T>(items: T[], key: (item: T) => string) {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const id = key(item);
		const list = map.get(id) || [];
		list.push(item);
		map.set(id, list);
	}
	return map;
}
