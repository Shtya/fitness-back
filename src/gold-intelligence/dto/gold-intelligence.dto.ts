import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class SaveGoldSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1e9)
  capitalUsd?: number;

  @IsOptional()
  @IsString()
  holdingPeriod?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  riskTolerance?: string;

  @IsOptional()
  @IsNumber()
  local21kEgp?: number | null;

  @IsOptional()
  @IsNumber()
  local24kEgp?: number | null;

  @IsOptional()
  @IsNumber()
  local18kEgp?: number | null;
}

export class CreateGoldAlertDto {
  @IsString()
  @IsIn(['price_above', 'price_below', 'prob_up', 'prob_down', 'shock', 'egypt_21k'])
  alertType: string;

  @IsOptional()
  @IsNumber()
  threshold?: number;
}

export class GoldResearchDto {
  @IsString()
  question: string;

  @IsOptional()
  @IsBoolean()
  useLlm?: boolean;
}
