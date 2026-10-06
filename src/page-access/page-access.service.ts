import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User, UserRole } from '../../entities/global.entity';
import { MAX_PAGE_IDS, PAGE_ID_PATTERN, UpdateUserPagesDto } from './page-access.dto';
import {
	MANAGED_PAGE_ROLES,
	ManagedPageRole,
	PAGE_MODES,
	PageMode,
	RolePageSetting,
	UserPageOverride,
} from './page-access.entity';

export type RolePageModes = Record<string, PageMode>;

export type UserPageAccess = {
	roleModes: RolePageModes;
	extraPages: string[];
	lockedPages: string[];
	/** Page ids explicitly set to shown, including ones outside the role's built-in menu. */
	granted: string[];
	/** Effective locked ids after user overrides; used by the frontend middleware. */
	locked: string[];
};

const EMPTY_ACCESS: UserPageAccess = { roleModes: {}, extraPages: [], lockedPages: [], locked: [], granted: [] };

/**
 * Store-admin tools — hidden for gym roles until Page Access sets them to "default".
 * Keep in sync with ITEM_META.defaultLocked in the frontend Sidebar.
 */
export const DEFAULT_LOCKED_PAGE_IDS = [
	'transcript',
	'learning',
	'learningManagement',
	'learningStudy',
	'webTranslator',
	'siteInspector',
	'phoneCheck',
	'fitnessLeads',
	'metaWhatsApp',
	'facebookEngagement',
	'money',
] as const;

export function isManagedPageRole(role: unknown): role is ManagedPageRole {
	return MANAGED_PAGE_ROLES.includes(role as ManagedPageRole);
}

/**
 * Effective locked page ids for middleware:
 * - start from Store-admin defaults
 * - apply roleModes (default unlocks; locked/optional hide)
 * - apply per-user locks / extras
 */
export function effectiveLockedPages(roleModes: RolePageModes, extraPages: string[], lockedPages: string[], role?: string) {
	const skipDefaults = role === 'super_admin' || role === UserRole.SUPER_ADMIN;
	const locked = new Set<string>(skipDefaults ? [] : DEFAULT_LOCKED_PAGE_IDS);
	for (const [id, mode] of Object.entries(roleModes || {})) {
		if (mode === 'locked' || mode === 'optional') locked.add(id);
		else if (mode === 'default') locked.delete(id);
	}
	for (const id of lockedPages) locked.add(id);
	for (const id of extraPages) locked.delete(id);
	return [...locked].sort();
}

function isMissingTable(error: unknown) {
	const code = (error as { code?: string; driverError?: { code?: string } })?.code
		?? (error as { driverError?: { code?: string } })?.driverError?.code;
	return code === '42P01';
}

@Injectable()
export class PageAccessService {
	private readonly logger = new Logger(PageAccessService.name);
	private missingTablesLogged = false;

	constructor(
		@InjectRepository(RolePageSetting) private readonly roleSettings: Repository<RolePageSetting>,
		@InjectRepository(UserPageOverride) private readonly overrides: Repository<UserPageOverride>,
		@InjectRepository(User) private readonly users: Repository<User>,
		@InjectDataSource() private readonly dataSource: DataSource,
	) {}

	async listRoles() {
		const blank = (): Record<ManagedPageRole, RolePageModes> =>
			Object.fromEntries(MANAGED_PAGE_ROLES.map(role => [role, {}])) as Record<ManagedPageRole, RolePageModes>;
		return this.tolerateMissingTables(async () => {
			const rows = await this.roleSettings.find();
			const roles = blank();
			for (const row of rows) {
				if (isManagedPageRole(row.role)) roles[row.role][row.pageId] = row.mode;
			}
			return { roles };
		}, { roles: blank() });
	}

	async replaceRole(role: string, rawModes: Record<string, string>, actorId: string) {
		if (!isManagedPageRole(role)) throw new BadRequestException(`Role must be one of: ${MANAGED_PAGE_ROLES.join(', ')}`);
		const modes = this.cleanModes(rawModes);
		await this.dataSource.transaction(async manager => {
			const repo = manager.getRepository(RolePageSetting);
			await repo.delete({ role });
			const rows = Object.entries(modes).map(([pageId, mode]) => ({ role, pageId, mode, updatedBy: actorId }));
			if (rows.length) await repo.insert(rows);
		});
		return { role, modes };
	}

