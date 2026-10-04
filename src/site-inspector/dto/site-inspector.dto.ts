import { Transform } from "class-transformer";
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

function trimString({ value }: { value: unknown }) {
  return typeof value === "string" ? value.trim() : value;
}

export class AnalyzeSiteDto {
  @Transform(trimString)
  @IsString()
  @MinLength(3)
  @MaxLength(2048)
  url: string;
}

export const INSIGHT_MODES = ["overview", "component"] as const;
export type InsightMode = (typeof INSIGHT_MODES)[number];

export class SiteInsightsDto {
  @IsIn(INSIGHT_MODES)
  mode: InsightMode;

  @IsObject()
  summary: Record<string, unknown>;

  @IsOptional()
  @IsIn(["ar", "en"])
  locale?: "ar" | "en";
}
