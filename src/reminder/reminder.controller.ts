// src/modules/reminders/reminder.controller.ts
import { Body, Controller, Delete, Get, Headers, Ip, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsIn, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { IntervalUnit, Priority, ReminderType, ScheduleMode } from 'entities/alert.entity';
import { RemindersService } from './reminder.service';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';

function currentUserId(req: any): string {
	return req.user?.id ?? req.userId;
}

class IntervalDto {
	@IsInt()
	every!: number;

	@IsEnum(IntervalUnit)
	unit!: IntervalUnit;
}

class PrayerDto {
	@IsIn(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'])
	name!: 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';

	@IsIn(['before', 'after'])
	direction!: 'before' | 'after';

	@IsInt()
	offsetMin!: number;
}


class SnoozeDto {
	@IsInt()
	minutes!: number;
}

class UpdateUserSettingsDto {
	@IsString()
	@IsOptional()
	timezone?: string;

	@IsString()
	@IsOptional()
	city?: string;

	@IsString()
	@IsOptional()
	country?: string;

	@IsInt()
	@IsOptional()
	defaultSnooze?: number;

	@IsObject()
	@IsOptional()
	quietHours?: { start: string; end: string };

	@IsIn(['low', 'normal', 'high'])
	@IsOptional()
	priorityDefault?: 'low' | 'normal' | 'high';

	@IsString()
	@IsOptional()
	soundDefault?: string;
}

class PushSubscribeDto {
	@IsString()
	endpoint!: string;

	@IsOptional()
	expirationTime?: string | null;

	@IsObject()
	keys!: { p256dh: string; auth: string };
}

@Controller('reminders')
export class RemindersController {
	constructor(private readonly svc: RemindersService) { }
	// Endpoint to test sending reminder via WebSocket
	@Post('test-send-websocket')
	async testSendWebSocket(@Body() body: { reminderId: string; userId: string }) {
		const { reminderId, userId } = body;

		let reminder: any;
		try {
			reminder = await this.svc.getReminderRepo().findOne({ where: { id: reminderId } });
			if (!reminder) {
				return { success: false, error: 'Reminder not found' };
			}
		} catch (err) {
			return { success: false, error: 'Error fetching reminder', details: err };
		}

		try {
			const gateway = this.svc.getReminderGateway();
			if (!gateway) {
				return { success: false, error: 'ReminderGateway is undefined' };
			}
			// Check if user is connected
			const isConnected = gateway.isUserConnected(userId);
			const result = gateway.sendReminderToUser(userId, reminder);
			return { success: result, debug: { isConnected } };
		} catch (err) {
			return { success: false, error: 'Error sending via WebSocket', details: err };
		}
	}

	@Post('test-push-direct')
	async testPushDirect(@Body() body: { userId: string; title?: string; body?: string }) {
		const { userId, title = 'Test Reminder', body: msgBody = 'This is a test push notification' } = body;

		if (!userId) {
			return { success: false, error: 'userId is required' };
		}

		const payload = {
			title,
			body: msgBody,
			icon: '/icons/bell.svg',
			url: '/dashboard/reminders',
			data: { type: 'test' },
			requireInteraction: true,
			reminderId: null,
		};

		try {
			const results = await this.svc.sendPushToUser(userId, payload);
			const successCount = results.filter((r: any) => r.ok).length;
			return {
				success: successCount > 0,
				totalAttempts: results.length,
				successCount,
				results,
				debug: {
					userId,
					timestamp: new Date().toISOString(),
					message: `Attempted to send push to ${results.length} subscriptions`,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: String(error),
				debug: { userId, timestamp: new Date().toISOString() },
			};
		}
	}

	@Post('telegram-test')
	@UseGuards(JwtAuthGuard)
	async testTelegram(@Req() req: any, @Body() body: { chatId: string; message?: string }) {
		const userId = currentUserId(req);

		if (!body.chatId) {
			return {
				success: false,
				error: 'chatId is required',
			};
		}

		const result = await this.svc.sendTelegramTestToUser(body.chatId, body.message);

		return {
			success: true,
			userId,
			chatId: body.chatId,
			message: body.message || '🔔 Test reminder from So7baFit bot',
			telegramResponse: result,
		};
	}


	@Post('send-now')
	@UseGuards(JwtAuthGuard)
	async sendNow(@Req() req: any, @Body() dto: any) {
		const userId: string = currentUserId(req);
		return this.svc.sendNow(userId, dto);
	}

	@Get('settings/user')
	@UseGuards(JwtAuthGuard)
	async getSettings(@Req() req: any) {
		const uid = currentUserId(req);
		return this.svc.getUserSettings(uid);
	}

	@Get()
	@UseGuards(JwtAuthGuard)
	async list(@Req() req: any, @Query() q: any) {
		const uid = currentUserId(req);
		return this.svc.list(uid, q);
	}

	@Post()
	@UseGuards(JwtAuthGuard)
	async create(@Req() req: any, @Body() dto: any) {
		const uid = currentUserId(req);
		return this.svc.create(uid, dto);
	}

	@Put(':id')
	@UseGuards(JwtAuthGuard)
	async update(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		const uid = currentUserId(req);
		return this.svc.update(uid, id, dto);
	}

	@Delete(':id')
	@UseGuards(JwtAuthGuard)
	async remove(@Req() req: any, @Param('id') id: string) {
		const uid = currentUserId(req);
		return this.svc.remove(uid, id);
	}

	@Put(':id/toggle')
	@UseGuards(JwtAuthGuard)
	async toggle(@Req() req: any, @Param('id') id: string) {
		const uid = currentUserId(req);
		return this.svc.toggle(uid, id);
	}

	@Put(':id/complete')
	@UseGuards(JwtAuthGuard)
	async complete(@Req() req: any, @Param('id') id: string) {
		const uid = currentUserId(req);
		return this.svc.complete(uid, id);
	}

	@Put(':id/snooze')
	@UseGuards(JwtAuthGuard)
	async snooze(@Req() req: any, @Param('id') id: string, @Body() body: SnoozeDto) {
		const uid = currentUserId(req);
		return this.svc.snooze(uid, id, body.minutes);
	}

	/* -------------------------- User Settings -------------------------- */

	@Put('settings/user')
	@UseGuards(JwtAuthGuard)
	async updateSettings(@Req() req: any, @Body() patch: UpdateUserSettingsDto) {
		const uid = currentUserId(req);
		return this.svc.updateUserSettings(uid, patch);
	}

	/* ------------------------------ Push ------------------------------- */

	@Get('push/vapid-key')
	vapidKey() {
		return this.svc.getVapidPublicKey();
	}

	@Post('push/subscribe')
	@UseGuards(JwtAuthGuard)
	async subscribe(@Req() req: any, @Body() dto: PushSubscribeDto, @Headers('user-agent') ua: string, @Ip() ip: string) {
		const uid = currentUserId(req) ?? null;
		return this.svc.subscribePush(uid, dto, ua, ip);
	}

		@Get('due')
	@UseGuards(JwtAuthGuard)
	async getDueReminders(@Req() req: any) {
		const uid = currentUserId(req);
		// ممكن تبعت now من هنا لو حابب توحّد التوقيت
		return this.svc.getDueRemindersForUser(uid, new Date());
	}


	@Get(':id')
	@UseGuards(JwtAuthGuard)
	async one(@Req() req: any, @Param('id') id: string) {
		const uid = currentUserId(req);
		return this.svc.get(uid, id);
	}


	@Post('telegram/webhook')
	async telegramWebhook(@Body() body: any) {
		return this.svc.handleTelegramWebhook(body);
	}
	
	@Post('telegram/link')
	@UseGuards(JwtAuthGuard)
	async createTelegramLink(@Req() req: any) {
		const uid = currentUserId(req);
		return this.svc.createTelegramLink(uid);
	}

}
