// --- File: plans/plans.dto.ts ---

export class AcceptPlanDto {
  planId: string;
  userId: string;
}

/** Allowed exercise keys (minimal): id, name, targetSets, targetReps, rest, tempo, img, video
 *  We also allow referencing the library by exerciseId. If not found,
 *  altExerciseId(s) will be tried in order; finally, if name exists, inline will be created.
 */
export class TemplateExerciseDto {
  // Reference a library exercise (preferred)
  exerciseId?: string;

  // Fallback(s) if exerciseId is not found
  altExerciseId?: string | string[];

  // Inline definition (minimal)
  id?: string; // optional local id like 'ex1' (not used for persistence)
  name?: string;
  targetSets?: number;            // maps to PlanExercise.targetSets
  targetReps?: string;            // string "8" | "8-10" | "10-12"
  rest?: number;                  // seconds (maps to restSeconds)
  tempo?: string | null;          // "1/1/1" etc.
  img?: string | null;
  video?: string | null;

  // ordering (optional; falls back to array index)
  order?: number;
  orderIndex?: number;
}

export class TemplateDayDto {
  id?: string;                  // e.g. 'saturday'
  dayOfWeek?: string;           // e.g. 'saturday'
  name: string;
  orderIndex?: number;
  exercises: TemplateExerciseDto[];
}

export class ImportPlanDto {
  // Who to activate for (optional): if provided, plan will be created as active for this user
  userId?: string;
  coachId?: string | null;

  // Plan label
  name?: string;

  // Weekly program object
  program?: {
    days: TemplateDayDto[];
  };

  // Allow passing an already-shaped weeklyProgram
  id?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;

  // ignored if present
  userIdAlt?: string;
  programAlt?: any;
}

export class UpdatePlanDto {
  name?: string;
  isActive?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;

  // optional full replacement
  program?: {
    days: TemplateDayDto[];
  };
}

export class CreatePlanDto {
  name: string;
  athleteId: string;
  coachId?: string | null;
}
