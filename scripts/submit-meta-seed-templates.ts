/**
 * One-shot: submit SO7BA_META_TEMPLATE_SEEDS to Meta via Nest context.
 * Usage: npx ts-node -r tsconfig-paths/register scripts/submit-meta-seed-templates.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MetaWhatsAppConfigService } from '../src/meta-whatsapp/services/meta-whatsapp-config.service';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../entities/global.entity';

async function main() {
	const app = await NestFactory.createApplicationContext(AppModule, {
		logger: ['error', 'warn'],
	});
	try {
		const ds = app.get(DataSource);
		const userRepo = ds.getRepository(User);
		const actor =
			(await userRepo.findOne({ where: { role: UserRole.SUPER_ADMIN } })) ||
			(await userRepo.findOne({ where: { role: UserRole.ADMIN } })) ||
			(await userRepo.findOne({ where: {} }));

		if (!actor?.id) {
			throw new Error('No admin user found to attribute seed activity');
		}

		const config = app.get(MetaWhatsAppConfigService);
		const status = await config.getPublicStatus(actor.id);
		console.log(
			JSON.stringify(
				{
					actor: { id: actor.id, role: actor.role, email: actor.email },
					meta: {
						enabled: status?.enabled,
						connectionStatus: status?.connectionStatus,
						phoneNumberId: status?.phoneNumberId,
						wabaId: status?.wabaId,
						hasAccessToken: status?.hasAccessToken,
						lastError: status?.lastError,
					},
				},
				null,
				2,
			),
		);

		const result = await config.submitSeedTemplates(actor.id);
		console.log(JSON.stringify(result, null, 2));
		if (result.failed > 0) process.exitCode = 1;
	} finally {
		await app.close();
	}
}

main().catch(err => {
	console.error(err?.message || err);
	process.exit(1);
});
