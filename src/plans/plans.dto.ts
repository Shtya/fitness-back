export class AcceptPlanDto {
	planId: string;
	userId: string;
}
// Accepts either your full weeklyProgram or a compact body.
export class ImportPlanDto {
	userId?: string;
	coachId?: string | null; // optional coach
	name?: string; // plan name
	program?: {
		days: Array<{
			id: string;
			dayOfWeek?: string;
			name: string;
			exercises: Array<{
				id?: string;
				name: string;
				targetSets?: number;
				targetReps: string;
				rest?: number;
				restSeconds?: number;
				tempo?: string;
				img?: string | null;
				video?: string | null;
				video2?: string | null;
				desc?: string | null;
			}>;
		}>;
	};

	// allow passing the full weeklyProgram object directly
	id?: string;
	created_at?: string;
	updated_at?: string;
	deleted_at?: string | null;
	userIdAlt?: string; // ignore
	programAlt?: any; // ignore
}
export class UpdatePlanDto {
	name?: string;
	isActive?: boolean;
	startDate?: string | null;
	endDate?: string | null;

	// ✅ NEW
	notes?: string[] | null;
	warmup?: string | null;
	cardio?: string | null;
}
export class CreatePlanDto {
	name: string;
	athleteId: string;
	coachId?: string | null;
}
