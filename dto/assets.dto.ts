import { IsEnum, IsOptional, IsString, IsNumber } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateAssetDto {
  @IsOptional()
  @IsString()
  filename: string;

  @IsOptional()
  type?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsNumber()
  size?: number;
}

export class UpdateAssetDto extends PartialType(CreateAssetDto) {}
