export type FitnessCredentialProvider =
	| 'google_places'
	| 'hunter'
	| 'apollo'
	| 'clearbit';

export const FITNESS_CREDENTIAL_PROVIDERS: FitnessCredentialProvider[] = [
	'google_places',
	'hunter',
	'apollo',
	'clearbit',
];

export const FITNESS_PROVIDER_CATALOG = [
	{
		id: 'google_places' as const,
		name: 'Google Places API',
		purposeEn: 'Required. Finds gyms and fitness businesses via Google Places Text/Nearby search.',
		purposeAr: 'مطلوب. يبحث عن الجيمات وأنشطة اللياقة عبر Google Places.',
		docsUrl: 'https://developers.google.com/maps/documentation/places/web-service/overview',
		signupUrl: 'https://console.cloud.google.com/google/maps-apis/credentials',
		stepsEn: [
			'Open Google Cloud Console and create/select a project.',
			'Enable billing on the project.',
			'Enable Places API (New).',
			'Create an API key and restrict it to Places API.',
			'Paste the key below and save.',
		],
		stepsAr: [
			'افتح Google Cloud Console وأنشئ/اختر مشروعًا.',
			'فعّل الفوترة على المشروع.',
			'فعّل Places API (New).',
			'أنشئ API key وقيّده على Places API.',
			'الصق المفتاح بالأسفل واحفظ.',
		],
		fields: [
			{
				key: 'apiKey',
				labelEn: 'API Key',
				labelAr: 'مفتاح API',
				placeholder: 'AIza…',
				secret: true,
				minLength: 20,
			},
		],
		required: true,
	},
	{
		id: 'hunter' as const,
		name: 'Hunter.io',
		purposeEn: 'Optional. Find public business emails by website domain.',
		purposeAr: 'اختياري. إيجاد إيميلات الأعمال العامة من دومين الموقع.',
		docsUrl: 'https://hunter.io/api-documentation/v2',
		signupUrl: 'https://hunter.io/users/sign_up',
		stepsEn: [
			'Sign up at Hunter.io.',
			'Open API section in your dashboard.',
			'Copy your API key.',
			'Paste and save.',
		],
		stepsAr: [
			'سجّل في Hunter.io.',
			'افتح قسم API في لوحة التحكم.',
			'انسخ المفتاح.',
			'الصقه واحفظ.',
		],
		fields: [
			{
				key: 'apiKey',
				labelEn: 'API Key',
				labelAr: 'مفتاح API',
				placeholder: 'Hunter API key',
				secret: true,
				minLength: 8,
			},
		],
		required: false,
	},
	{
		id: 'apollo' as const,
		name: 'Apollo.io',
		purposeEn: 'Optional. Enrich company domain for emails / LinkedIn.',
		purposeAr: 'اختياري. إثراء بيانات الشركة من الدومين.',
		docsUrl: 'https://apolloio.github.io/apollo-api-docs/',
		signupUrl: 'https://www.apollo.io/',
		stepsEn: [
			'Create an Apollo account.',
			'Go to Settings → Integrations → API.',
			'Copy the API key.',
			'Paste and save.',
		],
		stepsAr: [
			'أنشئ حساب Apollo.',
			'من Settings → Integrations → API.',
			'انسخ المفتاح.',
			'الصقه واحفظ.',
		],
		fields: [
			{
				key: 'apiKey',
				labelEn: 'API Key',
				labelAr: 'مفتاح API',
				placeholder: 'Apollo API key',
				secret: true,
				minLength: 8,
			},
		],
		required: false,
	},
	{
		id: 'clearbit' as const,
		name: 'Clearbit',
		purposeEn: 'Optional. Company enrichment by domain.',
		purposeAr: 'اختياري. إثراء بيانات الشركة من الدومين.',
		docsUrl: 'https://clearbit.com/docs',
		signupUrl: 'https://dashboard.clearbit.com/',
		stepsEn: [
			'Sign up / log in to Clearbit.',
			'Copy your API key from the dashboard.',
			'Paste and save.',
		],
		stepsAr: [
			'سجّل أو ادخل إلى Clearbit.',
			'انسخ المفتاح من اللوحة.',
			'الصقه واحفظ.',
		],
		fields: [
			{
				key: 'apiKey',
				labelEn: 'API Key',
				labelAr: 'مفتاح API',
				placeholder: 'Clearbit API key',
				secret: true,
				minLength: 8,
			},
		],
		required: false,
	},
];
