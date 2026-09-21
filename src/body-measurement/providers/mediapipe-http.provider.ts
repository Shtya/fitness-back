import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import FormData = require('form-data');
import { createReadStream } from 'fs';
import {
	AnalyzeBodyInput,
	BodyMeasurementEstimates,
	BodyMeasurementProvider,
} from './body-measurement.provider';

const MEASUREMENT_KEYS = [
	'shoulderWidth',
	'chest',
	'waist',
	'hips',
	'upperArm',
	'thigh',
	'inseam',
] as const;

function toNullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

@Injectable()
export class MediaPipeHttpProvider implements BodyMeasurementProvider {
	private readonly logger = new Logger(MediaPipeHttpProvider.name);

	private get baseUrl() {
		return (process.env.BODY_MEASUREMENT_SERVICE_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');
	}

	private get timeoutMs() {
		return Math.max(Number(process.env.BODY_MEASUREMENT_TIMEOUT_MS) || 90000, 15000);
	}

	async analyzeBody(input: AnalyzeBodyInput): Promise<BodyMeasurementEstimates> {
		const form = new FormData();
		form.append('height', String(input.heightCm));
		form.append('front', createReadStream(input.frontImagePath), {
			filename: input.frontOriginalName || 'front.jpg',
			contentType: 'image/jpeg',
		});
		form.append('side', createReadStream(input.sideImagePath), {
			filename: input.sideOriginalName || 'side.jpg',
			contentType: 'image/jpeg',
		});

		try {
			const { data } = await axios.post(`${this.baseUrl}/analyze`, form, {
				headers: form.getHeaders(),
				timeout: this.timeoutMs,
				maxBodyLength: 20 * 1024 * 1024,
				maxContentLength: 20 * 1024 * 1024,
			});
			return this.normalize(data, input.heightCm);
		} catch (error: any) {
			const detail = error?.response?.data?.detail || error?.response?.data?.message || error?.message;
			this.logger.warn(`Body measurement analyzer failed: ${detail}`);
			if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
				throw new ServiceUnavailableException(
					'Body measurement AI service is not running. Start ai-body-scan on port 8010.',
				);
			}
			if (error?.response?.status >= 400 && error?.response?.status < 500) {
				throw new BadGatewayException(typeof detail === 'string' ? detail : 'Could not estimate measurements from these photos.');
			}
			throw new BadGatewayException(
				typeof detail === 'string' ? detail : 'Body measurement AI service failed. No values were invented.',
			);
		}
	}

	private normalize(raw: any, heightCm: number): BodyMeasurementEstimates {
		const confidence: Record<string, number | null> = {};
		const estimates: BodyMeasurementEstimates = {
			height: heightCm,
			shoulderWidth: null,
			chest: null,
			waist: null,
			hips: null,
			upperArm: null,
			thigh: null,
			inseam: null,
			unit: 'cm',
			confidence,
			warnings: Array.isArray(raw?.warnings) ? raw.warnings.filter((w: unknown) => typeof w === 'string') : [],
		};

		for (const key of MEASUREMENT_KEYS) {
			const value = toNullableNumber(raw?.[key]);
			const conf = toNullableNumber(raw?.confidence?.[key]);
			estimates[key] = value;
			confidence[key] = value == null ? null : conf;
		}

		return estimates;
	}
}
