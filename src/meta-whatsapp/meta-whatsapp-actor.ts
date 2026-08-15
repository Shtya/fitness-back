import { UserRole } from 'entities/global.entity';

export type MetaWaActor = {
	id: string;
	tenantId?: string | null;
	adminId?: string | null;
	role?: string | UserRole;
	email?: string | null;
};

/** Gym coaches share the admin’s WABA. Everyone else owns their own row. */
export function metaWaOwnerUserId(actor: MetaWaActor) {
	const role = String(actor.role || '').toLowerCase();
	if (role === UserRole.COACH && actor.adminId) return actor.adminId;
	return actor.id;
}
