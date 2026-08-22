const WEEKDAY_TO_INDEX: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
};

export function parseTimeOfDay(value: string | null | undefined): { hour: number; minute: number } {
	const raw = String(value || '09:00').trim();
	const match = raw.match(/^(\d{1,2}):(\d{2})$/);
	if (!match) return { hour: 9, minute: 0 };
	const hour = Math.min(23, Math.max(0, Number(match[1])));
	const minute = Math.min(59, Math.max(0, Number(match[2])));
	return { hour, minute };
}

export function normalizeDaysOfWeek(days: number[] | null | undefined): number[] {
	const list = Array.isArray(days) ? days : [];
	const normalized = [...new Set(list.map(day => Number(day)).filter(day => day >= 0 && day <= 6))];
	return normalized.sort((a, b) => a - b);
}

export function everyDayOfWeek(): number[] {
	return [0, 1, 2, 3, 4, 5, 6];
}

function getZonedParts(date: Date, timeZone: string) {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	});
	const parts = formatter.formatToParts(date);
	const read = (type: string) => parts.find(part => part.type === type)?.value || '';
	const weekday = read('weekday').replace(/\.$/, '');
	return {
		year: Number(read('year')),
		month: Number(read('month')),
		day: Number(read('day')),
		hour: Number(read('hour') === '24' ? '0' : read('hour')),
		minute: Number(read('minute')),
		weekdayIndex: WEEKDAY_TO_INDEX[weekday] ?? 0,
	};
}

function zonedLocalToUtc(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timeZone: string,
): Date {
	for (let offsetHours = -14; offsetHours <= 14; offsetHours += 1) {
		const candidate = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0));
		const parts = getZonedParts(candidate, timeZone);
		if (
			parts.year === year &&
			parts.month === month &&
			parts.day === day &&
			parts.hour === hour &&
			parts.minute === minute
		) {
			return candidate;
		}
	}
	return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0, 0));
}

function addDaysToLocalDate(
	year: number,
	month: number,
	day: number,
	deltaDays: number,
	timeZone: string,
) {
	const anchor = zonedLocalToUtc(year, month, day, 12, 0, timeZone);
	const next = new Date(anchor.getTime() + deltaDays * 24 * 60 * 60 * 1000);
	const parts = getZonedParts(next, timeZone);
	return { year: parts.year, month: parts.month, day: parts.day };
}

export function computeNextRecurringRunAt(input: {
	after: Date;
	timeOfDay: string;
	daysOfWeek: number[];
	timezone: string;
	recurrenceStartDate?: string | Date | null;
	recurrenceEndDate?: string | Date | null;
}): Date | null {
	const timezone = input.timezone || 'Asia/Qatar';
	const days = normalizeDaysOfWeek(input.daysOfWeek);
	if (!days.length) return null;
	const { hour, minute } = parseTimeOfDay(input.timeOfDay);
	const afterParts = getZonedParts(input.after, timezone);
	let year = afterParts.year;
	let month = afterParts.month;
	let day = afterParts.day;

	if (input.recurrenceStartDate) {
		const start = new Date(input.recurrenceStartDate);
		const startParts = getZonedParts(start, timezone);
		if (
			startParts.year > year ||
			(startParts.year === year && startParts.month > month) ||
			(startParts.year === year && startParts.month === month && startParts.day > day)
		) {
			year = startParts.year;
			month = startParts.month;
			day = startParts.day;
		}
	}

	for (let offset = 0; offset < 370; offset += 1) {
		const cursor =
			offset === 0
				? { year, month, day }
				: addDaysToLocalDate(year, month, day, offset, timezone);
		const cursorParts = getZonedParts(
			zonedLocalToUtc(cursor.year, cursor.month, cursor.day, 12, 0, timezone),
			timezone,
		);
		if (!days.includes(cursorParts.weekdayIndex)) continue;
		const candidate = zonedLocalToUtc(cursor.year, cursor.month, cursor.day, hour, minute, timezone);
		if (candidate.getTime() <= input.after.getTime()) continue;
		if (input.recurrenceEndDate) {
			const endParts = getZonedParts(new Date(input.recurrenceEndDate), timezone);
			const endUtc = zonedLocalToUtc(endParts.year, endParts.month, endParts.day, 23, 59, timezone);
			if (candidate.getTime() > endUtc.getTime()) return null;
		}
		return candidate;
	}
	return null;
}

export function computeInitialNextRunAt(input: {
	scheduleKind: 'once' | 'recurring';
	scheduledAt?: string | Date | null;
	timeOfDay?: string | null;
	daysOfWeek?: number[] | null;
	timezone?: string | null;
	recurrenceStartDate?: string | Date | null;
	recurrenceEndDate?: string | Date | null;
	now?: Date;
}): Date | null {
	const now = input.now || new Date();
	if (input.scheduleKind === 'once') {
		if (!input.scheduledAt) return null;
		const at = new Date(input.scheduledAt);
		return Number.isFinite(at.getTime()) ? at : null;
	}
	return computeNextRecurringRunAt({
		after: now,
		timeOfDay: input.timeOfDay || '09:00',
		daysOfWeek: normalizeDaysOfWeek(input.daysOfWeek),
		timezone: input.timezone || 'Asia/Qatar',
		recurrenceStartDate: input.recurrenceStartDate,
		recurrenceEndDate: input.recurrenceEndDate,
	});
}