	/** Never throws for missing tables, so login keeps working before the migration is applied. */
	async forUser(user: Pick<User, 'id' | 'role'>): Promise<UserPageAccess> {
		if (!isManagedPageRole(user.role)) return EMPTY_ACCESS;
		return this.tolerateMissingTables(async () => {
			const [rows, override] = await Promise.all([
				this.roleSettings.find({ where: { role: user.role as ManagedPageRole } }),
				this.overrides.findOne({ where: { userId: user.id } }),
			]);
			const roleModes: RolePageModes = Object.fromEntries(rows.map(row => [row.pageId, row.mode]));
			const extraPages = override?.extraPages ?? [];
			const lockedPages = override?.lockedPages ?? [];
			const granted = [...new Set([
				...Object.entries(roleModes).filter(([, mode]) => mode === 'default').map(([id]) => id),
				...extraPages,
			])].sort();
			return {
				roleModes,
				extraPages,
				lockedPages,
				granted,
				locked: effectiveLockedPages(roleModes, extraPages, lockedPages, user.role),
			};
		}, EMPTY_ACCESS);
	}

	/** Override counts per user for list screens. */
	async overrideSummaries(userIds: string[]): Promise<Record<string, { extra: number; locked: number }>> {
		if (!userIds.length) return {};
		return this.tolerateMissingTables(async () => {
			const rows = await this.overrides.find({ where: { userId: In(userIds) } });
			return Object.fromEntries(rows.map(row => [row.userId, { extra: row.extraPages.length, locked: row.lockedPages.length }]));
		}, {});
	}

	private async tolerateMissingTables<T>(run: () => Promise<T>, fallback: T): Promise<T> {
		try {
			return await run();
		} catch (error) {
			if (!isMissingTable(error)) throw error;
			if (!this.missingTablesLogged) {
				this.logger.warn('Page access tables are missing; apply migrations/20260930_page_access.sql');
				this.missingTablesLogged = true;
			}
			return fallback;
		}
	}

	async getUser(targetUserId: string) {
		const user = await this.managedUser(targetUserId);
		return this.userSummary(user);
	}

	async setUser(targetUserId: string, dto: UpdateUserPagesDto, actorId: string) {
		const user = await this.managedUser(targetUserId);
		const extraPages = this.cleanIds(dto.extraPages);
		const lockedPages = this.cleanIds(dto.lockedPages);
		const both = extraPages.filter(id => lockedPages.includes(id));
		if (both.length) throw new BadRequestException(`Pages cannot be both shown and locked: ${both.join(', ')}`);

		const landing = dto.loginLandingPage ? String(dto.loginLandingPage).trim() : '';
		if (landing) {
			if (!PAGE_ID_PATTERN.test(landing)) throw new BadRequestException('Invalid login landing page');
			const rows = await this.roleSettings.find({ where: { role: user.role as ManagedPageRole } });
			const roleModes: RolePageModes = Object.fromEntries(rows.map(row => [row.pageId, row.mode]));
			if (effectiveLockedPages(roleModes, extraPages, lockedPages).includes(landing)) {
				throw new BadRequestException('The login landing page is locked for this user');
			}
		}

		await this.dataSource.transaction(async manager => {
			const repo = manager.getRepository(UserPageOverride);
			if (extraPages.length || lockedPages.length) {
				await repo.upsert({ userId: user.id, extraPages, lockedPages, updatedBy: actorId }, ['userId']);
			} else {
				await repo.delete({ userId: user.id });
			}
			await manager.getRepository(User).update(
				{ id: user.id },
				{ allowedPages: null, loginLandingPage: landing || null },
			);
		});

		return this.userSummary(await this.managedUser(user.id));
	}

	private async managedUser(targetUserId: string) {
		const user = await this.users.findOne({ where: { id: targetUserId } });
		if (!user) throw new NotFoundException('User not found');
		if (user.role === UserRole.SUPER_ADMIN) throw new ForbiddenException('Super admin pages cannot be restricted');
		if (!isManagedPageRole(user.role)) throw new BadRequestException('Unsupported role');
		return user;
	}

	private async userSummary(user: User) {
		return {
			id: user.id,
			role: user.role,
			allowedPages: user.allowedPages ?? null,
			loginLandingPage: user.loginLandingPage ?? null,
			pageAccess: await this.forUser(user),
		};
	}

	private cleanIds(ids: string[] | undefined) {
		return [...new Set((ids ?? []).map(id => String(id).trim()).filter(id => PAGE_ID_PATTERN.test(id)))];
	}

	private cleanModes(raw: Record<string, string>) {
		const entries = Object.entries(raw ?? {});
		if (entries.length > MAX_PAGE_IDS) throw new BadRequestException(`At most ${MAX_PAGE_IDS} pages per role`);
		const modes: RolePageModes = {};
		for (const [pageId, mode] of entries) {
			if (!PAGE_ID_PATTERN.test(pageId)) throw new BadRequestException(`Invalid page id: ${pageId}`);
			if (!PAGE_MODES.includes(mode as PageMode)) throw new BadRequestException(`Invalid mode for ${pageId}: ${mode}`);
			modes[pageId] = mode as PageMode;
		}
		return modes;
	}
}
