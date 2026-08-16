import {
	IsArray,
	IsBoolean,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 50);
};

export class UpdateEmailMemoSettingsDto {
	@IsOptional()
	@IsBoolean()
	processAllIncoming?: boolean;

	@IsOptional()
	@IsBoolean()
	onlyUnread?: boolean;

	@IsOptional()
	@IsBoolean()
	ignorePromotional?: boolean;

	@IsOptional()
	@IsBoolean()
	ignoreNewsletters?: boolean;

	@IsOptional()
	@IsString()
	@MaxLength(512)
	gmailQuery?: string | null;

	@IsOptional()
	@IsArray()
	@Transform(({ value }) => toStringArray(value))
	senderInclude?: string[];

	@IsOptional()
	@IsArray()
	@Transform(({ value }) => toStringArray(value))
	senderExclude?: string[];

	@IsOptional()
	@IsArray()
	@Transform(({ value }) => toStringArray(value))
	subjectInclude?: string[];

	@IsOptional()
	@IsArray()
	@Transform(({ value }) => toStringArray(value))
	gmailLabels?: string[];

	@IsOptional()
	@IsIn(['low', 'medium', 'high'])
	minPriority?: string;

	@IsOptional()
	@IsIn(['short', 'medium', 'detailed'])
	memoLength?: string;

	@IsOptional()
	@IsBoolean()
	includeSender?: boolean;

	@IsOptional()
	@IsBoolean()
	includeSubject?: boolean;

	@IsOptional()
	@IsBoolean()
	includeSummary?: boolean;

	@IsOptional()
	@IsBoolean()
	includeAction?: boolean;

	@IsOptional()
	@IsBoolean()
	includeDeadline?: boolean;

	@IsOptional()
	@IsBoolean()
	includeGmailLink?: boolean;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	customInstructions?: string | null;

	@IsOptional()
	@IsIn(['ai-free', 'llm7-free', 'pollinations-free', 'browser-chatgpt', 'gemini', 'openai', 'custom'])
	aiProvider?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	aiModel?: string | null;

	@IsOptional()
	@IsBoolean()
	whatsappEnabled?: boolean;

	@IsOptional()
	@IsBoolean()
	onlyImportant?: boolean;

	@IsOptional()
	@IsIn(['immediate', 'batch30', 'digest'])
	notificationMode?: string;

	@IsOptional()
	@IsString()
	@MaxLength(160)
	targetChatId?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(160)
	targetChatName?: string | null;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(24)
	@Transform(({ value }) => {
		const n = Number(value);
		if (!Number.isFinite(n)) return 1;
		return Math.min(24, Math.max(1, Math.round(n)));
	})
	pollIntervalHours?: number;
}

export class SaveGmailCredentialsDto {
	@IsOptional()
	@IsString()
	@MaxLength(200)
	clientId?: string;

	@IsOptional()
	@IsString()
	@MaxLength(200)
	clientSecret?: string;

	@IsOptional()
	@IsString()
	@MaxLength(36)
	connectionId?: string;
}

export class ImportGmailInboxDto {
	@IsOptional()
	@IsString()
	@MaxLength(36)
	connectionId?: string;

	@IsOptional()
	@IsString()
	@MaxLength(256)
	pageToken?: string;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(100)
	@Transform(({ value }) => {
		const n = Number(value);
		if (!Number.isFinite(n)) return 50;
		return Math.min(100, Math.max(1, Math.round(n)));
	})
	limit?: number;
}

export class EmailMemoSenderDto {
	@IsString()
	@MaxLength(320)
	email: string;
}

export class SendNowEmailMemoDto {
	@IsOptional()
	@IsArray()
	@Transform(({ value }) =>
		(Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 150),
	)
	ids?: string[];

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(150)
	@Transform(({ value }) => {
		const n = Number(value);
		if (!Number.isFinite(n)) return 100;
		return Math.min(150, Math.max(1, Math.round(n)));
	})
	limit?: number;
}

const toBoolean = (value: unknown) =>
	value === true || value === 'true' || value === 1 || value === '1';

export class ConnectEmailMemoWhatsAppDto {
	@IsOptional()
	@Transform(({ value }) =>
		value === undefined || value === null || value === '' ? undefined : toBoolean(value),
	)
	@IsBoolean()
	extra?: boolean;

	@IsOptional()
	@IsUUID()
	accountId?: string;
}

export class DisconnectEmailMemoWhatsAppDto {
	@IsOptional()
	@IsUUID()
	accountId?: string;
}

export class UseEmailMemoWhatsAppDto {
	@IsUUID()
	accountId: string;
}

export class EmailMemoLocaleQueryDto {
	@IsOptional()
	@IsString()
	@MaxLength(8)
	locale?: string;

	@IsOptional()
	@IsString()
	@MaxLength(36)
	connectionId?: string;
}
