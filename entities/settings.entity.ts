// src/modules/settings/entities/gym-settings.entity.ts
import { Entity, Column, OneToMany, Unique, Index, ManyToOne } from 'typeorm';
import { CoreEntity } from 'entities/core.entity';

export enum DefaultLang {
  AR = 'ar',
  EN = 'en',
}

export enum ThemeMode {
  LIGHT = 'light',
  DARK = 'dark',
}

export enum ReportWeekday {
  Saturday = 'Saturday',
  Sunday = 'Sunday',
  Monday = 'Monday',
  Tuesday = 'Tuesday',
  Wednesday = 'Wednesday',
  Thursday = 'Thursday',
  Friday = 'Friday',
}

export type ThemePalette = {
  primary: string;
  onPrimary: string;
  secondary: string;
  surface: string;
  onSurface: string;
  background: string;
  onBackground: string;
  success: string;
  warning: string;
  danger: string;
  muted: string;
};

@Entity('gym_settings')
@Unique(['organizationKey'])
export class GymSettings extends CoreEntity {
  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  adminId!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  organizationKey!: string | null;

  @Column({ type: 'varchar', length: 160 })
  orgName!: string;

  @Column({ type: 'enum', enum: DefaultLang, default: DefaultLang.AR })
  defaultLang!: DefaultLang;

  @Column({ type: 'varchar', length: 80, default: 'Africa/Cairo' })
  timezone!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160, nullable: true })
  homeSlug!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  metaTitle!: string | null;

  @Column({ type: 'text', nullable: true })
  metaDescription!: string | null;

  @Column({ type: 'varchar', length: 600, nullable: true })
  metaKeywords!: string | null;

  @Column({ type: 'varchar', length: 600, nullable: true })
  ogImageUrl!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  homeTitle!: string | null;

  @Column({ type: 'boolean', default: true })
  loaderEnabled!: boolean;

  @Column({ type: 'varchar', length: 240, default: 'جارٍ التحميل… لحظات ونكون معك' })
  loaderMessage!: string;

  @Column({ type: 'int', default: 2 })
  loaderDurationSec!: number;

  @Column({ type: 'boolean', default: true })
  dhikrEnabled!: boolean;

  @Column({ type: 'bigint', nullable: true })
  activeDhikrId!: string | number | null;

  @OneToMany(() => DhikrItem, d => d.settings, {
    cascade: true,
    eager: true,
    orphanedRowAction: 'delete',
  })
  dhikrItems!: DhikrItem[];

  @Column({
    type: 'jsonb',
    default: () => `'{
    "primary":"#0f172b",
    "onPrimary":"#ffffff",
    "secondary":"#6366f1",
    "surface":"#ffffff",
    "onSurface":"#0f172a",
    "background":"#f8fafc",
    "onBackground":"#0f172a",
    "success":"#10b981",
    "warning":"#f59e0b",
    "danger":"#ef4444",
    "muted":"#94a3b8"
  }'`,
  })
  themePalette!: ThemePalette;

  @Column({ type: 'boolean', default: true })
  reportEnabled!: boolean;

  @Column({ type: 'enum', enum: ReportWeekday, default: ReportWeekday.Sunday })
  reportDay!: ReportWeekday;

  @Column({ type: 'varchar', length: 5, default: '09:00' })
  reportTime!: string;

  @Column({ type: 'boolean', default: true })
  rptWeightTrend!: boolean;

  @Column({ type: 'boolean', default: true })
  rptMealAdherence!: boolean;

  @Column({ type: 'boolean', default: true })
  rptWorkoutCompletion!: boolean;

  @Column({ type: 'boolean', default: true })
  rptWaterIntake!: boolean;

  @Column({ type: 'boolean', default: true })
  rptCheckinNotes!: boolean;

  @Column({ type: 'boolean', default: true })
  rptNextFocus!: boolean;

  @Column({ type: 'boolean', default: false })
  rptLatestPhotos!: boolean;

  @Column({ type: 'text', default: 'عمل ممتاز هذا الأسبوع، {name}! استمر.' })
  reportCustomMessage!: string;

  @OneToMany(() => ReminderSetting, r => r.settings, {
    cascade: true,
    eager: true,
    orphanedRowAction: 'delete',
  })
  reminders!: ReminderSetting[];
}

@Entity('reminders-setting')
export class ReminderSetting extends CoreEntity {
  @Index()
  @ManyToOne(() => GymSettings, s => s.reminders, { onDelete: 'CASCADE' })
  settings!: GymSettings;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** HH:mm (24h) */
  @Column({ type: 'varchar', length: 5 })
  time!: string;
}

@Entity('dhikr_items')
export class DhikrItem extends CoreEntity {
  @Index()
  @ManyToOne(() => GymSettings, s => s.dhikrItems, { onDelete: 'CASCADE' })
  settings!: GymSettings;

  @Column({ type: 'varchar', length: 200 })
  text!: string;
}
