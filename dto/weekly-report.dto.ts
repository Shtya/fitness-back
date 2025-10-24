// dto/weekly-report.dto.ts
export class CreateWeeklyReportDto {
  weekOf: string;
  diet: {
    hungry: 'yes' | 'no';
    mentalComfort: 'yes' | 'no';
    wantSpecific: string;
    foodTooMuch: 'yes' | 'no';
    dietDeviation: {
      hasDeviation: 'yes' | 'no';
      times: string | null;
      details: string | null;
    };
  };
  training: {
    intensityOk: 'yes' | 'no';
    daysDeviation: {
      hasDeviation: 'yes' | 'no';
      count: string | null;
      reason: string | null;
    };
    shapeChange: 'yes' | 'no';
    fitnessChange: 'yes' | 'no';
    sleep: {
      enough: 'yes' | 'no';
      hours: string | null;
    };
    programNotes: string;
    cardioAdherence: number;
  };
  measurements: {
    date: string;
    weight: number | null;
    waist: number | null;
    chest: number | null;
    hips: number | null;
    arms: number | null;
    thighs: number | null;
  } | null;
  photos: {
    front: { url: string } | null;
    back: { url: string } | null;
    left: { url: string } | null;
    right: { url: string } | null;
    extras: any[];
  };
  notifyCoach: boolean;
}

export class UpdateWeeklyReportDto {
  coachFeedback?: string;
  isRead?: boolean;
}

export class WeeklyReportResponseDto {
  id: string;
  weekOf: string;
  diet: any;
  training: any;
  measurements: any;
  photos: any;
  isRead: boolean;
  coachFeedback: string | null;
  reviewedAt: Date | null;
  reviewedBy: { id: string; name: string } | null;
  user: { id: string; name: string; email: string };
  created_at: Date;
}