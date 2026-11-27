import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../../../entities/global.entity';
import { WhatsAppAuditLog } from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
	PRESENCE_OFFLINE_ACTION,
	PRESENCE_ONLINE_ACTION,
	STAFF_SESSION_ACTION,
	buildPresenceSessions,
	type PresenceEvent,
} from '../utils/whatsapp-staff-activity';

const ACTIONS = [PRESENCE_ONLINE_ACTION, PRESENCE_OFFLINE_ACTION, STAFF_SESSION_ACTION];
const MAX_PEOPLE = 300;
const MAX_ROWS = 60_000;
const MAX_SESSIONS = 300;

const KIND: Record<string, PresenceEvent['kind']> = {
	[PRESENCE_ONLINE_ACTION]: 'online',
	[PRESENCE_OFFLINE_ACTION]: 'offline',
	[STAFF_SESSION_ACTION]: 'active',
};

/**
 * When the team opened and closed WhatsApp (the "Have WhatsApp open now" popover's history).
 * Admins see the people they own (user.adminId); a super admin sees everyone with activity.
 */
@Injectable()
export class WhatsAppStaffPresenceService {
	constructor(
		@InjectRepository(User) private readonly users: Repository<User>,
		@InjectRepository(WhatsAppAuditLog) private readonly logs: Repository<WhatsAppAuditLog>,
		private readonly gateway: WhatsAppGateway,
	) {}

	async history(actor: User, daysRaw?: string, userId?: string) {
		const role = actor?.role;
		if (role !== UserRole.ADMIN && role !== UserRole.SUPER_ADMIN) {
			throw new ForbiddenException('Only admins can see the team history');
		}
		const days = Math.min(30, Math.max(1, Number.parseInt(String(daysRaw || '7'), 10) || 7));
		const to = new Date();
		const from = new Date(to.getTime() - days * 86_400_000);

		let people: User[];
		if (role === UserRole.SUPER_ADMIN) {
			const ids = await this.logs
				.createQueryBuilder('l')
				.select('DISTINCT l.actorUserId', 'id')
				.where('l.action IN (:...actions)', { actions: ACTIONS })
				.andWhere('l.created_at >= :from', { from })
				.andWhere('l.actorUserId IS NOT NULL')
				.limit(MAX_PEOPLE)
				.getRawMany<{ id: string }>();
			const list = ids.map(r => String(r.id)).filter(id => id && id !== String(actor.id));
			people = list.length ? await this.users.find({ where: { id: In(list) } }) : [];
		} else {
			people = await this.users.find({ where: { adminId: String(actor.id) }, take: MAX_PEOPLE });
		}
		if (userId) people = people.filter(u => String(u.id) === String(userId));
		people = people.filter(u => u.role !== UserRole.SUPER_ADMIN);
		if (!people.length) return { from: from.toISOString(), to: to.toISOString(), days, people: [] };

		const ids = people.map(u => String(u.id));
		const rows = await this.logs
			.createQueryBuilder('l')
			.select(['l.id', 'l.actorUserId', 'l.action', 'l.created_at'])
			.where('l.actorUserId IN (:...ids)', { ids })
			.andWhere('l.action IN (:...actions)', { actions: ACTIONS })
			.andWhere('l.created_at >= :from', { from })
			.orderBy('l.created_at', 'ASC')
			.take(MAX_ROWS)
			.getMany();
		const byUser = new Map<string, PresenceEvent[]>();
		for (const row of rows) {
			const kind = KIND[row.action];
			if (!kind || !row.actorUserId) continue;
			const list = byUser.get(String(row.actorUserId)) || [];
			list.push({ at: row.created_at, kind });
			byUser.set(String(row.actorUserId), list);
		}

		const now = Date.now();
		const result = people.map(u => {
			const id = String(u.id);
			const online = this.gateway.isUserOnline(id);
			const sessions = buildPresenceSessions(byUser.get(id) || [], { onlineNow: online, now }).slice(0, MAX_SESSIONS);
			const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
			const last = sessions[0];
			return {
				userId: id,
				name: String(u.name || u.email || 'User').trim() || 'User',
				role: u.role ? String(u.role) : null,
				online,
				lastSeenAt: online ? new Date(now).toISOString() : last ? last.endedAt || last.startedAt : null,
				totalSeconds,
				sessions,
			};
		});
		// online first, then whoever was here most recently, then the rest by name
		result.sort(
			(a, b) =>
				Number(b.online) - Number(a.online) ||
				(Date.parse(b.lastSeenAt || '') || 0) - (Date.parse(a.lastSeenAt || '') || 0) ||
				a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
		);
		return { from: from.toISOString(), to: to.toISOString(), days, people: result };
	}
}
