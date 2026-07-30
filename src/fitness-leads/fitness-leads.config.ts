export const FITNESS_COUNTRIES = {
	sa: { name: 'Saudi Arabia', nameAr: 'المملكة العربية السعودية', code: 'SA' },
	eg: { name: 'Egypt', nameAr: 'مصر', code: 'EG' },
	ae: { name: 'United Arab Emirates', nameAr: 'الإمارات العربية المتحدة', code: 'AE' },
	qa: { name: 'Qatar', nameAr: 'قطر', code: 'QA' },
	kw: { name: 'Kuwait', nameAr: 'الكويت', code: 'KW' },
	bh: { name: 'Bahrain', nameAr: 'البحرين', code: 'BH' },
	om: { name: 'Oman', nameAr: 'سلطنة عمان', code: 'OM' },
} as const;

export type FitnessCountryKey = keyof typeof FITNESS_COUNTRIES;

export const FITNESS_CITIES: Record<FitnessCountryKey, string[]> = {
	sa: ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar'],
	eg: ['Cairo', 'Giza', 'Alexandria', '6th of October', 'New Cairo'],
	ae: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Al Ain'],
	qa: ['Doha', 'Al Rayyan', 'Al Wakrah'],
	kw: ['Kuwait City', 'Hawalli', 'Salmiya', 'Farwaniya'],
	bh: ['Manama', 'Riffa', 'Muharraq'],
	om: ['Muscat', 'Salalah', 'Sohar'],
};

export const FITNESS_CITY_COORDS: Record<
	FitnessCountryKey,
	Record<string, { lat: number; lng: number }>
> = {
	sa: {
		Riyadh: { lat: 24.7136, lng: 46.6753 },
		Jeddah: { lat: 21.4858, lng: 39.1925 },
		Dammam: { lat: 26.3927, lng: 49.9777 },
		Mecca: { lat: 21.3891, lng: 39.8579 },
		Medina: { lat: 24.5247, lng: 39.5692 },
		Khobar: { lat: 26.2172, lng: 50.1971 },
	},
	eg: {
		Cairo: { lat: 30.0444, lng: 31.2357 },
		Giza: { lat: 30.0131, lng: 31.2089 },
		Alexandria: { lat: 31.2001, lng: 29.9187 },
		'6th of October': { lat: 29.9285, lng: 30.9188 },
		'New Cairo': { lat: 30.03, lng: 31.47 },
	},
	ae: {
		Dubai: { lat: 25.2048, lng: 55.2708 },
		'Abu Dhabi': { lat: 24.4539, lng: 54.3773 },
		Sharjah: { lat: 25.3463, lng: 55.4209 },
		Ajman: { lat: 25.4052, lng: 55.5136 },
		'Al Ain': { lat: 24.2075, lng: 55.7447 },
	},
	qa: {
		Doha: { lat: 25.2854, lng: 51.531 },
		'Al Rayyan': { lat: 25.2919, lng: 51.4244 },
		'Al Wakrah': { lat: 25.1715, lng: 51.6034 },
	},
	kw: {
		'Kuwait City': { lat: 29.3759, lng: 47.9774 },
		Hawalli: { lat: 29.332, lng: 48.0286 },
		Salmiya: { lat: 29.333, lng: 48.076 },
		Farwaniya: { lat: 29.273, lng: 47.958 },
	},
	bh: {
		Manama: { lat: 26.2235, lng: 50.5876 },
		Riffa: { lat: 26.13, lng: 50.555 },
		Muharraq: { lat: 26.2572, lng: 50.6119 },
	},
	om: {
		Muscat: { lat: 23.588, lng: 58.3829 },
		Salalah: { lat: 17.0151, lng: 54.0924 },
		Sohar: { lat: 24.3461, lng: 56.7075 },
	},
};

/** Preset search keywords / niches (not gym-only). Client may also send custom keywords. */
export const FITNESS_CATEGORIES = [
	// Fitness
	'gym',
	'fitness center',
	'health club',
	'personal trainer',
	'CrossFit gym',
	'pilates studio',
	'yoga studio',
	'sports academy',
	'wellness center',
	'صالة رياضية',
	'نادي رياضي',
	'نادي لياقة',
	'مدرب شخصي',
	// Broader business niches
	'e-commerce store',
	'online shop',
	'clinic',
	'dental clinic',
	'restaurant',
	'cafe',
	'beauty salon',
	'hair salon',
	'real estate agency',
	'coaching',
	'marketing agency',
	'coworking space',
	'pharmacy',
	'supplements store',
	'عيادة',
	'مطعم',
	'كافيه',
	'صالون تجميل',
	'عقارات',
	'متجر إلكتروني',
];

export const FITNESS_NEARBY_TYPES = ['gym', 'fitness_center', 'sports_complex'];

export const FITNESS_CONTACT_PATHS = [
	'contact',
	'contact-us',
	'about',
	'about-us',
	'membership',
	'join',
	'تواصل',
	'اتصل-بنا',
	'من-نحن',
];

export const FITNESS_SKIP_DOMAINS = [
	'apps.apple.com',
	'play.google.com',
	'linktr.ee',
	'instagram.com',
	'facebook.com',
	'twitter.com',
	'x.com',
	'tiktok.com',
	'youtube.com',
	'google.com',
	'maps.app.goo.gl',
	'goo.gl',
	'bit.ly',
	'wa.me',
	't.me',
];

export const BUSINESS_TYPE_KEYWORDS: Record<string, string[]> = {
	'CrossFit Gym': ['crossfit', 'كروس فت'],
	'Pilates Studio': ['pilates', 'بيلاتس'],
	'Yoga Studio': ['yoga', 'يوجا'],
	'Personal Trainer': ['personal train', 'pt studio', 'مدرب شخصي'],
	'Nutrition Coach': ['nutrition', 'diet', 'تغذية'],
	'Sports Academy': ['academy', 'sports club', 'أكاديمية'],
	'Wellness Center': ['wellness', 'spa'],
	'Health Club': ['health club'],
	'Fitness Center': ['fitness', 'لياقة'],
	Gym: ['gym', 'صالة', 'نادي رياضي'],
};

export const EXCLUDED_EMAIL_PREFIXES = [
	'noreply',
	'no-reply',
	'donotreply',
	'unsubscribe',
	'mailer-daemon',
	'postmaster',
];

export const GENERIC_EMAIL_PREFIXES = [
	'sales',
	'partnerships',
	'info',
	'contact',
	'hello',
	'admin',
	'office',
	'booking',
	'support',
	'membership',
];

export const FREE_EMAIL_DOMAINS = [
	'gmail.com',
	'hotmail.com',
	'yahoo.com',
	'outlook.com',
	'icloud.com',
	'live.com',
];
