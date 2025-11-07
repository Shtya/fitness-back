// src/modules/settings/dto/update-settings.dto.ts
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, MaxLength, ValidateNested, IsArray, IsIn, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';
import { DefaultLang, ReportWeekday } from 'entities/settings.entity';

class ThemePaletteDto {
  @IsString() primary: string;
  @IsString() onPrimary: string;
  @IsString() secondary: string;
  @IsString() surface: string;
  @IsString() onSurface: string;
  @IsString() background: string;
  @IsString() onBackground: string;
  @IsString() success: string;
  @IsString() warning: string;
  @IsString() danger: string;
  @IsString() muted: string;
}

export class DhikrItemInputDto {
  @IsOptional() @IsString() id?: string; // optional for updates (client may send existing ids)
  @IsString() @MaxLength(200) text!: string;
}

export class ReminderInputDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MaxLength(200) title!: string;
  // HH:mm (24h)
  @IsString() @Length(5, 5) time!: string;
}

export class UpdateSettingsDto {
  // -------- org / lang / slug --------
  @IsOptional() @IsString() @MaxLength(120) organizationKey?: string | null;

  @IsString() @MaxLength(160) orgName!: string;

  @IsEnum(DefaultLang) defaultLang!: DefaultLang;

  @IsString() @MaxLength(80) timezone!: string;

  @IsOptional() @IsString() @MaxLength(160) homeSlug?: string | null;

  // -------- landing meta --------
  @IsOptional() @IsString() @MaxLength(180) metaTitle?: string | null;

  @IsOptional() @IsString() metaDescription?: string | null;

  @IsOptional() @IsString() @MaxLength(600) metaKeywords?: string | null;

  @IsOptional() @IsString() @MaxLength(600) ogImageUrl?: string | null;

  @IsOptional() @IsString() @MaxLength(200) homeTitle?: string | null;

  // -------- loader --------
  @IsBoolean() loaderEnabled!: boolean;

  @IsString() @MaxLength(240) loaderMessage!: string;

  @IsInt() loaderDurationSec!: number;

  // -------- dhikr --------
  @IsBoolean() dhikrEnabled!: boolean;

  @IsOptional() @IsString() activeDhikrId?: string | number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DhikrItemInputDto)
  dhikrItems!: DhikrItemInputDto[];

  // -------- theme palette --------
  @ValidateNested()
  @Type(() => ThemePaletteDto)
  themePalette!: ThemePaletteDto;

  // -------- reports --------
  @IsBoolean() reportEnabled!: boolean;

  @IsEnum(ReportWeekday) reportDay!: ReportWeekday;

  // HH:mm
  @IsString() @Length(5, 5) reportTime!: string;

  @IsBoolean() rptWeightTrend!: boolean;
  @IsBoolean() rptMealAdherence!: boolean;
  @IsBoolean() rptWorkoutCompletion!: boolean;
  @IsBoolean() rptWaterIntake!: boolean;
  @IsBoolean() rptCheckinNotes!: boolean;
  @IsBoolean() rptNextFocus!: boolean;
  @IsBoolean() rptLatestPhotos!: boolean;

  @IsString() reportCustomMessage!: string;

  // -------- reminders --------
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderInputDto)
  reminders!: ReminderInputDto[];
}
