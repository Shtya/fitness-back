// src/modules/reminders/reminders.entities.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToOne, JoinColumn, Index } from 'typeorm';

// IMPORTANT: عدّل المسار حسب مشروعك
import { User } from './global.entity';
export enum ReminderType {
  ADHKAR = 'adhkar',
  WATER = 'water',
  MEDICINE = 'medicine',
  APPOINTMENT = 'appointment',
  ROUTINE = 'routine',
  CUSTOM = 'custom',
}

export enum ScheduleMode {
  ONCE = 'once',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  INTERVAL = 'interval',
  PRAYER = 'prayer',
}

export enum IntervalUnit {
  MINUTE = 'minute',
  HOUR = 'hour',
  DAY = 'day',
}

export enum Priority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
}

type DaysKey = 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA';
type PrayerName = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';

export class SoundSettings {
  @Column({ type: 'varchar', length: 64, default: 'chime' })
  id!: string; // 'chime' | 'drop' | 'soft' | custom

  @Column({ type: 'float', default: 0.8 })
  volume!: number; // 0..1
}

export class ReminderMetrics {
  @Column({ type: 'int', default: 0 })
  streak!: number;

  @Column({ type: 'int', default: 0 })
  doneCount!: number;

  @Column({ type: 'int', default: 0 })
  skipCount!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastAckAt!: Date | null;
}

export class ReminderSchedule {
  @Column({ type: 'enum', enum: ScheduleMode, default: ScheduleMode.DAILY })
  mode!: ScheduleMode;

  @Column({ type: 'text', nullable: true,  array: true, default: () => 'ARRAY[]::text[]' })
  times!: string[];

  // ["MO","WE","FR"]
  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  daysOfWeek!: DaysKey[];

  // { every: 2, unit: "hour" }
  @Column({ type: 'jsonb', nullable: true })
  interval!: { every: number; unit: IntervalUnit } | null;

  // { name: "Fajr", direction: "before"|"after", offsetMin: number }
  @Column({ type: 'jsonb', nullable: true })
  prayer!: { name: PrayerName; direction: 'before' | 'after'; offsetMin: number } | null;

  @Column({ type: 'date', nullable: true })
  startDate!: string; // "YYYY-MM-DD"

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ type: 'varchar', length: 128, default: 'Africa/Cairo', nullable: true })
  timezone!: string;

  // تواريخ مستثناة
  @Column({ type: 'date', array: true, default: () => 'ARRAY[]::date[]' })
  exdates!: string[];

  // قابل للتوسعة لاحقاً (RFC5545)
  @Column({ type: 'text', default: '' })
  rrule!: string;
}

/* =========================================================================
   Reminder
   - Owning side فقط تجاه User (بدون inverse)
   - متوافق مع الـUI: schedule/soundSettings/metrics/flags
=========================================================================== */

@Entity('reminders')
@Index(['userId', 'isActive'])
@Index(['userId', 'type'])
export class Reminder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: ReminderType, default: ReminderType.CUSTOM })
  type!: ReminderType;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null; // UI: notes

  @Column({ type: 'enum', enum: Priority, default: Priority.NORMAL })
  priority!: Priority;

  @Column(() => ReminderSchedule)
  schedule!: ReminderSchedule;

  @Column(() => SoundSettings)
  soundSettings!: SoundSettings;

  @Column({ type: 'timestamptz', nullable: true })
  reminderTime!: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', default: false })
  isCompleted!: boolean;

  @Column(() => ReminderMetrics)
  metrics!: ReminderMetrics;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/* =========================================================================
   UserReminderSettings
   - إعدادات لكل مستخدم (صف/سجل واحد لكل userId)
   - Owning side OneToOne بدون inverse في User
=========================================================================== */

@Entity('reminder_user_settings')
@Index(['userId'], { unique: true })
export class UserReminderSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 128, default: 'Africa/Cairo' })
  timezone!: string;

  @Column({ type: 'varchar', length: 80, default: 'Cairo' })
  city!: string;

  @Column({ type: 'varchar', length: 80, default: 'Egypt' })
  country!: string;

  @Column({ type: 'int', default: 10 })
  defaultSnooze!: number; // minutes

  // { start: "10:00 PM", end: "07:00 AM" }
  @Column({ type: 'jsonb', default: () => `'{ "start": "10:00 PM", "end": "07:00 AM" }'` })
  quietHours!: { start: string; end: string };

  @Column({ type: 'varchar', length: 32, default: 'normal' })
  priorityDefault!: 'low' | 'normal' | 'high';

  @Column({ type: 'varchar', length: 64, default: 'chime' })
  soundDefault!: 'chime' | 'drop' | 'soft' | string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

	@Column({ type: 'varchar', nullable: true })
  telegramChatId?: string | null;

  @Column({ type: 'boolean', default: false })
  telegramEnabled!: boolean;

  @Column({ type: 'varchar', nullable: true })
  telegramLinkToken?: string | null;
}

/* =========================================================================
   PushSubscription
   - اشتراكات VAPID لكل جهاز/متصفح
   - Owning side ManyToOne بدون inverse في User
=========================================================================== */

@Entity('push_subscriptions')
@Index(['userId', 'endpoint'], { unique: true })
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  @Column({ type: 'text' })
  endpoint!: string;

  // p256dh / auth (Base64url strings)
  @Column({ type: 'varchar', length: 255 })
  p256dh!: string;

  @Column({ type: 'varchar', length: 255 })
  auth!: string;

  @Column({ type: 'timestamptz', nullable: true })
  expirationTime!: Date | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true }) // IPv4/IPv6
  ipAddress!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSentAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  failures!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/* =========================================================================
   NotificationLog
   - سجل محاولات الإرسال (نجاح/فشل + الـpayload / الخطأ)
   - Owning side ManyToOne تجاه User/Reminder بدون inverse
=========================================================================== */

export type NotificationStatus = 'queued' | 'sent' | 'failed';

@Entity('notification_logs')
@Index(['userId', 'status'])
@Index(['reminderId', 'status'])
export class NotificationLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  reminderId!: string | null;

  @ManyToOne(() => Reminder, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'reminderId' })
  reminder!: Reminder | null;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status!: NotificationStatus;

  // ما أُرسل فعليًا للـSW (title/body/…)
  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, any> | null;

  // تفاصيل خطأ (لو فشل)
  @Column({ type: 'jsonb', nullable: true })
  error!: { code?: number; message?: string } | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
