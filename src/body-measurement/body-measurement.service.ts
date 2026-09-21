import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BodyMeasurement } from 'entities/profile.entity';
import { User, UserRole } from 'entities/global.entity';
import { unlink } from 'fs/promises';
import { Repository } from 'typeorm';
import { SaveBodyMeasurementDto } from './dto/body-measurement.dto';
import { AnalyzeBodyInput, BODY_MEASUREMENT_PROVIDER, BodyMeasurementProvider } from './providers/body-measurement.provider';

type Actor = { id: string; role: UserRole; adminId?: string | null };

function toNum(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? Number(n.toFixed(1)) : null;
}

function todayISO() {
	return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class BodyMeasurementService {
	constructor(
		@InjectRepository(BodyMeasurement)
		private readonly measurements: Repository<BodyMeasurement>,
		@InjectRepository(User)
		private readonly users: Repository<User>,
		@Inject(BODY_MEASUREMENT_PROVIDER)
		private readonly provider: BodyMeasurementProvider,
	) {}

	async assertCanAccessClient(actor: Actor, clientId: string) {
		const client = await this.users.findOne({ where: { id: clientId } });
		if (!client) throw new NotFoundException('Client not found');

		if (actor.id === clientId) return client;
		if (actor.role === UserRole.SUPER_ADMIN) return client;
		if (actor.role === UserRole.COACH && client.coachId === actor.id) return client;
		if (actor.role === UserRole.ADMIN) {
			if (client.adminId === actor.id) return client;
			if (client.coachId) {
				const coach = await this.users.findOne({ where: { id: client.coachId } });
				if (coach?.adminId === actor.id) return client;
			}
		}
		throw new ForbiddenException('You can only manage measurements for your own clients');
	}

	serialize(row: BodyMeasurement | null) {
		if (!row) return null;
		return {
			id: row.id,
			clientId: row.userId,
			userId: row.userId,
			date: row.date,
			height: toNum(row.height),
			shoulderWidth: toNum(row.shoulderWidth),
			chest: toNum(row.chest),
			waist: toNum(row.waist),
			hips: toNum(row.hips),
			upperArm: toNum(row.arms),
			arms: toNum(row.arms),
			thigh: toNum(row.thighs),
			thighs: toNum(row.thighs),
			inseam: toNum(row.inseam),
			weight: toNum(row.weight),
			unit: row.unit || 'cm',
			source: row.source || 'manual',
			confidence: row.confidence || null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	async list(actor: Actor, clientId: string) {
		await this.assertCanAccessClient(actor, clientId);
		const rows = await this.measurements.find({
			where: { userId: clientId },
			order: { date: 'DESC', created_at: 'DESC' },
		});
		return {
			items: rows.map((row) => this.serialize(row)),
			latest: rows[0] ? this.serialize(rows[0]) : null,
		};
	}

	async latest(actor: Actor, clientId: string) {
		await this.assertCanAccessClient(actor, clientId);
		const row = await this.measurements.findOne({
			where: { userId: clientId },
			order: { date: 'DESC', created_at: 'DESC' },
		});
		return this.serialize(row);
	}

	async analyze(
		actor: Actor,
		clientId: string,
		files: { front?: Express.Multer.File[]; side?: Express.Multer.File[] },
		heightRaw: unknown,
	) {
		await this.assertCanAccessClient(actor, clientId);
		const heightCm = Number(heightRaw);
		if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 230) {
			throw new BadRequestException('Height must be between 100 and 230 cm');
		}

		const front = files?.front?.[0];
		const side = files?.side?.[0];
		if (!front?.path || !side?.path) {
			throw new BadRequestException('Front and side photos are required');
		}

		const input: AnalyzeBodyInput = {
			frontImagePath: front.path,
			sideImagePath: side.path,
			heightCm,
			frontOriginalName: front.originalname,
			sideOriginalName: side.originalname,
		};

		try {
			const estimates = await this.provider.analyzeBody(input);
			const existing = await this.latest(actor, clientId);
			return {
				estimates: { ...estimates, height: heightCm, unit: 'cm' as const },
				existing,
				requiresConfirmation: Boolean(existing),
			};
		} finally {
			await Promise.allSettled([unlink(front.path).catch(() => undefined), unlink(side.path).catch(() => undefined)]);
		}
	}

	async save(actor: Actor, clientId: string, dto: SaveBodyMeasurementDto) {
		await this.assertCanAccessClient(actor, clientId);
		const date = dto.date || todayISO();
		const existing = await this.measurements.findOne({ where: { userId: clientId, date } });
		const latest = await this.measurements.findOne({
			where: { userId: clientId },
			order: { date: 'DESC', created_at: 'DESC' },
		});

		if ((existing || latest) && !dto.replaceExisting) {
			throw new ConflictException({
				message: 'This client already has body measurements. Confirm before replacing them.',
				code: 'MEASUREMENTS_EXIST',
				existing: this.serialize(existing || latest),
				requiresConfirmation: true,
			});
		}

		const payload = {
			userId: clientId,
			date,
			height: toNum(dto.height),
			shoulderWidth: toNum(dto.shoulderWidth),
			chest: toNum(dto.chest),
			waist: toNum(dto.waist),
			hips: toNum(dto.hips),
			arms: toNum(dto.upperArm ?? dto.arms),
			thighs: toNum(dto.thigh ?? dto.thighs),
			inseam: toNum(dto.inseam),
			weight: toNum(dto.weight),
			unit: dto.unit || 'cm',
			source: dto.source || 'ai',
			confidence: dto.confidence || null,
		};

		if (existing) {
			Object.assign(existing, payload);
			return this.serialize(await this.measurements.save(existing));
		}

		const created = this.measurements.create(payload);
		return this.serialize(await this.measurements.save(created));
	}
}
