import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import * as path from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { QueryFailedErrorFilter } from 'common/QueryFailedErrorFilter';
import { shouldSynchronizeSchema } from 'common/database-schema-sync';
import { resolveDatabasePoolSize } from 'common/database-pool';
import { backgroundJobsEnabled } from 'common/runtime-isolation';
import { AssetModule } from './asset/asset.module';
import { PlansModule } from './plans/plans.module';
import { PrsModule } from './prs/prs.module';
import { ChatModule } from './chat/chat.module';
import { CalorieCalculationModule } from './calorie-calculations/calorie-calculation.module';
import { FormModule } from './form/form.module';
import { NotificationModule } from './notification/notification.module';
import { NutritionModule } from './nutrition/nutrition.module';
import { ExercisesModule } from './exercises/exercises.module';
import { ProfileModule } from './profile/profile.module';
import { WeeklyReportModule } from './weekly-report/weekly-report.module';
import { StatsModule } from './stats/stats.module';
import { SettingsModule } from './settings/settings.module';
import { AboutUserModule } from './about-user/about-user.module';
import { ReminderModule } from './reminder/reminder.module';
import { FeedbackModule } from './feedback/feedback.module';
import { BillingModule } from './billing/billing.module';
import { ScheduleModule } from '@nestjs/schedule';
import { BuilderModule } from './builder/builder.module';
import { CalendarModule } from './calendar/calendar.module';
import { LoggerMiddleware } from '../common/logger.middleware';
import { TodoModule } from './todo/todo.module';
import { RecipesModule } from './recipes/recipes.module';
import { MoneyModule } from './money/money.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { WhatsAppDemoModule } from './whatsapp-demo/whatsapp-demo.module';
import { AiReplySuggestionsModule } from './ai-reply-suggestions/ai-reply-suggestions.module';
import { AiFreeModule } from './ai-free/ai-free.module';
import { TenantModule } from './tenant/tenant.module';
import { PhoneIntelligenceModule } from './phone-intelligence/phone-intelligence.module';
import { FitnessLeadsModule } from './fitness-leads/fitness-leads.module';
import { MetaWhatsAppModule } from './meta-whatsapp/meta-whatsapp.module';
import { QuranRevisionModule } from './quran-revision/quran-revision.module';
import { LearningModule } from './learning/learning.module';
import { AiReadingModule } from './ai-reading/ai-reading.module';
import { AiContentStudioModule } from './ai-content-studio/ai-content-studio.module';
import { EmailMemoModule } from './email-memo/email-memo.module';
import { GoldIntelligenceModule } from './gold-intelligence/gold-intelligence.module';
import { AiModule } from './ai/ai.module';
import { WebTranslatorModule } from './web-translator/web-translator.module';
import { BodyMeasurementModule } from './body-measurement/body-measurement.module';
import { FacebookEngagementModule } from './facebook-engagement/facebook-engagement.module';
import { SiteInspectorModule } from './site-inspector/site-inspector.module';

@Module({
	imports: [
		ConfigModule.forRoot(),
		...(backgroundJobsEnabled() ? [ScheduleModule.forRoot()] : []),
		TypeOrmModule.forRoot({
			type: 'postgres',
			host: process.env.DATABASE_HOST,
			port: parseInt(process.env.DATABASE_PORT, 10),
			username: process.env.DATABASE_USER,
			password: process.env.DATABASE_PASSWORD,
			database: process.env.DATABASE_NAME,
			entities: [__dirname + '/../**/*.entity{.ts,.js}'],
			autoLoadEntities: true,
			synchronize: shouldSynchronizeSchema(),
			poolSize: resolveDatabasePoolSize(),
			extra: {
				max: resolveDatabasePoolSize(),
				idleTimeoutMillis: 10000,
				connectionTimeoutMillis: 20000,
			},
		}),

		AuthModule,
		TenantModule,
		AssetModule,
		PlansModule,
		PrsModule,
		PlansModule,
		ChatModule,
		FormModule,
		CalorieCalculationModule,
		ExercisesModule,
		NotificationModule,
		NutritionModule,
		ProfileModule,
		WeeklyReportModule,
		StatsModule,
		SettingsModule,
		AboutUserModule,
		ReminderModule,
		FeedbackModule,
		BillingModule,
		BuilderModule,
		CalendarModule,
		TodoModule,
		RecipesModule,
		MoneyModule,
		WhatsAppModule,
		WhatsAppDemoModule,
		TranscriptionModule,
		AiReplySuggestionsModule,
		AiFreeModule,
		PhoneIntelligenceModule,
		FitnessLeadsModule,
		MetaWhatsAppModule,
		QuranRevisionModule,
		LearningModule,
		AiReadingModule,
		AiContentStudioModule,
		EmailMemoModule,
		GoldIntelligenceModule,
		AiModule,
		WebTranslatorModule,
		BodyMeasurementModule,
		FacebookEngagementModule,
		SiteInspectorModule,
	],
	controllers: [AppController],
	providers: [AppService, QueryFailedErrorFilter],
	exports: [],
})
export class AppModule {
}
