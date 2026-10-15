import type { AgentDialect, AgentReplyLength, AgentTone, KnowledgeCategory } from './ai-agent.entities';

/**
 * Recommended starting setup for a So7baFit coaching/gym WhatsApp line.
 * Owners edit any of it later; prices and offers stay in the knowledge base.
 */
export interface RecommendedAgentSettings {
	agentName: string;
	businessName: string;
	persona: string;
	dialect: AgentDialect;
	tone: AgentTone;
	replyLength: AgentReplyLength;
	rules: string;
	allowedTopics: string[];
	forbiddenTopics: string[];
	handoffKeywords: string[];
	handoffMessage: string;
	discloseAi: boolean;
	knowledgeOnly: boolean;
	useKnowledgeBase: boolean;
}

/** Text/list fields that may be filled in when the owner left them empty. */
export const FILLABLE_AGENT_FIELDS = [
	'agentName',
	'businessName',
	'persona',
	'rules',
	'allowedTopics',
	'forbiddenTopics',
	'handoffKeywords',
	'handoffMessage',
] as const;

function cleanBusinessName(label: string | null | undefined) {
	const value = String(label || '').trim();
	if (!value || /^(main|default|account|whatsapp|wa)\s*\d*$/i.test(value)) return 'So7baFit';
	return value.slice(0, 120);
}

export function recommendedAgentSettings(context: { accountLabel?: string | null }): RecommendedAgentSettings {
	const business = cleanBusinessName(context.accountLabel);
	return {
		agentName: `فريق ${business}`.slice(0, 80),
		businessName: business,
		persona: [
			`بترد على رسايل واتساب لـ ${business}، بيزنس تدريب ولياقة (تدريب أونلاين وجيم).`,
			'بتساعد الناس في: الاشتراك والباقات، خطط التمارين، خطط الأكل والسعرات، المتابعة الأسبوعية، واستخدام التطبيق.',
			'أسلوبك قريب وودود زي حد من الفريق بيكلم العميل على واتساب، بالعامية المصرية، من غير رسميات ولا كلام محفوظ.',
		].join(' '),
		dialect: 'egyptian',
		tone: 'friendly',
		replyLength: 'short',
		rules: [
			'اكتب بالعامية المصرية وبجمل قصيرة زي أي شات واتساب عادي، وإيموجي واحد بالكتير لو مناسب.',
			'المهم الأول: افهم هدف العميل (تخسيس، تضخيم، لياقة عامة) وده أهم سؤال قبل أي حاجة.',
			'اسأل سؤال واحد بس في كل رسالة، ما ترميش أسئلة كتير مرة واحدة.',
			'الأسعار والعروض والمواعيد من قاعدة المعرفة بس. لو مش موجودة قول إنك هتتأكد من الكوتش وترجعله.',
			'لو العميل عايز يشترك: خد اسمه وهدفه ووزنه وطوله ووقت يناسبه للتواصل، وبعدين حوّل للفريق.',
			'ما تديش تشخيص طبي ولا أدوية ولا جرعات مكملات. لو فيه إصابة أو مرض قوله يكلم دكتور وحوّل للكوتش.',
			'ما تكررش نفس الرد، وما تشرحش كتير إلا لو العميل طلب تفاصيل.',
			'مش مهم ترد بكلام كتير على السلام أو إيموجي لوحده: كلمة لطيفة كفاية أو ما تردش.',
			'ما تستخدمش جمل زي "بصفتي مساعد ذكي" أو "كنموذج لغوي" أو "بكل سرور أساعدك".',
		].join('\n'),
		allowedTopics: [
			'الاشتراك والباقات',
			'خطط التمارين',
			'خطط الأكل والسعرات',
			'المتابعة الأسبوعية والقياسات',
			'التطبيق وطريقة استخدامه',
			'التواصل مع الكوتش والمواعيد',
		],
		forbiddenTopics: ['منشطات', 'هرمونات', 'تشخيص طبي', 'روشتة'],
		handoffKeywords: ['اكلم الكوتش', 'عايز اكلم حد', 'شكوى', 'استرجاع', 'refund'],
		handoffMessage: 'تمام، هخلي حد من الفريق يكلمك حالًا 🙏',
		discloseAi: false,
		knowledgeOnly: true,
		useKnowledgeBase: true,
	};
}

export interface StarterKnowledgeEntry {
	category: KnowledgeCategory;
	title: string;
	content: string;
	tags: string[];
}

/** Starter entries built from what the platform delivers to coaching clients. No prices. */
export function starterKnowledge(context: { accountLabel?: string | null }): StarterKnowledgeEntry[] {
	const business = cleanBusinessName(context.accountLabel);
	return [
		{
			category: 'service',
			title: 'خطط التمارين',
			content:
				'بنعمل خطة تمارين أسبوعية مخصوصة حسب هدفك ومستواك والأدوات اللي عندك (جيم أو بيت). الخطة بتوصلك على التطبيق بفيديوهات لكل تمرين، وبتسجل فيها الأوزان والتكرارات وأرقامك القياسية.',
			tags: ['تمارين', 'جيم', 'خطة'],
		},
		{
			category: 'service',
			title: 'خطط الأكل والسعرات',
			content:
				'خطة أكل بالسعرات والماكروز حسب هدفك، فيها بدائل لكل وجبة ووصفات بالقيم الغذائية، وبتسجل التزامك اليومي في التطبيق.',
			tags: ['دايت', 'تغذية', 'سعرات', 'اكل'],
		},
		{
			category: 'service',
			title: 'المتابعة الأسبوعية',
			content:
				'كل أسبوع بتبعت تقرير (الوزن، القياسات، الصور، ومدى التزامك)، والكوتش بيراجعه ويعدل الخطة لو محتاج.',
			tags: ['متابعة', 'تقرير', 'قياسات'],
		},
		{
			category: 'service',
			title: 'التطبيق',
			content:
				'فيه تطبيق ويب وموبايل بتلاقي فيه خطتك اليومية للتمارين والأكل، والتذكيرات، وشات مباشر مع الكوتش.',
			tags: ['تطبيق', 'ابلكيشن', 'app'],
		},
		{
			category: 'faq',
			title: 'إزاي أشترك؟',
			content:
				`بتملا استبيان قصير (هدفك، وزنك، طولك، سنك، وأي إصابات)، وبعدها حد من فريق ${business} بيتواصل معاك يأكد الباقة وطريقة الدفع ويبدأ معاك.`,
			tags: ['اشتراك', 'ابدأ', 'تسجيل'],
		},
		{
			category: 'price',
			title: 'الأسعار والباقات',
			content:
				'الأسعار بيأكدها الفريق مباشرة حسب الباقة ومدة الاشتراك. اسأل العميل عن هدفه والمدة اللي عايزها وحوّله للفريق. (عدّل المدخل ده وحط أسعارك الحقيقية عشان الوكيل يقدر يرد بيها.)',
			tags: ['سعر', 'اسعار', 'باقات', 'كام'],
		},
		{
			category: 'policy',
			title: 'الإصابات والحالات الصحية',
			content:
				'لو عندك إصابة أو مرض مزمن لازم تبلغ الكوتش قبل البداية عشان الخطة تتظبط عليها. إحنا مش بنقدم تشخيص طبي، ولازم استشارة دكتور في الحالات دي.',
			tags: ['اصابه', 'مرض', 'صحه'],
		},
	];
}
