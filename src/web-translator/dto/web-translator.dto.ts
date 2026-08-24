import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

const LANGS = ["auto", "ar", "en"] as const;
const LOCALES = ["ar", "en"] as const;

function trimString({ value }: { value: unknown }) {
  return typeof value === "string" ? value.trim() : value;
}

export class LookupDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;

  @IsOptional()
  @IsIn(LANGS)
  sourceLang?: "auto" | "ar" | "en";

  @IsOptional()
  @IsIn(["ar", "en"])
  targetLang?: "ar" | "en";

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceUrl?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(240)
  sourceTitle?: string;
}

export class SaveWordDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  translation?: string;

  @IsOptional()
  @IsIn(["ar", "en"])
  sourceLang?: "ar" | "en";

  @IsOptional()
  @IsIn(["ar", "en"])
  targetLang?: "ar" | "en";

  @IsOptional()
  @IsString()
  @MaxLength(160)
  pronunciation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  partOfSpeech?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  example?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  sourceTitle?: string;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsIn(LOCALES)
  locale?: "ar" | "en";

  @IsOptional()
  @IsIn(LANGS)
  sourceLang?: "auto" | "ar" | "en";

  @IsOptional()
  @IsIn(["ar", "en"])
  targetLang?: "ar" | "en";

  @IsOptional()
  @IsBoolean()
  doubleClickEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  selectionEnabled?: boolean;
}

export class ExchangePairingDto {
  @Transform(trimString)
  @IsString()
  @MinLength(6)
  @MaxLength(12)
  code: string;
}
