import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import * as path from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { QueryFailedErrorFilter } from 'common/QueryFailedErrorFilter';
import { AssetModule } from './asset/asset.module';
import { PlansModule } from './plans/plans.module';
import { PrsModule } from './prs/prs.module';
import { ChatModule } from './chat/chat.module';
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
 
@Module({
	imports: [
		ConfigModule.forRoot(),
		ScheduleModule.forRoot(),
		TypeOrmModule.forRoot({
			type: 'postgres',
			host: process.env.DATABASE_HOST,
			port: parseInt(process.env.DATABASE_PORT, 10),
			username: process.env.DATABASE_USER,
			password: process.env.DATABASE_PASSWORD,
			database: process.env.DATABASE_NAME,
			entities: [__dirname + '/../**/*.entity{.ts,.js}'],
			// Never let TypeORM mutate a production schema implicitly.
			// Production deployments must apply reviewed migrations instead.
			synchronize:
				process.env.NODE_ENV !== 'production' &&
				process.env.DATABASE_SYNCHRONIZE !== 'false',
			// Stay well under Supabase session-mode pool_size (often 15 shared).
			poolSize: Math.min(Math.max(Number(process.env.DATABASE_POOL_SIZE) || 4, 2), 8),
			extra: {
				max: Math.min(Math.max(Number(process.env.DATABASE_POOL_SIZE) || 4, 2), 8),
				idleTimeoutMillis: 10000,
				connectionTimeoutMillis: 20000,
			},
		}),

		AuthModule,
		AssetModule,
		PlansModule,
		PrsModule,
		PlansModule,
		ChatModule,
		FormModule,
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
	],
	controllers: [AppController],
	providers: [AppService, QueryFailedErrorFilter],
	exports: [],
})
export class AppModule {
}