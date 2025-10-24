import { IsOptional, IsString, IsNumber, IsDateString, IsUUID, IsObject } from 'class-validator';

export class CreateProgressPhotoDto {
  @IsDateString()
  takenAt: string;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsObject()
  sides: {
    front?: string;
    back?: string;
    left?: string;
    right?: string;
  };
}

export class CreateBodyMeasurementDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  waist?: number;

  @IsOptional()
  @IsNumber()
  chest?: number;

  @IsOptional()
  @IsNumber()
  hips?: number;

  @IsOptional()
  @IsNumber()
  arms?: number;

  @IsOptional()
  @IsNumber()
  thighs?: number;
}

export class UpdateBodyMeasurementDto extends CreateBodyMeasurementDto {}

export class ComparePhotosDto {
  @IsUUID()
  beforeId: string;

  @IsUUID()
  afterId: string;

  @IsString()
  side: string; // 'front' | 'back' | 'left' | 'right' | 'all'
}

export class TimelineQueryDto {
  @IsOptional()
  @IsNumber()
  months?: number = 12;
}