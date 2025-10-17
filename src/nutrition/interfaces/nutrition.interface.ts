export interface NutritionStats {
  totals: {
    total: number;
    activePlans: number;
    totalDays: number;
    totalAssignments: number;
  };
}

export interface MealPlanListResponse {
  records: any[];
  total: number;
  page: number;
  limit: number;
}

export interface ProgressData {
  weightSeries: Array<{ date: Date; kg: number }>;
  adherence: Array<{ date: Date; score: number }>;
  macros: Array<{ date: Date; target: any; actual: any }>;
  mealCompliance: Array<{ meal: string; takenPct: number }>;
  extras: Array<{ date: Date; count: number }>;
  supplements: Array<{ name: string; takenPct: number }>;
  target: any;
}
