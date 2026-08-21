import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/global.entity';
import { AiFreeModule } from '../ai-free/ai-free.module';
import { AiModule } from '../ai/ai.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { EmailMemoController } from './email-memo.controller';
import { EmailMemoWebhookController } from './email-memo-webhook.controller';
import { EmailMemoGateway } from './email-memo.gateway';
import { EmailMemoScheduler } from './email-memo.scheduler';
import { EMAIL_MEMO_ENTITIES } from './entities/email-memo.entity';
import { EmailMemoAiService } from './services/email-memo-ai.service';
import { EmailMemoCryptoService } from './services/email-memo-crypto.service';
import { EmailMemoGmailService } from './services/email-memo-gmail.service';
import { EmailMemoProcessorService } from './services/email-memo-processor.service';
import { EmailMemoService } from './services/email-memo.service';
import { EmailMemoSettingsService } from './services/email-memo-settings.service';
import { EmailMemoWhatsAppService } from './services/email-memo-whatsapp.service';
import { EmailMemoInSiteInboxService } from './services/email-memo-insite-inbox.service';
import {
	WhatsAppAccount,
	WhatsAppAccountAccess,
} from '../whatsapp/entities/whatsapp.entity';

@Module({
	imports: [
		ConfigModule,
		AiFreeModule,
		AiModule,
		WhatsAppModule,
		TypeOrmModule.forFeature([
			...EMAIL_MEMO_ENTITIES,
			User,
			WhatsAppAccount,
			WhatsAppAccountAccess,
		]),
		JwtModule.registerAsync({
			useFactory: () => ({
				secret: process.env.JWT_SECRET,
			}),
		}),
	],
	controllers: [EmailMemoController, EmailMemoWebhookController],
	providers: [
		EmailMemoCryptoService,
		EmailMemoAiService,
		EmailMemoSettingsService,
		EmailMemoGmailService,
		EmailMemoGateway,
		EmailMemoWhatsAppService,
		EmailMemoInSiteInboxService,
		EmailMemoProcessorService,
		EmailMemoService,
		EmailMemoScheduler,
	],
	exports: [EmailMemoService],
})
export class EmailMemoModule {}
