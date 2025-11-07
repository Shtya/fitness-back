import { Body, Controller, Delete, Get, Headers, Ip, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { RemindersService } from './reminder.service';

// -------- DTOs (محلية لتقليل الملفات) --------
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateNested, IsIn, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { IntervalUnit, Priority, ReminderType, ScheduleMode } from 'entities/alert.entity';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';

// استبدلها بـ AuthGuard الفعلي عندك
function currentUserId(req: any): string {
  return String(req.user?.id);
}

/* --- DTOs --- */
class IntervalDto {
  @IsInt() every!: number;
  @IsEnum(IntervalUnit) unit!: IntervalUnit;
}
class PrayerDto {
  @IsIn(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']) name!: 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';
  @IsIn(['before', 'after']) direction!: 'before' | 'after';
  @IsInt() offsetMin!: number;
}

class ScheduleDto {
  @IsEnum(ScheduleMode) mode!: ScheduleMode;
  @IsArray() @IsString({ each: true }) @IsOptional() times?: string[];
  @IsArray() @IsString({ each: true }) @IsOptional() daysOfWeek?: ('SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA')[];
  @ValidateNested() @Type(() => IntervalDto) @IsOptional() interval?: IntervalDto;
  @ValidateNested() @Type(() => PrayerDto) @IsOptional() prayer?: PrayerDto;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string | null;
  @IsString() timezone!: string;
  @IsArray() @IsOptional() exdates?: string[];
  @IsString() @IsOptional() rrule?: string;
}
class SoundSettingsDto {
  @IsString() id!: string;
  @IsOptional() volume?: number;
}

class CreateReminderDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(ReminderType) type!: ReminderType;
  @IsEnum(Priority) @IsOptional() priority?: Priority;
  @IsBoolean() @IsOptional() isActive?: boolean;
  @IsBoolean() @IsOptional() isCompleted?: boolean;
  @ValidateNested() @Type(() => SoundSettingsDto) soundSettings!: SoundSettingsDto;
  @ValidateNested() @Type(() => ScheduleDto) schedule!: ScheduleDto;
  @IsOptional() @IsDateString() reminderTime?: string;
}
class UpdateReminderDto {
  @IsString() @IsOptional() title?: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(ReminderType) @IsOptional() type?: ReminderType;
  @IsEnum(Priority) @IsOptional() priority?: Priority;
  @IsBoolean() @IsOptional() isActive?: boolean;
  @IsBoolean() @IsOptional() isCompleted?: boolean;
  @ValidateNested() @Type(() => SoundSettingsDto) @IsOptional() soundSettings?: SoundSettingsDto;
  @ValidateNested() @Type(() => ScheduleDto) @IsOptional() schedule?: ScheduleDto;
  @IsOptional() @IsDateString() reminderTime?: string;
}

class SnoozeDto {
  @IsInt() minutes!: number;
}

class UpdateUserSettingsDto {
  @IsString() @IsOptional() timezone?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() country?: string;
  @IsInt() @IsOptional() defaultSnooze?: number;
  @IsObject() @IsOptional() quietHours?: { start: string; end: string };
  @IsIn(['low', 'normal', 'high']) @IsOptional() priorityDefault?: 'low' | 'normal' | 'high';
  @IsString() @IsOptional() soundDefault?: string;
}

class PushSubscribeDto {
  @IsString() endpoint!: string;
  @IsOptional() expirationTime?: string | null;
  @IsObject() keys!: { p256dh: string; auth: string };
}
class PushSendDto {
  @IsObject() payload!: Record<string, any>;
}

@Controller('reminders')
export class RemindersController {
  constructor(private readonly svc: RemindersService) {}

  @Post('send-now')
  @UseGuards(JwtAuthGuard)
  sendNow(@Req() req: any, @Body() dto: any) {
    const userId: string = req.user?.id || req.userId; // adapt to your auth
    return this.svc.sendNow(userId, dto);
  }

  // POST /reminders/:id/send-now  (hydrate from an existing reminder)
  @Post(':id/send-now')
  @UseGuards(JwtAuthGuard)
  sendNowForReminder(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    const userId: string = req.user?.id || req.userId;
    return this.svc.sendNow(userId, { ...dto, reminderId: id });
  }

  /* Reminders CRUD */
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
  async create(@Req() req: any, @Body() dto: CreateReminderDto) {
    const uid = currentUserId(req);
    console.log('here');
    return this.svc.create(uid, dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateReminderDto) {
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

  /* User Settings */

  @Put('settings/user')
  @UseGuards(JwtAuthGuard)
  async updateSettings(@Req() req: any, @Body() patch: UpdateUserSettingsDto) {
    const uid = currentUserId(req);
    return this.svc.updateUserSettings(uid, patch);
  }

  @Get('push/vapid-key')
  vapidKey() {
    return this.svc.getVapidPublicKey();
  }

  @Post('push/subscribe')
  async subscribe(@Req() req: any, @Body() dto: PushSubscribeDto, @Headers('user-agent') ua: string, @Ip() ip: string) {
    const uid = currentUserId(req);
    return this.svc.subscribePush(uid, dto, ua, ip);
  }

  @Post('push/send')
  @UseGuards(JwtAuthGuard)
  async sendToMe(@Req() req: any, @Body() body: PushSendDto) {
    const uid = currentUserId(req);
    return this.svc.sendPushToUser(uid, body.payload);
  }

  // بثّ عام (استخدمه إدارياً فقط)
  @Post('push/admin-broadcast')
  async broadcast(@Body() body: PushSendDto) {
    return this.svc.adminBroadcast(body.payload);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async one(@Req() req: any, @Param('id') id: string) {
    const uid = currentUserId(req);
    return this.svc.get(uid, id);
  }
}
