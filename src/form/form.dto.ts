import { IsString, IsArray, IsNumber, IsOptional, IsBoolean, IsEnum, IsObject } from 'class-validator';
import { FieldType } from 'entities/global.entity';
 
export class CreateFormFieldDto {
  @IsString()
  label: string;

  @IsString()
  key: string;

  @IsOptional()
  @IsString()
  placeholder?: string;

  @IsEnum(FieldType)
  type: FieldType;

  @IsBoolean()
  @IsOptional()
  required?: boolean;

  @IsArray()
  @IsOptional()
  options?: string[];

  @IsNumber()
  order: number;
}

export class CreateFormDto {
  @IsString()
  title: string;

  @IsArray()
  fields: CreateFormFieldDto[];
}

export class UpdateFormDto {
  @IsNumber()
  id: number;

  @IsString()
  title: string;

  @IsArray()
  fields: CreateFormFieldDto[];
}

export class SubmitFormDto {
  @IsString()
  email: string;

  @IsString()
  phone: string;

  @IsObject()
  answers: Record<string, any>;
}

export class ReorderFieldsDto {
  @IsArray()
  fields: Array<{
    id: number;
    order: number;
  }>;
}