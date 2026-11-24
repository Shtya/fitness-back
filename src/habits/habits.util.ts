/** Cleaning and merging for the habit tracker document (kept free of Nest for tests). */

export const HABITS_MAX = 100;
export const CARDS_MAX = 60;
export const LOG_DAYS_MAX = 800;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w-]{1,48}$/;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const day = (v: unknown) => (typeof v === 'string' && DAY.test(v) ? v : '');
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export function cleanHabit(raw: unknown): Record<string, any> | null {
	const h = obj(raw);
	if (!ID.test(String(h.id || ''))) return null;
	const s = obj(h.schedule);
	const log: Record<string, any> = {};
	Object.entries(obj(h.log))
		.filter(([k]) => DAY.test(k))
		.sort(([a], [b]) => (a < b ? 1 : -1))
		.slice(0, LOG_DAYS_MAX)
		.forEach(([k, v]) => {
			const e = obj(v);
			if (e.s === 'done' || e.s === 'skip') log[k] = { s: e.s };
			else if (Array.isArray(e.sub)) {
				const sub = e.sub.filter((x: unknown) => typeof x === 'string' && ID.test(x)).slice(0, 20);
				if (sub.length) log[k] = { sub };
			}
		});
	return {
		id: String(h.id),
		title: str(h.title, 120),
		icon: str(h.icon, 8),
		color: str(h.color, 16),
		link: str(h.link, 600),
		notes: str(h.notes, 4000),
		subtasks: arr(h.subtasks)
			.map(x => obj(x))
			.filter(x => ID.test(String(x.id || '')) && str(x.text, 160).trim())
			.slice(0, 20)
			.map(x => ({ id: String(x.id), text: str(x.text, 160) })),
		schedule: {
			type: ['daily', 'weekdays', 'interval'].includes(s.type) ? s.type : 'daily',
			days: arr(s.days)
				.map(Number)
				.filter(d => Number.isInteger(d) && d >= 0 && d <= 6),
			every: Math.max(2, Math.min(30, Math.round(num(s.every)) || 2)),
		},
		start: day(h.start),
		end: day(h.end),
		pauses: arr(h.pauses)
			.map(p => obj(p))
			.filter(p => day(p.from))
			.slice(-50)
			.map(p => ({ from: day(p.from), to: day(p.to) })),
		snoozedFrom: day(h.snoozedFrom),
		snoozedUntil: day(h.snoozedUntil),
		pinned: Boolean(h.pinned),
		archived: Boolean(h.archived),
		order: num(h.order),
		log,
		createdAt: num(h.createdAt),
		updatedAt: num(h.updatedAt),
		...(h.deletedAt ? { deletedAt: num(h.deletedAt) || 1 } : {}),
	};
}

export function cleanCard(raw: unknown): Record<string, any> | null {
	const c = obj(raw);
	if (!ID.test(String(c.id || ''))) return null;
	return {
		id: String(c.id),
		text: str(c.text, 280),
		tone: str(c.tone, 12),
		order: num(c.order),
		createdAt: num(c.createdAt),
		updatedAt: num(c.updatedAt),
		...(c.deletedAt ? { deletedAt: num(c.deletedAt) || 1 } : {}),
	};
}

/** Newest edit of each id wins; tombstones (deletedAt) older than 60 days are dropped. */
export function mergeById(current: unknown, incoming: unknown, clean: (x: unknown) => Record<string, any> | null, max: number, now = Date.now()) {
	const byId = new Map<string, Record<string, any>>();
	[...arr(current), ...arr(incoming)].forEach(raw => {
		const x = clean(raw);
		if (!x) return;
		const prev = byId.get(x.id);
		if (!prev || x.updatedAt >= prev.updatedAt) byId.set(x.id, x);
	});
	return [...byId.values()].filter(x => !x.deletedAt || now - x.deletedAt < 60 * 86_400_000).slice(-max);
}

export const cleanDay = day;
