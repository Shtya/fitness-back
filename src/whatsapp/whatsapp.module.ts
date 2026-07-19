import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/global.entity';
import { NotificationModule } from '../notification/notification.module';
import { WhatsAppAccountsController } from './controllers/whatsapp-accounts.controller';
import { WhatsAppAssignmentsController } from './controllers/whatsapp-assignments.controller';
import { WhatsAppConnectionController } from './controllers/whatsapp-connection.controller';
import { WhatsAppConversationsController } from './controllers/whatsapp-conversations.controller';
import { WhatsAppReportsController } from './controllers/whatsapp-reports.controller';
import { WhatsAppStatusController } from './controllers/whatsapp-status.controller';
import {
	WhatsAppAccount,
	WhatsAppAccountAccess,
	WhatsAppAuditLog,
	WhatsAppConnectionLog,
	WhatsAppContact,
	WhatsAppConversation,
	WhatsAppConversationAssignment,
	WhatsAppConversationNote,
	WhatsAppGroup,
	WhatsAppGroupParticipant,
	WhatsAppMessage,
	WhatsAppMessageAttachment,
	WhatsAppProviderSession,
	WhatsAppStatus,
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
	WhatsAppMessage,
	WhatsAppMessageAttachment,
	WhatsAppStatus,
	WhatsAppConnectionLog,
	WhatsAppAuditLog,
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
	],
	controllers: [
		WhatsAppAccountsController,
		WhatsAppAssignmentsController,
		WhatsAppConnectionController,
		WhatsAppConversationsController,
		WhatsAppReportsController,
		WhatsAppStatusController,
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
