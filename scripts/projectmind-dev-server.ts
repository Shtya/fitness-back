/**
 * ProjectMind LOCAL DEV HARNESS (not part of the production app).
 *
 * Boots ONLY the ProjectMind module (+ the shared AiModule) against a LOCAL Postgres so the UI and E2E tests can
 * be exercised without the full So7baFit backend or the shared production database.
 *   - Refuses to start unless the DB host is local.
 *   - Replaces JwtAuthGuard with a fixed dev user (header `x-dev-user: b` switches to a second tenant for isolation checks).
 *   - Does NOT fake AI: with no provider key saved, chat/meeting prep/simulator report "not configured" exactly as production does.
 *
 *   PROJECTMIND_DEV_DB=postgres://pmtest@127.0.0.1:54329/pmtest PORT=4010 \
 *     npx ts-node -r tsconfig-paths/register scripts/projectmind-dev-server.ts
 *
 * Apply migrations/20261124_projectmind_init.sql to that database first.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AI_ENTITIES } from '../src/ai/entities/ai.entity';
import { JwtAuthGuard } from '../src/auth/guard/jwt-auth.guard';
import { PM_ENTITIES } from '../src/projectmind/entities/projectmind.entities';
import { ProjectMindModule } from '../src/projectmind/projectmind.module';

const url = new URL(process.env.PROJECTMIND_DEV_DB || 'postgres://pmtest@127.0.0.1:54329/pmtest');
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
	throw new Error(`Refusing to run the dev harness against a non-local database host "${url.hostname}".`);
}
const conn = {
	type: 'postgres' as const,
	host: url.hostname,
	port: Number(url.port || 5432),
	username: decodeURIComponent(url.username),
	password: decodeURIComponent(url.password) || undefined,
	database: url.pathname.slice(1),
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USERS: Record<string, any> = {
	a: { id: uuid(1), tenantId: uuid(100), role: 'admin', email: 'dev-a@example.test' },
	b: { id: uuid(2), tenantId: uuid(200), role: 'admin', email: 'dev-b@example.test' },
};

@Module({
	imports: [ConfigModule.forRoot({ isGlobal: true }), TypeOrmModule.forRoot({ ...conn, entities: PM_ENTITIES, autoLoadEntities: true, synchronize: false }), ProjectMindModule],
})
class DevModule {}

async function main() {
	// The AI tables belong to the existing app; create just those (local DB only) so AiService can run.
	const ai = new DataSource({ ...conn, entities: AI_ENTITIES, synchronize: true });
	await ai.initialize();
	await ai.destroy();

	const mod = await Test.createTestingModule({ imports: [DevModule] })
		.overrideGuard(JwtAuthGuard)
		.useValue({
			canActivate: (ctx: any) => {
				const req = ctx.switchToHttp().getRequest();
				if (String(req.method).toUpperCase() === 'OPTIONS') return true;
				req.user = USERS[String(req.headers['x-dev-user'] || 'a')] || USERS.a;
				return true;
			},
		})
		.compile();
	const app = mod.createNestApplication();
	app.setGlobalPrefix('api/v1');
	app.enableCors({ origin: true, credentials: true });
	const port = Number(process.env.PORT || 4010);
	await app.listen(port, '127.0.0.1');
	// eslint-disable-next-line no-console
	console.log(`ProjectMind dev harness listening on http://127.0.0.1:${port}/api/v1/projectmind (db ${conn.host}:${conn.port}/${conn.database})`);
}

main().catch((e) => {
	// eslint-disable-next-line no-console
	console.error(e);
	process.exit(1);
});
