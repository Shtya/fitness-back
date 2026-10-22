import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	WhatsAppConversation,
	WhatsAppConversationType,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
	TYPING_ATTEMPT_SCHEMA_STATEMENTS,
	TYPING_MESSAGE_SKEW_MS,
	TYPING_MESSAGE_WINDOW_MS,
	TYPING_STALE_MS,
	TypingAttemptLike,
	TypingPresenceSignal,
	attemptAcceptsMessage,
	decideTypingTransition,
	normalizeTypingAttemptFilter,
	serializeTypingAttempt,
	typingCheckpointSql,
	typingPresenceSignal,
	typingSentWithinMinutes,
	typingSentWithinSql,
} from '../utils/whatsapp-typing-attempts';
import { WhatsAppAccessService } from './whatsapp-access.service';

const SWEEP_INTERVAL_MS = 30_000;
const MAX_LIST_LIMIT = 200;

const ROW_SELECT = `
	a.*,
	c.assigned_user_id,
	COALESCE(NULLIF(TRIM(ct.local_name), ''), NULLIF(TRIM(ct.name), '')) AS contact_name`;
const ROW_JOINS = `
	JOIN whatsapp_conversations c ON c.id = a.conversation_id
	LEFT JOIN whatsapp_contacts ct ON ct.id = COALESCE(a.contact_id, c.contact_id)`;

type ConversationRef = Pick<
	WhatsAppConversation,
	'id' | 'accountId' | 'type' | 'providerChatId' | 'contactId' | 'assignedUserId'
> & { contact?: { phoneNumber?: string | null } | null };

/**
 * Typing attempts from real customer chatstate events. Runs beside message
 * delivery: every entry point swallows its own errors so tracking can never
 * block or fail send / receive.
 */
