import { IsOptional, IsDateString, IsUUID } from 'class-validator';

/**
 * Query params for GET /admin/stats
 * Used by admin dashboard to scope stats by date range and optionally by admin.
 */
export class AdminStatsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  adminId?: string;
}

/** Response shape for admin dashboard (matches frontend MOCK_DATA structure) */
export interface AdminStatsKpis {
  totalClients: number;
  activeClients: number;
  newClients: number;
  churnedThisRange: number;
  formsSubmissions: number;
  unreadNotifications: number;
  assetsUploaded: number;
  pendingExerciseVideos: number;
}

export interface DailySeriesPoint {
  date: string;
  value: number;
}

export interface AdminStatsSeries {
  usersCreatedDaily: DailySeriesPoint[];
  exerciseVolumeDaily: DailySeriesPoint[];
  mealLogsDaily: DailySeriesPoint[];
}

export interface LabelValue {
  labelKey?: string;
  label?: string;
  value: number;
}

export interface TopConversation {
  conversationId: string;
  nameKey?: string;
  name?: string;
  messages: number;
}

export interface AdminStatsBreakdowns {
  membershipCounts: LabelValue[];
  userStatusCounts: LabelValue[];
  messagesPerConversationTop5: TopConversation[];
}

export interface AdminStatsReviewsQueue {
  weeklyReportsPending: number;
  videosPending: number;
  foodSuggestionsPending: number;
}

export interface AdminStatsResponse {
  kpis: AdminStatsKpis;
  series: AdminStatsSeries;
  breakdowns: AdminStatsBreakdowns;
  reviewsQueue: AdminStatsReviewsQueue;
}
