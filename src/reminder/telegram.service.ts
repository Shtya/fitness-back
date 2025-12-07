import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Reminder } from 'entities/alert.entity';

@Injectable()
export class TelegramService {
	private readonly logger = new Logger(TelegramService.name);
	private readonly apiBase: string;

	constructor() {
		const token = process.env.TELEGRAM_BOT_TOKEN;
		if (!token) {
			this.logger.warn('TELEGRAM_BOT_TOKEN is not set. Telegram notifications are disabled.');
		}
		this.apiBase = token ? `https://api.telegram.org/bot${token}` : '';
	}

	async sendMessage(chatId: string, text: string) {
		if (!this.apiBase) return;

		try {
			await axios.post(`${this.apiBase}/sendMessage`, {
				chat_id: chatId,
				text,
				parse_mode: 'Markdown',
			});
		} catch (err) {
			this.logger.error('Failed to send Telegram message', err);
		}
	}

	// تقدر تستخدم نفس المنطق اللي عندك في formatWhatsAppMessage
	buildReminderText(reminder: Reminder): string {
		const title = reminder.title || 'Reminder';
		return `🔔 *التذكير:* ${title}`;
	}
}
