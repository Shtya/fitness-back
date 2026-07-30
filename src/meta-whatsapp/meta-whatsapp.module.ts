import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FitnessLead } from '../fitness-leads/entities/fitness-leads.entity';
import {
	MetaWhatsAppActivityLog,
	MetaWhatsAppBulkItem,
	MetaWhatsAppBulkJob,
	MetaWhatsAppConfig,
	MetaWhatsAppConversation,
	MetaWhatsAppMessage,
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

@Module({
	imports: [
		TypeOrmModule.forFeature([
			MetaWhatsAppConfig,
			MetaWhatsAppConversation,
			MetaWhatsAppMessage,
			MetaWhatsAppBulkJob,
			MetaWhatsAppBulkItem,
			MetaWhatsAppActivityLog,
			FitnessLead,
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
	],
	exports: [
		MetaWhatsAppConfigService,
		MetaWhatsAppConversationsService,
		MetaWhatsAppMessagingService,
		MetaWhatsAppBulkService,
	],
})
export class MetaWhatsAppModule {}
