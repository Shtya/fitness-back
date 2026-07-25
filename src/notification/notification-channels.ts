/**
 * Android notification channel ids.
 * Must stay in sync with `mobile/helpers/NotificationService.js` — a payload that
 * references an unknown channel falls back to the OS default channel, which has
 * DEFAULT importance and therefore never produces a heads-up / lockscreen popup.
 */
export const NOTIFICATION_CHANNELS = {
  DEFAULT: 'so7bafit_default',
  CHAT: 'so7bafit_chat',
  CALENDAR: 'so7bafit_calendar',
  REMINDERS: 'so7bafit_reminders',
} as const;

export type NotificationChannelId = (typeof NOTIFICATION_CHANNELS)[keyof typeof NOTIFICATION_CHANNELS];
