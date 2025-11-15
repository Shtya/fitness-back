// src/modules/green-api/green-api.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class GreenApiService {
  private readonly logger = new Logger(GreenApiService.name);
  private readonly apiUrl: string;
  private readonly idInstance: string;
  private readonly apiTokenInstance: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiUrl = this.configService.get('GREEN_API_URL') || 'https://7107.api.green-api.com';
    this.idInstance = this.configService.get('GREEN_API_ID_INSTANCE') || '7107380613';
    this.apiTokenInstance = this.configService.get('GREEN_API_TOKEN') || '77c6de34651f4ab1a3b24ab70767f8d837d5847e3aa64529b1';
  }

  /**
   * Send WhatsApp message
   */
  async sendMessage(phoneNumber: string, message: string) {
    try {
      // Clean phone number (remove +, spaces, etc.)
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      
      const url = `${this.apiUrl}/waInstance${this.idInstance}/sendMessage/${this.apiTokenInstance}`;
      
      const response = await lastValueFrom(
        this.httpService.post(url, {
          chatId: `${cleanPhone}@c.us`,
          message: message,
        })
      );

      this.logger.log(`✅ WhatsApp message sent to ${cleanPhone}`);
      return response.data;
    } catch (error) {
      this.logger.error(`❌ Failed to send WhatsApp message to ${phoneNumber}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send file via WhatsApp
   */
  async sendFile(phoneNumber: string, fileUrl: string, caption?: string) {
    try {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      
      const url = `${this.apiUrl}/waInstance${this.idInstance}/sendFileByUrl/${this.apiTokenInstance}`;
      
      const response = await lastValueFrom(
        this.httpService.post(url, {
          chatId: `${cleanPhone}@c.us`,
          urlFile: fileUrl,
          fileName: 'reminder.jpg',
          caption: caption || 'Reminder',
        })
      );

      this.logger.log(`✅ WhatsApp file sent to ${cleanPhone}`);
      return response.data;
    } catch (error) {
      this.logger.error(`❌ Failed to send WhatsApp file to ${phoneNumber}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Check WhatsApp account state
   */
  async getAccountState() {
    try {
      const url = `${this.apiUrl}/waInstance${this.idInstance}/getStateInstance/${this.apiTokenInstance}`;
      
      const response = await lastValueFrom(this.httpService.get(url));
      return response.data;
    } catch (error) {
      this.logger.error('❌ Failed to get Green API account state:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Format reminder message for WhatsApp
   */
  formatReminderMessage(reminder: any): string {
    const schedule = reminder.schedule || {};
    const times = (schedule.times || []).map((time: string) => this.formatTimeForWhatsApp(time)).join(', ');
    
    const typeMap: { [key: string]: string } = {
      'adhkar': 'أذكار',
      'water': 'شرب الماء',
      'medicine': 'الدواء', 
      'appointment': 'موعد',
      'routine': 'روتين',
      'custom': 'تذكير'
    };

    let scheduleText = '';
    switch (schedule.mode) {
      case 'once':
        scheduleText = `مرة واحدة - ${times}`;
        break;
      case 'daily':
        scheduleText = `يومي - ${times}`;
        break;
      case 'weekly':
        const days = (schedule.daysOfWeek || []).map((day: string) => this.getArabicDay(day)).join('، ');
        scheduleText = `أسبوعي - ${days} - ${times}`;
        break;
      case 'monthly':
        scheduleText = `شهري - ${times}`;
        break;
      case 'interval':
        const interval = schedule.interval;
        if (interval) {
          const unitMap = {
            'minute': 'دقيقة',
            'hour': 'ساعة', 
            'day': 'يوم'
          };
          scheduleText = `كل ${interval.every} ${unitMap[interval.unit as keyof typeof unitMap] || interval.unit}`;
        }
        break;
      case 'prayer':
        const prayer = schedule.prayer;
        if (prayer) {
          const direction = prayer.direction === 'before' ? 'قبل' : 'بعد';
          scheduleText = `${prayer.name} - ${direction} ${prayer.offsetMin} دقيقة`;
        }
        break;
      default:
        scheduleText = times;
    }

    return `🔔 *تذكير*\n\n` +
           `*العنوان:* ${reminder.title}\n` +
           `*الموعد:* ${scheduleText}\n` +
           `*النوع:* ${typeMap[reminder.type] || reminder.type}\n` +
           `${reminder.description ? `*ملاحظات:* ${reminder.description}\n` : ''}\n` +
           `_هذا تذكير آلي من تطبيقك_`;
  }

  /**
   * Format time for WhatsApp display
   */
  private formatTimeForWhatsApp(time: string): string {
    if (!time) return '--:--';
    
    try {
      const [hours, minutes] = time.split(':').map(Number);
      const isPM = hours >= 12;
      const displayHours = hours % 12 || 12;
      return `${displayHours}:${minutes.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
    } catch {
      return time;
    }
  }

  /**
   * Get Arabic day name
   */
  private getArabicDay(dayKey: string): string {
    const dayMap: { [key: string]: string } = {
      'SU': 'الأحد',
      'MO': 'الإثنين', 
      'TU': 'الثلاثاء',
      'WE': 'الأربعاء',
      'TH': 'الخميس',
      'FR': 'الجمعة',
      'SA': 'السبت'
    };
    return dayMap[dayKey] || dayKey;
  }
}