@Injectable()
export class WhatsAppTypingAttemptsService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(WhatsAppTypingAttemptsService.name);
	private ready: Promise<boolean> | null = null;
	private readonly queues = new Map<string, Promise<void>>();
	private sweepTimer: NodeJS.Timeout | null = null;
	private sweeping = false;

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		private readonly gateway: WhatsAppGateway,
		private readonly access: WhatsAppAccessService,
	) {}

	async onModuleInit() {
		await this.ensureSchema();
		this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
		this.sweepTimer.unref?.();
		// Closes rows left `typing` by a restart before the first interval tick.
		setTimeout(() => void this.sweep(), 5_000).unref?.();
	}

	onModuleDestroy() {
		if (this.sweepTimer) clearInterval(this.sweepTimer);
		this.sweepTimer = null;
	}

	private ensureSchema() {
		if (!this.ready) {
			this.ready = (async () => {
				let ok = true;
				for (const statement of TYPING_ATTEMPT_SCHEMA_STATEMENTS) {
					try {
						await this.dataSource.query(statement);
					} catch (error) {
						ok = false;
						this.logger.error(
							`Could not ensure typing attempts table: ${error instanceof Error ? error.message : error}`,
						);
					}
				}
				return ok;
			})();
		}
		return this.ready;
	}

	/** Serializes work per conversation so concurrent events cannot double-insert. */
	private enqueue(conversationId: string, task: () => Promise<void>) {
		const previous = this.queues.get(conversationId) || Promise.resolve();
		const next = previous
			.then(task)
			.catch((error) => {
				this.logger.warn(
					`[WHATSAPP TYPING] conv=${conversationId} failed: ${error instanceof Error ? error.message : error}`,
				);
			})
			.finally(() => {
				if (this.queues.get(conversationId) === next) this.queues.delete(conversationId);
			});
		this.queues.set(conversationId, next);
		return next;
	}

	/** Fire-and-forget hook for the presence pipeline. */
	recordPresence(conversation: ConversationRef, state: unknown, at = new Date()) {
		if (!conversation?.id || conversation.type !== WhatsAppConversationType.DIRECT) return;
		const signal = typingPresenceSignal(state);
		if (!signal) return;
		void this.enqueue(conversation.id, () => this.applySignal(conversation, signal, at));
	}

	/** Fire-and-forget hook for live inbound messages. */
	linkInboundMessage(
		conversation: ConversationRef,
		messageId: string,
		receivedAt = new Date(),
	) {
		if (!conversation?.id || !messageId) return;
		if (conversation.type !== WhatsAppConversationType.DIRECT) return;
		void this.enqueue(conversation.id, () =>
			this.applyMessage(conversation, messageId, receivedAt),
		);
	}

	private async latestAttempt(conversationId: string): Promise<TypingAttemptLike | null> {
		const rows = await this.dataSource.query(
			`SELECT id, status, started_at, last_typing_at, stopped_at
			   FROM whatsapp_typing_attempts
			  WHERE conversation_id = $1
			  ORDER BY started_at DESC
			  LIMIT 1`,
			[conversationId],
		);
		const row = rows?.[0];
		if (!row) return null;
		return {
			id: String(row.id),
			status: row.status,
			startedAt: new Date(row.started_at),
			lastTypingAt: new Date(row.last_typing_at),
			stoppedAt: row.stopped_at ? new Date(row.stopped_at) : null,
		};
	}

	private async applySignal(
		conversation: ConversationRef,
		signal: TypingPresenceSignal,
		at: Date,
	) {
		if (!(await this.ensureSchema())) return;
		const latest = await this.latestAttempt(conversation.id);
		const transition = decideTypingTransition(latest, signal, at);
		if (transition.action === 'noop') return;

		if (transition.action === 'stop') {
			const rows = await this.dataSource.query(
				`UPDATE whatsapp_typing_attempts
				    SET status = 'stopped', stopped_at = GREATEST($2::timestamptz, last_typing_at), updated_at = now()
				  WHERE id = $1 AND status = 'typing'
				RETURNING id`,
				[transition.id, at],
			);
			if (this.affected(rows)) await this.emitAttempt(transition.id);
			return;
		}

		const kind = signal === 'recording' ? 'recording' : 'typing';
		if (transition.action === 'extend') {
			const rows = await this.dataSource.query(
				`UPDATE whatsapp_typing_attempts
				    SET last_typing_at = GREATEST(last_typing_at, $2::timestamptz),
				        stopped_at = NULL,
				        event_count = event_count + 1,
				        kind = CASE WHEN $3 = 'recording' THEN 'recording' ELSE kind END,
				        checkpoint_minutes = 0,
				        updated_at = now(),
				        status = 'typing'
				  WHERE id = $1 AND status IN ('typing', 'stopped')
				RETURNING id`,
				[transition.id, at, kind],
			);
			// Only state changes are broadcast; repeated composing refreshes silently.
			if (this.affected(rows) && latest?.status === 'stopped') await this.emitAttempt(transition.id);
			return;
		}

		const contactId = conversation.contactId || null;
		const phone =
			String(conversation.contact?.phoneNumber || '').replace(/\D/g, '') ||
			String(conversation.providerChatId || '').split('@')[0].replace(/\D/g, '') ||
			null;
		const inserted = await this.dataSource.query(
			`INSERT INTO whatsapp_typing_attempts
			   (account_id, conversation_id, contact_id, chat_id, phone, kind, status, started_at, last_typing_at)
			 VALUES ($1, $2, $3, $4, $5, $6, 'typing', $7, $7)
			 ON CONFLICT (conversation_id) WHERE status = 'typing'
			 DO UPDATE SET last_typing_at = GREATEST(whatsapp_typing_attempts.last_typing_at, EXCLUDED.last_typing_at),
			               event_count = whatsapp_typing_attempts.event_count + 1,
			               updated_at = now()
			 RETURNING id`,
			[
				conversation.accountId,
				conversation.id,
				contactId,
				conversation.providerChatId || null,
				phone ? phone.slice(0, 40) : null,
				kind,
				at,
			],
		);
		const newId = inserted?.[0]?.id ? String(inserted[0].id) : null;
		if (!newId) return;
		if (transition.supersede && transition.supersede !== newId) {
			await this.dataSource.query(
				`UPDATE whatsapp_typing_attempts
				    SET superseded_by = $2, stopped_at = COALESCE(stopped_at, last_typing_at), updated_at = now()
				  WHERE id = $1 AND status IN ('typing', 'stopped')`,
				[transition.supersede, newId],
			);
		}
		this.logger.debug(
			`[WHATSAPP TYPING] attempt start conv=${conversation.id} attempt=${newId} kind=${kind}`,
		);
		await this.emitAttempt(newId);
	}

	private async applyMessage(conversation: ConversationRef, messageId: string, at: Date) {
		if (!(await this.ensureSchema())) return;
		const latest = await this.latestAttempt(conversation.id);
		if (!attemptAcceptsMessage(latest, at) || !latest) return;
		const gap = Math.max(0, at.getTime() - latest.lastTypingAt.getTime());
		const rows = await this.dataSource.query(
			`UPDATE whatsapp_typing_attempts
			    SET status = 'sent',
			        message_id = $2,
			        message_at = $3,
			        stopped_at = COALESCE(stopped_at, LEAST($3::timestamptz, GREATEST(last_typing_at, started_at))),
			        checkpoint_minutes = $4,
			        closed_at = $3,
			        updated_at = now()
			  WHERE id = $1
			    AND status IN ('typing', 'stopped')
			    AND NOT EXISTS (SELECT 1 FROM whatsapp_typing_attempts x WHERE x.message_id = $2)
			RETURNING id`,
			[latest.id, messageId, at, typingSentWithinMinutes(gap) ?? 30],
		);
		if (this.affected(rows)) {
			this.logger.debug(
				`[WHATSAPP TYPING] attempt sent conv=${conversation.id} attempt=${latest.id} message=${messageId} gapMs=${gap}`,
			);
			await this.emitAttempt(latest.id);
		}
	}

	private affected(rows: any) {
		if (Array.isArray(rows)) {
			if (Array.isArray(rows[0])) return rows[0].length > 0;
			return rows.length > 0;
		}
		return false;
	}

	/**
	 * Minute sweep for every open attempt with a handful of set-based updates
	 * (no per-customer timers). Survives restarts because state lives in the DB.
	 */
	async sweep() {
		if (this.sweeping) return;
		this.sweeping = true;
		try {
			if (!(await this.ensureSchema())) return;
			const changed = new Set<string>();
			const collect = (rows: any) => {
				const list = Array.isArray(rows?.[0]) ? rows[0] : rows;
				for (const row of Array.isArray(list) ? list : []) if (row?.id) changed.add(String(row.id));
			};

			collect(
				await this.dataSource.query(
					`UPDATE whatsapp_typing_attempts
					    SET status = 'stopped', stopped_at = last_typing_at, updated_at = now()
					  WHERE status = 'typing'
					    AND last_typing_at < now() - ($1::int * interval '1 millisecond')
					RETURNING id`,
					[TYPING_STALE_MS],
				),
			);

			// Live links can be missed (restart, message synced late from history):
			// link the earliest inbound message inside the window of the newest attempt.
			collect(
				await this.dataSource.query(
					`WITH candidate AS (
					   SELECT DISTINCT ON (a.id) a.id AS attempt_id, m.id AS message_id, m.provider_timestamp AS message_at
					     FROM whatsapp_typing_attempts a
					     JOIN whatsapp_messages m
					       ON m.conversation_id = a.conversation_id
					      AND m.direction = 'inbound'
					      AND m.provider_timestamp >= a.started_at - ($1::int * interval '1 millisecond')
					      AND m.provider_timestamp <= a.last_typing_at + ($2::int * interval '1 millisecond')
					    WHERE a.status IN ('typing', 'stopped')
					      AND a.superseded_by IS NULL
					      AND a.last_typing_at < now() - interval '20 seconds'
					      AND NOT EXISTS (SELECT 1 FROM whatsapp_typing_attempts x WHERE x.message_id = m.id)
					    ORDER BY a.id, m.provider_timestamp ASC
					 )
					 UPDATE whatsapp_typing_attempts a
					    SET status = 'sent',
					        message_id = candidate.message_id,
					        message_at = candidate.message_at,
					        stopped_at = COALESCE(a.stopped_at, a.last_typing_at),
					        checkpoint_minutes = ${typingSentWithinSql('candidate.message_at - a.last_typing_at')},
					        closed_at = candidate.message_at,
					        updated_at = now()
					   FROM candidate
					  WHERE a.id = candidate.attempt_id AND a.status IN ('typing', 'stopped')
					RETURNING a.id`,
					[TYPING_MESSAGE_SKEW_MS, TYPING_MESSAGE_WINDOW_MS],
				),
			);

			collect(
				await this.dataSource.query(
					`UPDATE whatsapp_typing_attempts
					    SET status = 'no_message',
					        checkpoint_minutes = 30,
					        stopped_at = COALESCE(stopped_at, last_typing_at),
					        closed_at = last_typing_at + ($1::int * interval '1 millisecond'),
					        updated_at = now()
					  WHERE status IN ('typing', 'stopped')
					    AND last_typing_at < now() - ($1::int * interval '1 millisecond')
					RETURNING id`,
					[TYPING_MESSAGE_WINDOW_MS],
				),
			);

			const checkpoint = typingCheckpointSql('last_typing_at');
			collect(
				await this.dataSource.query(
					`UPDATE whatsapp_typing_attempts
					    SET checkpoint_minutes = ${checkpoint}, updated_at = now()
					  WHERE status = 'stopped'
					    AND checkpoint_minutes < ${checkpoint}
					RETURNING id`,
				),
			);

			if (changed.size) await this.emitAttempts([...changed]);
		} catch (error) {
			this.logger.warn(
				`[WHATSAPP TYPING] sweep failed: ${error instanceof Error ? error.message : error}`,
			);
		} finally {
			this.sweeping = false;
		}
	}

	private async emitAttempt(id: string) {
		await this.emitAttempts([id]);
	}

	private async emitAttempts(ids: string[]) {
		if (!ids.length) return;
		const rows = await this.dataSource.query(
			`SELECT ${ROW_SELECT} FROM whatsapp_typing_attempts a ${ROW_JOINS} WHERE a.id = ANY($1::uuid[])`,
			[ids],
		);
		const now = new Date();
		for (const row of rows || []) {
			const attempt = serializeTypingAttempt(row, now);
			this.gateway.emitConversationEvent(
				attempt.conversationId,
				'typing_attempt',
				{ conversationId: attempt.conversationId, attempt },
				attempt.accountId,
				{ assignedUserId: row.assigned_user_id || null },
			);
		}
	}

	async list(
		user: User,
		query: {
			accountId?: string;
			conversationId?: string;
			filter?: string;
			from?: string;
			to?: string;
			q?: string;
			limit?: number | string;
			offset?: number | string;
		},
	) {
		await this.ensureSchema();
		const params: unknown[] = [];
		const where: string[] = [];
		const add = (sql: string, value: unknown) => {
			params.push(value);
			where.push(sql.replace('?', `$${params.length}`));
		};

		const conversationId = String(query.conversationId || '').trim();
		if (conversationId) {
			if (!isUUID(conversationId)) throw new BadRequestException('Invalid conversation id');
			const { conversation } = await this.access.assertConversationVisible(user, conversationId);
			add('a.conversation_id = ?', conversation.id);
		} else {
			const accountId = String(query.accountId || '').trim();
			if (!accountId || !isUUID(accountId)) throw new BadRequestException('Account id is required');
			const access = await this.access.getAccountAccess(user, accountId);
			if (!access.canView) throw new ForbiddenException('WhatsApp account permission denied: canView');
			add('a.account_id = ?', accountId);
			if (!this.access.canSeeAllConversations(user, access)) add('c.assigned_user_id = ?', user.id);
		}

		const from = query.from ? new Date(String(query.from)) : null;
		const to = query.to ? new Date(String(query.to)) : null;
		if (from && !Number.isNaN(from.getTime())) add('a.started_at >= ?', from);
		if (to && !Number.isNaN(to.getTime())) add('a.started_at < ?', to);

		const q = String(query.q || '').trim().slice(0, 80);
		if (q) {
			const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
			params.push(like);
			const p = `$${params.length}`;
			const digits = q.replace(/\D/g, '');
			let phoneClause = '';
			if (digits.length >= 3) {
				params.push(`%${digits}%`);
				phoneClause = ` OR a.phone LIKE $${params.length}`;
			}
			where.push(
				`(ct.name ILIKE ${p} OR ct.local_name ILIKE ${p} OR a.chat_id ILIKE ${p}${phoneClause})`,
			);
		}

		const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
		const filter = normalizeTypingAttemptFilter(query.filter);
		const statusFor: Record<string, string | null> = {
			all: null,
			typing: 'typing',
			sent: 'sent',
			no_message: 'no_message',
			waiting: 'stopped',
		};
		const status = statusFor[filter];
		const listParams = [...params];
		let listWhere = baseWhere;
		if (status) {
			listParams.push(status);
			listWhere = `${baseWhere ? `${baseWhere} AND` : 'WHERE'} a.status = $${listParams.length}`;
		}
		const limit = Math.min(Math.max(Number(query.limit) || 50, 1), MAX_LIST_LIMIT);
		const offset = Math.max(Number(query.offset) || 0, 0);
		listParams.push(limit + 1, offset);

		const [rows, counts] = await Promise.all([
			this.dataSource.query(
				`SELECT ${ROW_SELECT}
				   FROM whatsapp_typing_attempts a ${ROW_JOINS}
				   ${listWhere}
				  ORDER BY a.started_at DESC, a.id DESC
				  LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
				listParams,
			),
			this.dataSource.query(
				`SELECT COUNT(*)::int AS "all",
				        COUNT(*) FILTER (WHERE a.status = 'typing')::int AS typing,
				        COUNT(*) FILTER (WHERE a.status = 'stopped')::int AS waiting,
				        COUNT(*) FILTER (WHERE a.status = 'sent')::int AS sent,
				        COUNT(*) FILTER (WHERE a.status = 'no_message')::int AS no_message
				   FROM whatsapp_typing_attempts a ${ROW_JOINS}
				   ${baseWhere}`,
				params,
			),
		]);
		const now = new Date();
		const items = (rows || []).slice(0, limit).map((row: any) => serializeTypingAttempt(row, now));
		return {
			items,
			hasMore: (rows || []).length > limit,
			counts: counts?.[0] || { all: 0, typing: 0, waiting: 0, sent: 0, no_message: 0 },
			now: now.toISOString(),
		};
	}
}