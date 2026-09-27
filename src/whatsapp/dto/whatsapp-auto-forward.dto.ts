import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

export class CreateWhatsAppAutoForwardRuleDto {
	@IsUUID()
	sourceConversationId: string;

	@IsUUID()
	targetConversationId: string;

	@IsOptional()
	@IsIn(['forward', 'copy'])
	mode?: 'forward' | 'copy';

	/** Also create the reverse rule (target → source). */
	@IsOptional()
	@IsBoolean()
	bidirectional?: boolean;
}

export class UpdateWhatsAppAutoForwardRuleDto {
	@IsOptional()
	@IsBoolean()
	isActive?: boolean;

	@IsOptional()
	@IsIn(['forward', 'copy'])
	mode?: 'forward' | 'copy';
}
