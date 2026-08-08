/**
 * Meta WhatsApp outreach templates (UTILITY clones + friendly seeds).
 * Preview via GET /meta-whatsapp/templates/seed
 * Submit via POST /meta-whatsapp/templates/seed (requires working WABA + token)
 *
 * so7ba_fitness_util_* = clones of so7ba_fitness_outreach_* as UTILITY
 * (Meta forbids same name + forbids changing category on approved templates).
 * Note: Meta may still auto-recategorize marketing-style copy during review.
 */

export type So7baSeedTemplate = {
	key: string;
	name: string;
	language: string;
	category: 'MARKETING' | 'UTILITY';
	headerFormat: 'TEXT' | 'NONE';
	headerText?: string;
	bodyText: string;
	footerText?: string;
	buttons?: Array<{
		type: 'URL' | 'QUICK_REPLY' | 'PHONE_NUMBER';
		text: string;
		url?: string;
		phone_number?: string;
	}>;
	exampleBodyParams?: string[];
	presentationUrl: string;
	description: string;
};

const PRESENTATION_EN = 'https://so7bafit.com/en/presentation';
const PRESENTATION_AR = 'https://so7bafit.com/ar/presentation';

export const SO7BA_META_TEMPLATE_SEEDS: So7baSeedTemplate[] = [
	{
		key: 'fitness_outreach_ar_util',
		name: 'so7ba_fitness_util_ar',
		language: 'ar',
		category: 'UTILITY',
		headerFormat: 'TEXT',
		headerText: 'So7baFit للمنصات الرياضية',
		bodyText: [
			'مرحبًا {{1}}،',
			'',
			'شفت بروفايل حضرتك ولاحظت اهتمامك بمجال اللياقة، فحبيت أتواصل معك.',
			'',
			'طورنا منصة متكاملة لإدارة الجيمات والأونلاين كوتشنج تجمع شغل الكوتش أو الجيم في مكان واحد بدل الاعتماد على الواتساب والإكسل وملفات PDF.',
			'',
			'المنصة تحل:',
			'• فوضى متابعة العملاء والاشتراكات',
			'• تشتت خطط التمرين والتغذية',
			'• ضعف المتابعة الأسبوعية والالتزام',
			'• صعوبة الفوترة والتنبيهات والتواصل الاحترافي',
			'',
			'النتيجة: توفير وقت الكوتش، تنظيم التشغيل، وتجربة عميل أقوى تساعد على الاحتفاظ بالمشتركين ونمو الأعمال.',
			'',
			'لو عندك 10 دقائق هذا الأسبوع، يسعدني أعمل Demo سريع وأسمع رأيك — حتى لو ما كان فيه تعاون.',
		].join('\n'),
		footerText: 'So7baFit',
		buttons: [
			{ type: 'URL', text: 'شاهد العرض', url: PRESENTATION_AR },
			{ type: 'QUICK_REPLY', text: 'مهتم بالديمو' },
		],
		exampleBodyParams: ['أحمد'],
		presentationUrl: PRESENTATION_AR,
		description: 'Clone of so7ba_fitness_outreach_ar as UTILITY',
	},
	{
		key: 'fitness_outreach_en_util',
		name: 'so7ba_fitness_util_en',
		language: 'en_US',
		category: 'UTILITY',
		headerFormat: 'TEXT',
		headerText: 'So7baFit for fitness businesses',
		bodyText: [
			'Hi {{1}},',
			'',
			'I came across your profile and noticed you are in the fitness industry, so I wanted to reach out.',
			'',
			'We built an all-in-one platform for gyms and online coaching that replaces WhatsApp threads, spreadsheets, and PDFs with one operating system.',
			'',
			'It solves:',
			'• Client & membership chaos',
			'• Scattered workout and nutrition plans',
			'• Weak weekly follow-up and retention',
			'• Manual billing, reminders, and messaging',
			'',
			'The result: coaches save time, ops stay organized, and clients get a professional experience that grows the business.',
			'',
			'If you have 10 minutes this week, I would love to give you a quick demo and hear your feedback — even if we do not collaborate afterward.',
		].join('\n'),
		footerText: 'So7baFit',
		buttons: [
			{ type: 'URL', text: 'View presentation', url: PRESENTATION_EN },
			{ type: 'QUICK_REPLY', text: 'Interested in demo' },
		],
		exampleBodyParams: ['Alex'],
		presentationUrl: PRESENTATION_EN,
		description: 'Clone of so7ba_fitness_outreach_en as UTILITY',
	},
	{
		key: 'outreach_ar_full',
		name: 'so7ba_fit_util_outreach_ar',
		language: 'ar',
		category: 'UTILITY',
		headerFormat: 'TEXT',
		headerText: 'وقف دقيقة… الرسالة دي ليك',
		bodyText: [
			'أهلاً {{1}} 👋',
			'',
			'لو بتلاحق عملاءك بين واتساب وإكسل وPDF… صدقني، في طريقة أهدى وأوضح بكتير.',
			'',
			'عملت نظام يجمع شغل الجيم والكوتشنج كله في مكان واحد. خلّيني أقولك الست محاور بسرعة:',
			'',
			'1️⃣ التدريب',
			'مكتبة تمارين بصور وفيديو، خطط أسبوعية، تسجيل أوزان وتكرارات، ومؤقت راحة.',
			'',
			'2️⃣ التغذية',
			'خطط وجبات وماكروز ومكملات، بدائل لكل وجبة، وصفات، وتسجيل يومي.',
			'',
			'3️⃣ إدارة العملاء',
			'استبيان بالرابط، ملف كامل بالقياسات والصور، تقارير أسبوعية وملاحظاتك.',
			'',
			'4️⃣ التشغيل اليومي',
			'شات فوري، تذكيرات وإشعارات، تقويم وعادات، وحاسبة سعرات.',
			'',
			'5️⃣ الاشتراكات والفوترة',
			'باقات، اشتراكات، فواتير، وسجل مدفوعات واضح.',
			'',
			'6️⃣ المنصة والهوية',
			'أدوار Admin/Coach/Client، علامتك الخاصة، عربي وإنجليزي، وتطبيق جوال للعميل.',
			'',
			'وكمان واتساب جوه النظام + أدوات ذكاء بسيطة تساعدك تتابع أسرع.',
			'',
			'والأجمل؟ إنت ككوتش بتشوف كل تقدم العميل قدامك: التمرين، التغذية، التقارير، والالتزام.',
			'',
			'لو حابب تشوفها بعينك في ديمو سريع (10 دقايق) — اضغط العرض تحت، أو رد «مهتم» وأنا أكلمك بنفسي ✨',
		].join('\n'),
		footerText: 'للجيمات والمدربين',
		buttons: [
			{ type: 'URL', text: 'عايز أشوف الديمو', url: PRESENTATION_AR },
			{ type: 'QUICK_REPLY', text: 'مهتم — كلمني' },
		],
		exampleBodyParams: ['أحمد'],
		presentationUrl: PRESENTATION_AR,
		description: 'عربي ودّي UTILITY — الست محاور + هوك للديمو',
	},
	{
		key: 'outreach_en_full',
		name: 'so7ba_fit_util_outreach_en',
		language: 'en_US',
		category: 'UTILITY',
		headerFormat: 'TEXT',
		headerText: 'Quick one — this is for you',
		bodyText: [
			'Hey {{1}} 👋',
			'',
			'Still chasing clients across WhatsApp, Excel, and PDFs? There is a calmer way.',
			'',
			'Here are the 6 parts the platform covers:',
			'',
			'1) Training — exercise images/video, weekly plans, log sets/reps/weights, rest timer',
			'2) Nutrition — meals, macros, supplements, alternatives, recipes, daily tracking',
			'3) Clients — intake forms, full profile with measurements/photos, weekly reports + notes',
			'4) Daily ops — chat, reminders & push, calendar & habits, calorie calculator',
			'5) Billing — packages, subscriptions, invoices, payment history',
			'6) Platform — Admin/Coach/Client roles, your brand, Arabic/English, client mobile app',
			'',
			'Plus WhatsApp inbox inside the system and light AI helpers for faster follow-up.',
			'',
			'Best part: as a coach, you see all progress live — workouts, nutrition, reports, adherence.',
			'',
			'Want a quick 10-min demo? Tap below, or reply INTERESTED and I will reach out myself ✨',
		].join('\n'),
		footerText: 'For gyms & coaches',
		buttons: [
			{ type: 'URL', text: 'Show me the demo', url: PRESENTATION_EN },
			{ type: 'QUICK_REPLY', text: 'Interested — call me' },
		],
		exampleBodyParams: ['Alex'],
		presentationUrl: PRESENTATION_EN,
		description: 'Friendly English UTILITY — 6 pillars + strong demo hook',
	},
	{
		key: 'outreach_ar_short',
		name: 'so7ba_fit_util_short_ar',
		language: 'ar',
		category: 'UTILITY',
		headerFormat: 'TEXT',
		headerText: 'رسالة دي ممكن تريّحك جدًا',
		bodyText: [
			'أهلاً {{1}}،',
			'',
			'بسرعة كده: لو شغلك لسه على واتساب وإكسل، في نظام واحد فيه الست حاجات دي:',
			'',
			'• تدريب: صور/فيديو + خطط + سجلات',
			'• تغذية: وجبات وماكروز ووصفات وتتبع',
			'• عملاء: استبيان + ملف كامل + تقارير',
			'• تشغيل يومي: شات وتذكيرات وتقويم',
			'• فوترة: باقات واشتراكات وفواتير',
			'• هوية المنصة: علامتك + عربي/إنجليزي + تطبيق عميل',
			'',
			'وإنت بتشوف كل تقدم عميلك من مكان واحد.',
			'',
			'اضغط وشوف بنفسك… أو رد «مهتم» وأنا أفتح معاك ديمو سريع 🔥',
		].join('\n'),
		footerText: 'ديمو سريع خلال دقايق',
		buttons: [
			{ type: 'URL', text: 'ورّيني الديمو', url: PRESENTATION_AR },
			{ type: 'QUICK_REPLY', text: 'مهتم — كلمني' },
		],
		exampleBodyParams: ['أحمد'],
		presentationUrl: PRESENTATION_AR,
		description: 'عربي قصير UTILITY — الست محاور + ديمو',
	},
	{
		key: 'outreach_en_short',
		name: 'so7ba_fit_util_short_en',
		language: 'en_US',
		category: 'UTILITY',
		headerFormat: 'TEXT',
		headerText: 'This might save you hours',
		bodyText: [
			'Hey {{1}},',
			'',
			'Quick note: if you still run clients on WhatsApp + Excel, one system covers all 6:',
			'',
			'• Training — media, plans, performance logs',
			'• Nutrition — meals, macros, recipes, tracking',
			'• Clients — intake, full profile, weekly reports',
			'• Daily ops — chat, reminders, calendar',
			'• Billing — packages, subscriptions, invoices',
			'• Platform — your brand, bilingual, client app',
			'',
			'You see every client progress update in one place.',
			'',
			'Tap to see it yourself… or reply INTERESTED and I will set a quick demo 🔥',
		].join('\n'),
		footerText: 'Quick demo in minutes',
		buttons: [
			{ type: 'URL', text: 'Show me the demo', url: PRESENTATION_EN },
			{ type: 'QUICK_REPLY', text: 'Interested — call me' },
		],
		exampleBodyParams: ['Alex'],
		presentationUrl: PRESENTATION_EN,
		description: 'Short friendly English UTILITY — 6 pillars + demo pull',
	},
	{
		key: 'demo_schedule_ar',
		name: 'so7ba_demo_schedule_ar',
		language: 'ar',
		category: 'UTILITY',
		headerFormat: 'TEXT',
		headerText: 'تنسيق ميتنج الديمو',
		bodyText: [
			'مرحباً {{1}} 👋',
			'',
			'حابب نرتب ميتنج ديمو سريع لـ So7baFit (حوالي 10 دقايق).',
			'',
			'اختَر ميعاد يناسبك من الأزرار تحت، أو اضغط «هكتب وقت يناسبني» واكتب اليوم والساعة اللي تفضّلها.',
			'',
			'بعد اختيارك هرد عليك فوراً لتأكيد اللينك/الموعد.',
		].join('\n'),
		footerText: 'So7baFit · تنسيق موعد',
		buttons: [
			{ type: 'QUICK_REPLY', text: 'غداً 11 ص' },
			{ type: 'QUICK_REPLY', text: 'غداً 4 م' },
			{ type: 'QUICK_REPLY', text: 'هكتب وقت يناسبني' },
		],
		exampleBodyParams: ['أحمد'],
		presentationUrl: PRESENTATION_AR,
		description: 'UTILITY — فتح المحادثة + اختيار سلوات ديمو أو كتابة وقت حر',
	},
	{
		key: 'demo_schedule_en',
		name: 'so7ba_demo_schedule_en',
		language: 'en_US',
		category: 'UTILITY',
		headerFormat: 'TEXT',
		headerText: 'Schedule your demo',
		bodyText: [
			'Hi {{1}} 👋',
			'',
			'Let’s book a quick So7baFit demo (about 10 minutes).',
			'',
			'Pick a time slot below, or tap “I’ll write my preferred time” and send the day/time that works for you.',
			'',
			'Once you choose, I’ll confirm the meeting right away.',
		].join('\n'),
		footerText: 'So7baFit · Scheduling',
		buttons: [
			{ type: 'QUICK_REPLY', text: 'Tomorrow 11 AM' },
			{ type: 'QUICK_REPLY', text: 'Tomorrow 4 PM' },
			{ type: 'QUICK_REPLY', text: 'I’ll write my preferred time' },
		],
		exampleBodyParams: ['Alex'],
		presentationUrl: PRESENTATION_EN,
		description: 'UTILITY — reopen chat + demo time slots or free-text time',
	},
];

export function getSo7baSeedTemplatePreviews() {
	return SO7BA_META_TEMPLATE_SEEDS.map(t => ({
		...t,
		bodyLength: t.bodyText.length,
		withinMetaBodyLimit: t.bodyText.length <= 1024,
		headerLength: (t.headerText || '').length,
		footerLength: (t.footerText || '').length,
	}));
}
