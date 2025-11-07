// src/modules/settings/settings.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { GymSettings, DhikrItem, ReminderSetting } from 'entities/settings.entity';
import { UpdateSettingsDto } from './settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(GymSettings)
    private readonly settingsRepo: Repository<GymSettings>,
    @InjectRepository(DhikrItem)
    private readonly dhikrRepo: Repository<DhikrItem>,
    @InjectRepository(ReminderSetting)
    private readonly reminderRepo: Repository<ReminderSetting>,
  ) {}

  async getOrCreate(): Promise<GymSettings> {
    const found = await this.settingsRepo.find({ take: 1 });
    if (found.length) return found[0];

    const created = this.settingsRepo.create({
      orgName: 'My Gym',
      defaultLang: 'ar',
      timezone: 'Africa/Cairo',
      loaderEnabled: true,
      loaderMessage: 'جارٍ التحميل… لحظات ونكون معك',
      loaderDurationSec: 2,
      dhikrEnabled: true,
      themePalette: {
        primary: '#4f46e5',
        onPrimary: '#ffffff',
        secondary: '#6366f1',
        surface: '#ffffff',
        onSurface: '#0f172a',
        background: '#f8fafc',
        onBackground: '#0f172a',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        muted: '#94a3b8',
      },
      reportEnabled: true,
      reportDay: 'Sunday',
      reportTime: '09:00',
      rptWeightTrend: true,
      rptMealAdherence: true,
      rptWorkoutCompletion: true,
      rptWaterIntake: true,
      rptCheckinNotes: true,
      rptNextFocus: true,
      rptLatestPhotos: false,
      reportCustomMessage: 'عمل ممتاز هذا الأسبوع، {name}! استمر.',
      dhikrItems: [],
      reminders: [],
    } as Partial<GymSettings>);

    return this.settingsRepo.save(created);
  }

  async get(): Promise<GymSettings> {
    return this.getOrCreate();
  }

  /**
   * Bulk upsert for nested arrays by replacing collections
   * (orphanedRowAction: 'delete' on relations will clean removed rows).
   */
  async update(dto: UpdateSettingsDto): Promise<GymSettings> {
    const s = await this.getOrCreate();

    // simple scalar assignments
    s.organizationKey = dto.organizationKey ?? s.organizationKey ?? null;
    s.orgName = dto.orgName;
    s.defaultLang = dto.defaultLang;
    s.timezone = dto.timezone;
    s.homeSlug = dto.homeSlug ?? null;

    s.metaTitle = dto.metaTitle ?? null;
    s.metaDescription = dto.metaDescription ?? null;
    s.metaKeywords = dto.metaKeywords ?? null;
    s.ogImageUrl = dto.ogImageUrl ?? null;
    s.homeTitle = dto.homeTitle ?? null;

    s.loaderEnabled = dto.loaderEnabled;
    s.loaderMessage = dto.loaderMessage;
    s.loaderDurationSec = dto.loaderDurationSec;

    s.dhikrEnabled = dto.dhikrEnabled;
    s.activeDhikrId = (dto.activeDhikrId as any) ?? null;

    s.themePalette = dto.themePalette as any;

    s.reportEnabled = dto.reportEnabled;
    s.reportDay = dto.reportDay;
    s.reportTime = dto.reportTime;
    s.rptWeightTrend = dto.rptWeightTrend;
    s.rptMealAdherence = dto.rptMealAdherence;
    s.rptWorkoutCompletion = dto.rptWorkoutCompletion;
    s.rptWaterIntake = dto.rptWaterIntake;
    s.rptCheckinNotes = dto.rptCheckinNotes;
    s.rptNextFocus = dto.rptNextFocus;
    s.rptLatestPhotos = dto.rptLatestPhotos;
    s.reportCustomMessage = dto.reportCustomMessage;

    // replace Dhikr collection
    const nextDhikr = (dto.dhikrItems || []).map((d) =>
      this.dhikrRepo.create({ id: (d as any).id, text: d.text, settings: s }),
    );
    s.dhikrItems = nextDhikr;

    // replace Reminders collection
    const nextReminders = (dto.reminders || []).map((r) =>
      this.reminderRepo.create({ id: (r as any).id, title: r.title, time: r.time, settings: s }),
    );
    s.reminders = nextReminders;

    return this.settingsRepo.save(s);
  }

  async setOgImageUrl(url: string): Promise<GymSettings> {
    const s = await this.getOrCreate();
    s.ogImageUrl = url;
    return this.settingsRepo.save(s);
  }
}
