import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/global.entity';
import { NotificationModule } from '../notification/notification.module';
import { RedisModule } from '../redis/redis.module';
import { WhatsAppAccountsController } from './controllers/whatsapp-accounts.controller';
import { WhatsAppAssignmentsController } from './controllers/whatsapp-assignments.controller';
import { WhatsAppConnectionController } from './controllers/whatsapp-connection.controller';
import { WhatsAppConversationsController } from './controllers/whatsapp-conversations.controller';
import { WhatsAppReportsController } from './controllers/whatsapp-reports.controller';
import { WhatsAppStatusController } from './controllers/whatsapp-status.controller';
import { WhatsAppVoiceChangerController } from './controllers/whatsapp-voice-changer.controller';
import { WhatsAppStickersController } from './controllers/whatsapp-stickers.controller';
import { WhatsAppAiMediaController } from './ai-media/whatsapp-ai-media.controller';
import { WhatsAppAiMediaService } from './ai-media/whatsapp-ai-media.service';
import { WHATSAPP_AI_IMAGE_PROVIDERS } from './ai-media/whatsapp-ai-image.provider';
import { PollinationsWhatsAppImageProvider } from './ai-media/pollinations-whatsapp-image.provider';
import { GeminiWhatsAppImageProvider } from './ai-media/gemini-whatsapp-image.provider';
import { HuggingFaceWhatsAppImageProvider } from './ai-media/huggingface-whatsapp-image.provider';
import {
	WhatsAppAccount,
	WhatsAppAccountAccess,
	WhatsAppAuditLog,
	WhatsAppConnectionLog,
	WhatsAppContact,
	WhatsAppConversation,
	WhatsAppConversationAssignment,
	WhatsAppConversationNote,
	WhatsAppConversationPreference,
	WhatsAppGroup,
	WhatsAppGroupParticipant,
	WhatsAppMessage,
	WhatsAppMessageAttachment,
	WhatsAppMessageReaction,
	WhatsAppProviderSession,
	WhatsAppStatus,
	WhatsAppVoiceChangerCredential,
	WhatsAppVoiceChangerSettings,
	WhatsAppSavedSticker,
	WhatsAppChatMessageGroup,
	WhatsAppChatMessageGroupItem,
} from './entities/whatsapp.entity';
import { WhatsAppAccessService } from './services/whatsapp-access.service';
import { WhatsAppAccountsService } from './services/whatsapp-accounts.service';
import { WhatsAppAuditService } from './services/whatsapp-audit.service';
import { WhatsAppSessionService } from './services/whatsapp-session.service';
import { WhatsAppProviderManagerService } from './services/whatsapp-provider-manager.service';
import { WhatsAppGateway } from './gateways/whatsapp.gateway';
import { WhatsAppAssignmentService } from './services/whatsapp-assignment.service';
import { WhatsAppSyncService } from './services/whatsapp-sync.service';
import { WhatsAppStatusService } from './services/whatsapp-status.service';
import { WhatsAppReportsService } from './services/whatsapp-reports.service';
import { WhatsAppSchemaService } from './services/whatsapp-schema.service';
import { WhatsAppVoiceChangerService } from './services/whatsapp-voice-changer.service';
import { WhatsAppStickersService } from './services/whatsapp-stickers.service';
import { WhatsAppMessageGroupsService } from './services/whatsapp-message-groups.service';
import { AiContentStudioModule } from '../ai-content-studio/ai-content-studio.module';
import { TranscriptionModule } from '../transcription/transcription.module';
import { AiModule } from '../ai/ai.module';

export const WHATSAPP_ENTITIES = [
	WhatsAppAccount,
	WhatsAppAccountAccess,
	WhatsAppProviderSession,
	WhatsAppContact,
	WhatsAppGroup,
	WhatsAppGroupParticipant,
	WhatsAppConversation,
	WhatsAppConversationAssignment,
	WhatsAppConversationNote,
	WhatsAppConversationPreference,
	WhatsAppMessage,
	WhatsAppMessageAttachment,
	WhatsAppMessageReaction,
	WhatsAppStatus,
	WhatsAppConnectionLog,
	WhatsAppAuditLog,
	WhatsAppVoiceChangerSettings,
	WhatsAppVoiceChangerCredential,
	WhatsAppSavedSticker,
	WhatsAppChatMessageGroup,
	WhatsAppChatMessageGroupItem,
];

@Module({
	imports: [
		TypeOrmModule.forFeature([...WHATSAPP_ENTITIES, User]),
		JwtModule.registerAsync({
			useFactory: () => ({
				secret: process.env.JWT_SECRET,
			}),
		}),
		NotificationModule,
		RedisModule,
		AiModule,
		AiContentStudioModule,
		TranscriptionModule,
	],
	controllers: [
		WhatsAppAccountsController,
		WhatsAppAssignmentsController,
		WhatsAppConnectionController,
		WhatsAppConversationsController,
		WhatsAppReportsController,
		WhatsAppStatusController,
		WhatsAppVoiceChangerController,
		WhatsAppStickersController,
		WhatsAppAiMediaController,
	],
	providers: [
		WhatsAppAccessService,
		WhatsAppAccountsService,
		WhatsAppAuditService,
		WhatsAppSessionService,
		WhatsAppGateway,
		WhatsAppProviderManagerService,
		WhatsAppSyncService,
		WhatsAppAssignmentService,
		WhatsAppStatusService,
		WhatsAppReportsService,
		WhatsAppSchemaService,
		WhatsAppVoiceChangerService,
		WhatsAppStickersService,
		WhatsAppMessageGroupsService,
		PollinationsWhatsAppImageProvider,
		GeminiWhatsAppImageProvider,
		HuggingFaceWhatsAppImageProvider,
		WhatsAppAiMediaService,
		{
			provide: WHATSAPP_AI_IMAGE_PROVIDERS,
			inject: [
				PollinationsWhatsAppImageProvider,
				GeminiWhatsAppImageProvider,
				HuggingFaceWhatsAppImageProvider,
			],
			useFactory: (
				pollinations: PollinationsWhatsAppImageProvider,
				gemini: GeminiWhatsAppImageProvider,
				huggingface: HuggingFaceWhatsAppImageProvider,
			) => [pollinations, gemini, huggingface],
		},
	],
	exports: [
		TypeOrmModule,
		WhatsAppAccessService,
		WhatsAppAccountsService,
		WhatsAppAuditService,
		WhatsAppGateway,
		WhatsAppProviderManagerService,
	],
})
export class WhatsAppModule {}
