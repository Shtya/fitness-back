export type PhoneCredentialProvider =
	| 'twilio'
	| 'abstract'
	| 'numverify'
	| 'serpapi'
	| 'google_cse';

export const PHONE_CREDENTIAL_PROVIDERS: PhoneCredentialProvider[] = [
	'twilio',
	'abstract',
	'numverify',
	'serpapi',
	'google_cse',
];

export type CredentialFieldDef = {
	key: string;
	labelEn: string;
	labelAr: string;
	placeholder: string;
	secret?: boolean;
	minLength?: number;
};

export type ProviderCatalogItem = {
	id: PhoneCredentialProvider;
	name: string;
	purposeEn: string;
	purposeAr: string;
	docsUrl: string;
	signupUrl: string;
	stepsEn: string[];
	stepsAr: string[];
	fields: CredentialFieldDef[];
};

export const PHONE_PROVIDER_CATALOG: ProviderCatalogItem[] = [
	{
		id: 'twilio',
		name: 'Twilio Lookup',
		purposeEn: 'Carrier, line type, and limited US caller name (CNAM).',
		purposeAr: 'شركة الاتصالات ونوع الخط واسم المتصل المحدود (أمريكا غالبًا).',
		docsUrl: 'https://www.twilio.com/docs/lookup/v2-api',
		signupUrl: 'https://www.twilio.com/try-twilio',
		stepsEn: [
			'Open Twilio and create a free account.',
			'Go to Console → Account → API keys & tokens.',
			'Copy Account SID and Auth Token.',
			'Optional: enable Lookup Line Type Intelligence in the Twilio console.',
			'Paste both values below and save.',
		],
		stepsAr: [
			'افتح Twilio وأنشئ حسابًا مجانيًا.',
			'من Console → Account → API keys & tokens.',
			'انسخ Account SID و Auth Token.',
			'اختياري: فعّل Lookup Line Type Intelligence.',
			'الصق القيمتين بالأسفل واحفظ.',
		],
		fields: [
			{
				key: 'accountSid',
				labelEn: 'Account SID',
				labelAr: 'Account SID',
				placeholder: 'ACxxxxxxxx…',
				minLength: 10,
			},
			{
				key: 'authToken',
				labelEn: 'Auth Token',
				labelAr: 'Auth Token',
				placeholder: 'Your auth token',
				secret: true,
				minLength: 10,
			},
		],
	},
	{
		id: 'abstract',
		name: 'Abstract Phone Validation',
		purposeEn: 'Phone validity, carrier, line type, and country.',
		purposeAr: 'صلاحية الرقم وشركة الاتصالات ونوع الخط والدولة.',
		docsUrl: 'https://docs.abstractapi.com/phone-validation',
		signupUrl: 'https://www.abstractapi.com/api/phone-validation-api',
		stepsEn: [
			'Sign up at Abstract API.',
			'Open the Phone Validation API product.',
			'Copy your API key from the dashboard.',
			'Paste it below and save.',
		],
		stepsAr: [
			'سجّل في Abstract API.',
			'افتح منتج Phone Validation API.',
			'انسخ مفتاح API من لوحة التحكم.',
			'الصقه بالأسفل واحفظ.',
		],
		fields: [
			{
				key: 'apiKey',
				labelEn: 'API Key',
				labelAr: 'مفتاح API',
				placeholder: 'Abstract API key',
				secret: true,
				minLength: 8,
			},
		],
	},
	{
		id: 'numverify',
		name: 'Numverify',
		purposeEn: 'Alternative network validation (carrier / line type).',
		purposeAr: 'بديل للتحقق من الشبكة (الشركة / نوع الخط).',
		docsUrl: 'https://numverify.com/documentation',
		signupUrl: 'https://numverify.com/product',
		stepsEn: [
			'Create a Numverify account.',
			'Open Dashboard → API Access Key.',
			'Copy the access key.',
			'Paste it below and save.',
		],
		stepsAr: [
			'أنشئ حساب Numverify.',
			'من Dashboard → API Access Key.',
			'انسخ المفتاح.',
			'الصقه بالأسفل واحفظ.',
		],
		fields: [
			{
				key: 'apiKey',
				labelEn: 'Access Key',
				labelAr: 'مفتاح الوصول',
				placeholder: 'Numverify access key',
				secret: true,
				minLength: 8,
			},
		],
	},
	{
		id: 'serpapi',
		name: 'SerpAPI',
		purposeEn: 'Public Google search results for quoted phone numbers.',
		purposeAr: 'نتائج بحث Google العامة عن الرقم بين علامتي تنصيص.',
		docsUrl: 'https://serpapi.com/search-api',
		signupUrl: 'https://serpapi.com/',
		stepsEn: [
			'Sign up at SerpAPI.',
			'Open your dashboard.',
			'Copy the private API key.',
			'Paste it below and save.',
		],
		stepsAr: [
			'سجّل في SerpAPI.',
			'افتح لوحة التحكم.',
			'انسخ مفتاح API الخاص.',
			'الصقه بالأسفل واحفظ.',
		],
		fields: [
			{
				key: 'apiKey',
				labelEn: 'API Key',
				labelAr: 'مفتاح API',
				placeholder: 'SerpAPI key',
				secret: true,
				minLength: 8,
			},
		],
	},
	{
		id: 'google_cse',
		name: 'Google Custom Search',
		purposeEn: 'Public web matches via Google Programmable Search.',
		purposeAr: 'نتائج عامة عبر بحث Google القابل للبرمجة.',
		docsUrl: 'https://developers.google.com/custom-search/v1/overview',
		signupUrl: 'https://programmablesearchengine.google.com/',
		stepsEn: [
			'Create a Programmable Search Engine and enable “Search the entire web”.',
			'Copy the Search engine ID (cx).',
			'In Google Cloud Console, enable Custom Search API.',
			'Create an API key and restrict it to Custom Search API.',
			'Paste API key + cx below and save.',
		],
		stepsAr: [
			'أنشئ محرك بحث قابل للبرمجة وفعّل البحث في الويب بالكامل.',
			'انسخ Search engine ID (cx).',
			'في Google Cloud فعّل Custom Search API.',
			'أنشئ API key وقيّده على Custom Search API.',
			'الصق المفتاح و cx بالأسفل واحفظ.',
		],
		fields: [
			{
				key: 'apiKey',
				labelEn: 'API Key',
				labelAr: 'مفتاح API',
				placeholder: 'Google API key',
				secret: true,
				minLength: 10,
			},
			{
				key: 'cx',
				labelEn: 'Search Engine ID (cx)',
				labelAr: 'معرف محرك البحث (cx)',
				placeholder: 'cx value',
				minLength: 6,
			},
		],
	},
];

export function getProviderCatalog(id: string): ProviderCatalogItem | undefined {
	return PHONE_PROVIDER_CATALOG.find(p => p.id === id);
}
