import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FitnessLead } from '../fitness-leads/entities/fitness-leads.entity';
import { User } from 'entities/global.entity';
import {
	MetaWhatsAppActivityLog,
	MetaWhatsAppBulkItem,
	MetaWhatsAppBulkJob,
	MetaWhatsAppConfig,
	MetaWhatsAppConversation,
	MetaWhatsAppMessage,
	MetaWhatsAppQuickReply,
} from './entities/meta-whatsapp.entity';
import { MetaWhatsAppController } from './controllers/meta-whatsapp.controller';
import { MetaWhatsAppWebhookController } from './controllers/meta-whatsapp-webhook.controller';
import { MetaWhatsAppCryptoService } from './services/meta-whatsapp-crypto.service';
import { MetaWhatsAppCloudApiService } from './services/meta-whatsapp-cloud-api.service';
import { MetaWhatsAppConfigService } from './services/meta-whatsapp-config.service';
import { MetaWhatsAppActivityService } from './services/meta-whatsapp-activity.service';
import { MetaWhatsAppConversationsService } from './services/meta-whatsapp-conversations.service';
import { MetaWhatsAppMessagingService } from './services/meta-whatsapp-messaging.service';
import { MetaWhatsAppWebhookService } from './services/meta-whatsapp-webhook.service';
import { MetaWhatsAppBulkService } from './services/meta-whatsapp-bulk.service';
import { MetaWhatsAppMediaService } from './services/meta-whatsapp-media.service';
import { MetaWhatsAppUsageBillingService } from './services/meta-whatsapp-usage-billing.service';
import { MetaWhatsAppQuickRepliesService } from './services/meta-whatsapp-quick-replies.service';
import { MetaWhatsAppTranslateService } from './services/meta-whatsapp-translate.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			MetaWhatsAppConfig,
			MetaWhatsAppConversation,
			MetaWhatsAppMessage,
			MetaWhatsAppBulkJob,
			MetaWhatsAppBulkItem,
			MetaWhatsAppActivityLog,
			MetaWhatsAppQuickReply,
			FitnessLead,
			User,
		]),
	],
	controllers: [MetaWhatsAppController, MetaWhatsAppWebhookController],
	providers: [
		MetaWhatsAppCryptoService,
		MetaWhatsAppCloudApiService,
		MetaWhatsAppConfigService,
		MetaWhatsAppActivityService,
		MetaWhatsAppConversationsService,
		MetaWhatsAppMessagingService,
		MetaWhatsAppWebhookService,
		MetaWhatsAppBulkService,
		MetaWhatsAppMediaService,
		MetaWhatsAppUsageBillingService,
		MetaWhatsAppQuickRepliesService,
		MetaWhatsAppTranslateService,
	],
	exports: [
		MetaWhatsAppConfigService,
		MetaWhatsAppConversationsService,
		MetaWhatsAppMessagingService,
		MetaWhatsAppBulkService,
		MetaWhatsAppQuickRepliesService,
		MetaWhatsAppTranslateService,
	],
})
export class MetaWhatsAppModule {}
