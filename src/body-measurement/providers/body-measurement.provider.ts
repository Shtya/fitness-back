export type BodyMeasurementEstimates = {
	height: number;
	shoulderWidth: number | null;
	chest: number | null;
	waist: number | null;
	hips: number | null;
	upperArm: number | null;
	thigh: number | null;
	inseam: number | null;
	unit: 'cm';
	confidence: Record<string, number | null>;
	warnings: string[];
};

export type AnalyzeBodyInput = {
	frontImagePath: string;
	sideImagePath: string;
	heightCm: number;
	frontOriginalName?: string;
	sideOriginalName?: string;
};

export interface BodyMeasurementProvider {
	analyzeBody(input: AnalyzeBodyInput): Promise<BodyMeasurementEstimates>;
}

export const BODY_MEASUREMENT_PROVIDER = Symbol('BODY_MEASUREMENT_PROVIDER');
