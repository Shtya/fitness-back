/**
 * Seed a global (adminId = null) hypertrophy plan from the low-fatigue 4-day program.
 *
 * Usage: node scripts/seed-global-hypertrophy-plan.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const PLAN_NAME = '4-Day Hypertrophy — Low Fatigue';

const PROGRAM = {
	goal: 'Muscle hypertrophy with low fatigue',
	days: [
		{
			dayOfWeek: 'saturday',
			name: 'Push + Pull A',
			exercises: [
				{ name: 'Machine Chest Press', sets: 2, reps: '6-10' },
				{ name: 'Lat Pulldown', sets: 2, reps: '8-12' },
				{ name: 'Seated Cable Row', sets: 2, reps: '8-12' },
				{ name: 'Cable Lateral Raise', sets: 2, reps: '10-15' },
				{ name: 'Cable Triceps Pushdown', sets: 2, reps: '10-15' },
				{ name: 'Dumbbell Biceps Curl', sets: 2, reps: '10-15' },
			],
		},
		{
			dayOfWeek: 'sunday',
			name: 'Legs + Upper B',
			exercises: [
				{ name: 'Leg Press', sets: 2, reps: '8-12' },
				{ name: 'Leg Curl', sets: 2, reps: '10-15' },
				{ name: 'Incline Dumbbell Press', sets: 2, reps: '8-12' },
				{
					name: 'Chest-Supported Row',
					sets: 2,
					reps: '8-12',
					alternative: 'Seated Cable Row',
				},
				{ name: 'Cable Triceps Pushdown', sets: 2, reps: '10-15' },
				{ name: 'Hammer Curl', sets: 2, reps: '10-15' },
			],
		},
		{
			dayOfWeek: 'tuesday',
			name: 'Upper C',
			exercises: [
				{ name: 'Incline Dumbbell Press', sets: 2, reps: '8-12' },
				{ name: 'Neutral-Grip Lat Pulldown', sets: 2, reps: '8-12' },
				{
					name: 'Dumbbell Shoulder Press',
					sets: 2,
					reps: '8-12',
					alternative: 'Machine Shoulder Press',
				},
				{ name: 'Seated Cable Row', sets: 2, reps: '8-12' },
				{ name: 'Cable Lateral Raise', sets: 2, reps: '10-15' },
				{ name: 'Overhead Cable Triceps Extension', sets: 2, reps: '10-15' },
			],
		},
		{
			dayOfWeek: 'thursday',
			name: 'Legs + Upper D',
			exercises: [
				{ name: 'Hack Squat', sets: 2, reps: '8-12', alternative: 'Leg Press' },
				{ name: 'Leg Curl', sets: 2, reps: '10-15' },
				{
					name: 'Machine Chest Press',
					sets: 2,
					reps: '8-12',
					alternative: 'Dumbbell Bench Press',
				},
				{ name: 'Close-Grip Lat Pulldown', sets: 2, reps: '8-12' },
				{ name: 'Cable Lateral Raise', sets: 2, reps: '10-15' },
				{ name: 'Hammer Curl', sets: 2, reps: '10-15' },
			],
		},
	],
};

const NOTES = [
	'Goal: muscle hypertrophy with low fatigue (4 days/week).',
	'Max 6 exercises/day · 2 sets each · target RIR 1–3 · no failure.',
	'Compound reps ~6–12 · isolation reps ~10–15.',
	'Rest ~90s between sets unless noted otherwise.',
];

function loadEnv() {
	const envPath = path.join(root, '.env');
	return Object.fromEntries(
		fs
			.readFileSync(envPath, 'utf8')
			.split(/\r?\n/)
			.filter(line => line && !line.startsWith('#') && line.includes('='))
			.map(line => {
				const index = line.indexOf('=');
				return [line.slice(0, index), line.slice(index + 1)];
			}),
	);
}

function normalizeName(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

async function findExercise(client, name) {
	const exact = await client.query(
		`SELECT id, name FROM exercises
     WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM($1))
     ORDER BY created_at ASC
     LIMIT 1`,
		[name],
	);
	if (exact.rows[0]) return exact.rows[0];

	const fuzzy = await client.query(
		`SELECT id, name FROM exercises
     WHERE deleted_at IS NULL AND name ILIKE $1
     ORDER BY LENGTH(name) ASC, created_at ASC
     LIMIT 8`,
		[`%${name}%`],
	);
	if (!fuzzy.rows.length) return null;

	const target = normalizeName(name);
	return (
		fuzzy.rows.find(row => normalizeName(row.name) === target) ||
		fuzzy.rows.find(row => normalizeName(row.name).includes(target)) ||
		fuzzy.rows[0]
	);
}

async function ensureExercise(client, name, defaults = {}) {
	const existing = await findExercise(client, name);
	if (existing) return existing;

	const inserted = await client.query(
		`INSERT INTO exercises
      (name, details, category, "primaryMusclesWorked", "secondaryMusclesWorked",
       "targetReps", "targetSets", rest, tempo, img, video, "adminId")
     VALUES ($1, $2, $3, '{}', '{}', $4, $5, $6, NULL, NULL, NULL, NULL)
     RETURNING id, name`,
		[
			name,
			defaults.details || 'Seeded for global low-fatigue hypertrophy plan',
			defaults.category || 'Strength',
			defaults.targetReps || '8-12',
			defaults.targetSets || 2,
			defaults.rest || 90,
		],
	);
	console.log(`  + created exercise: ${name}`);
	return inserted.rows[0];
}

async function resolveExercise(client, exercise) {
	const resolved = await ensureExercise(client, exercise.name, {
		targetReps: exercise.reps,
		targetSets: exercise.sets,
	});
	let note = null;
	if (exercise.alternative) {
		await ensureExercise(client, exercise.alternative, {
			targetReps: exercise.reps,
			targetSets: exercise.sets,
		});
		note = `Alternative: ${exercise.alternative}`;
	}
	return {
		...resolved,
		note,
		targetSets: exercise.sets,
		targetReps: exercise.reps,
	};
}

async function insertPlanDay(client, planId, dayOfWeek, name) {
	try {
		return await client.query(
			`INSERT INTO exercise_plan_days (plan_id, day, name)
       VALUES ($1, $2::exercise_plan_days_day_enum, $3)
       RETURNING id, day, name`,
			[planId, dayOfWeek, name],
		);
	} catch (error) {
		const msg = String(error?.message || '');
		if (!msg.toLowerCase().includes('enum') && !msg.toLowerCase().includes('type')) {
			throw error;
		}
		return client.query(
			`INSERT INTO exercise_plan_days (plan_id, day, name)
       VALUES ($1, $2, $3)
       RETURNING id, day, name`,
			[planId, dayOfWeek, name],
		);
	}
}

async function main() {
	const env = loadEnv();
	const client = new pg.Client({
		host: env.DATABASE_HOST,
		port: Number(env.DATABASE_PORT),
		user: env.DATABASE_USER,
		password: env.DATABASE_PASSWORD,
		database: env.DATABASE_NAME,
		ssl: { rejectUnauthorized: false },
	});

	await client.connect();
	try {
		await client.query('BEGIN');

		const existing = await client.query(
			`SELECT id, name FROM exercise_plans
       WHERE deleted_at IS NULL AND "adminId" IS NULL AND name = $1
       LIMIT 1`,
			[PLAN_NAME],
		);
		if (existing.rows[0]) {
			console.log(`Plan already exists (global): ${existing.rows[0].id}`);
			console.log(`Name: ${existing.rows[0].name}`);
			await client.query('ROLLBACK');
			return;
		}

		console.log(`Creating global plan: ${PLAN_NAME}`);

		const planRes = await client.query(
			`INSERT INTO exercise_plans
        (name, "desc", "isActive", notes, warmup, cardio, "adminId")
       VALUES ($1, $2, true, $3, NULL, NULL, NULL)
       RETURNING id, name`,
			[PLAN_NAME, PROGRAM.goal, NOTES],
		);
		const plan = planRes.rows[0];
		console.log(`Plan id: ${plan.id}`);

		for (const day of PROGRAM.days) {
			const dayRes = await insertPlanDay(client, plan.id, day.dayOfWeek, day.name);
			const dayRow = dayRes.rows[0];
			console.log(`  Day ${day.dayOfWeek}: ${day.name}`);

			let order = 0;
			for (const ex of day.exercises) {
				const resolved = await resolveExercise(client, ex);
				await client.query(
					`INSERT INTO exercise_plan_day_exercises
            (day_id, exercise_id, order_index, target_sets, target_reps, rest_seconds, block, note)
           VALUES ($1, $2, $3, $4, $5, 90, 'main', $6)`,
					[
						dayRow.id,
						resolved.id,
						order,
						resolved.targetSets,
						resolved.targetReps,
						resolved.note,
					],
				);
				console.log(
					`    - ${resolved.name} · ${resolved.targetSets}x${resolved.targetReps}` +
						(resolved.note ? ` (${resolved.note})` : ''),
				);
				order += 1;
			}
		}

		await client.query('COMMIT');
		console.log('\nDone. Global plan ready to assign from Dashboard → Workouts → Plans.');
		console.log(`Plan ID: ${plan.id}`);
		console.log(`Plan name: ${PLAN_NAME}`);
	} catch (error) {
		await client.query('ROLLBACK').catch(() => undefined);
		console.error('Failed:', error instanceof Error ? error.message : error);
		process.exitCode = 1;
	} finally {
		await client.end();
	}
}

await main();
