/** Build a rich learning roadmap from roadmap.sh official graph JSON. */

type AnyNode = {
	id?: string;
	type?: string;
	position?: { x?: number; y?: number };
	width?: number;
	height?: number;
	measured?: { width?: number; height?: number };
	data?: {
		label?: string;
		style?: Record<string, any>;
	};
	style?: Record<string, any>;
};

type AnyEdge = {
	id?: string;
	source?: string;
	target?: string;
	data?: { edgeStyle?: string };
	style?: Record<string, any>;
};

export type OfficialTopicDetail = {
	nodeId: string;
	description?: string;
	resources?: Array<{ type?: string; title?: string; url?: string; _id?: string }>;
	lessonPacks?: Array<{
		_id?: string;
		title?: string;
		slug?: string;
		description?: string;
		readingTime?: number;
		lessonCount?: number;
		quizCount?: number;
		projectCount?: number;
		lessonIds?: string[];
		projectIds?: string[];
	}>;
};

function labelOf(node: AnyNode): string {
	return String(node?.data?.label || '').trim();
}

function titleOf(data: Record<string, any>): string {
	const raw = data?.title;
	if (typeof raw === 'string') {
		const value = raw.trim();
		if (value && value !== '[object Object]') return value;
	}
	if (raw && typeof raw === 'object') {
		const nested = String(raw.page || raw.card || raw.title || '').trim();
		if (nested && nested !== '[object Object]') return nested;
	}
	return String(data?.slug || 'Imported roadmap');
}

function textOf(value: unknown): string {
	if (typeof value === 'string') {
		return value.replace(/@currentYear@/g, String(new Date().getFullYear())).trim();
	}
	if (value && typeof value === 'object') {
		const nested = (value as any).page || (value as any).card || (value as any).title || '';
		return textOf(nested);
	}
	return '';
}

function sizeOf(node: AnyNode) {
	return {
		w: Number(node.width || node.measured?.width || node.style?.width || 180),
		h: Number(node.height || node.measured?.height || node.style?.height || 44),
	};
}

function minutesFor(type: string) {
	if (type === 'topic') return 60;
	if (type === 'subtopic') return 30;
	return 25;
}

function stripMarkdownNoise(text: string) {
	return String(text || '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/[*_~>#-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function extractKeywords(title: string, markdown: string) {
	const headings = Array.from(String(markdown || '').matchAll(/^#{1,3}\s+(.+)$/gm)).map(match =>
		stripMarkdownNoise(match[1]),
	);
	const fromTitle = stripMarkdownNoise(title)
		.split(/[\s,/|]+/)
		.filter(token => token.length > 2);
	const candidates = [...headings, ...fromTitle]
		.flatMap(item => item.split(/[\s,/|]+/))
		.map(token => token.replace(/[^a-zA-Z0-9\u0600-\u06ff+-]/g, ''))
		.filter(token => token.length > 2 && !/^(the|and|for|with|from|that|this|into|your|are|how|what)$/i.test(token));

	const seen = new Set<string>();
	const out: string[] = [];
	for (const token of candidates) {
		const key = token.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(token);
		if (out.length >= 12) break;
	}
	return out;
}

function extractTakeaways(markdown: string) {
	const bullets = Array.from(String(markdown || '').matchAll(/^\s*[-*•]\s+(.+)$/gm))
		.map(match => stripMarkdownNoise(match[1]))
		.filter(item => item.length > 12)
		.slice(0, 8);
	if (bullets.length) return bullets;

	const sentences = stripMarkdownNoise(markdown)
		.split(/(?<=[.!?])\s+/)
		.map(item => item.trim())
		.filter(item => item.length > 40)
		.slice(0, 4);
	return sentences;
}

function enrichTopicContent(title: string, detail?: OfficialTopicDetail | null) {
	const markdown = String(detail?.description || '').trim();
	const resources = Array.isArray(detail?.resources)
		? detail!.resources
				.filter(item => item?.url && item?.title)
				.map(item => ({
					id: String(item._id || item.url),
					title: String(item.title),
					url: String(item.url),
					type: String(item.type || 'article').toLowerCase(),
					source: 'roadmap.sh',
				}))
		: [];

	const videos = resources.filter(item =>
		['video', 'youtube', 'course'].includes(item.type) ||
		/youtube\.com|youtu\.be|vimeo\.com/i.test(item.url),
	);
	const articles = resources.filter(item => !videos.some(video => video.url === item.url));
	const primaryVideoUrl = videos[0]?.url || '';
	const keywords = extractKeywords(title, markdown);
	const takeaways = extractTakeaways(markdown);
	const lessonPacks = Array.isArray(detail?.lessonPacks)
		? detail!.lessonPacks
				.filter(pack => pack?.title)
				.map(pack => ({
					id: String(pack._id || pack.slug || pack.title),
					title: String(pack.title),
					slug: String(pack.slug || ''),
					description: String(pack.description || '').trim(),
					readingTime: Number(pack.readingTime) || 0,
					lessonCount: Number(pack.lessonCount) || 0,
					quizCount: Number(pack.quizCount) || 0,
					projectCount: Number(pack.projectCount) || 0,
					url: pack.slug ? `https://roadmap.sh/courses/${pack.slug}` : '',
				}))
		: [];

	const studySuggestions = [
		primaryVideoUrl
			? {
					id: 'watch-primary',
					type: 'video',
					title: videos[0]?.title || 'Watch intro video',
					url: primaryVideoUrl,
				}
			: null,
		keywords[0]
			? {
					id: 'yt-search',
					type: 'search',
					title: `YouTube: ${keywords.slice(0, 3).join(' ')}`,
					url: `https://www.youtube.com/results?search_query=${encodeURIComponent(
						`${title} ${keywords.slice(0, 3).join(' ')} tutorial`,
					)}`,
				}
			: null,
		keywords[0]
			? {
					id: 'web-search',
					type: 'search',
					title: `Search docs: ${title}`,
					url: `https://www.google.com/search?q=${encodeURIComponent(`${title} documentation guide`)}`,
				}
			: null,
		...lessonPacks.slice(0, 2).map(pack => ({
			id: `pack-${pack.id}`,
			type: 'course',
			title: pack.title,
			url: pack.url || `https://www.google.com/search?q=${encodeURIComponent(pack.title)}`,
		})),
	].filter(Boolean);

	const description = markdown
		? stripMarkdownNoise(markdown).slice(0, 420)
		: '';

	return {
		description,
		contentMarkdown: markdown,
		primaryVideoUrl,
		resources: [...videos, ...articles],
		videoSuggestions: videos,
		keywords,
		tags: keywords.slice(0, 8),
		takeaways,
		examples: takeaways.slice(0, 3),
		lessonPacks,
		studySuggestions,
	};
}

export function simplifyOfficialGraph(data: Record<string, any>) {
	const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
	const edges = Array.isArray(data?.edges) ? data.edges : [];

	const keepTypes = new Set([
		'topic',
		'subtopic',
		'label',
		'title',
		'paragraph',
		'button',
		'section',
		'horizontal',
		'vertical',
	]);

	return {
		slug: String(data?.slug || ''),
		title: titleOf(data),
		description: textOf(data?.description),
		dimensions: data?.dimensions || null,
		relatedRoadmaps: Array.isArray(data?.relatedRoadmaps) ? data.relatedRoadmaps : [],
		nodes: nodes
			.filter((node: AnyNode) => keepTypes.has(String(node.type || '')))
			.map((node: AnyNode) => {
				const { w, h } = sizeOf(node);
				return {
					id: String(node.id),
					type: String(node.type || 'topic'),
					label: labelOf(node),
					x: Number(node.position?.x || 0),
					y: Number(node.position?.y || 0),
					width: w,
					height: h,
				};
			}),
		edges: edges.map((edge: AnyEdge) => ({
			id: String(edge.id || `${edge.source}-${edge.target}`),
			source: String(edge.source || ''),
			target: String(edge.target || ''),
			edgeStyle: edge.data?.edgeStyle || 'solid',
		})),
	};
}

export function buildRoadmapFromOfficialGraph(
	data: Record<string, any>,
	detailsByNodeId: Map<string, OfficialTopicDetail> = new Map(),
) {
	const nodes: AnyNode[] = Array.isArray(data?.nodes) ? data.nodes : [];
	const edges: AnyEdge[] = Array.isArray(data?.edges) ? data.edges : [];
	const byId = new Map(nodes.map(node => [String(node.id), node]));

	const mainTopics = nodes
		.filter(node => node.type === 'topic' && labelOf(node))
		.sort((a, b) => Number(a.position?.y || 0) - Number(b.position?.y || 0));

	const subtopics = nodes.filter(node => node.type === 'subtopic' && labelOf(node));
	const labels = nodes.filter(node => node.type === 'label' && labelOf(node));

	const linkedChildren = new Map<string, string[]>();
	for (const edge of edges) {
		const source = String(edge.source || '');
		const target = String(edge.target || '');
		if (!source || !target) continue;
		if (!linkedChildren.has(source)) linkedChildren.set(source, []);
		linkedChildren.get(source)!.push(target);
		if (!linkedChildren.has(target)) linkedChildren.set(target, []);
		linkedChildren.get(target)!.push(source);
	}

	const claimed = new Set<string>();

	const makeTopicRow = (node: AnyNode, fallbackMinutes?: number) => {
		const detail = detailsByNodeId.get(String(node.id));
		const title = labelOf(node);
		const enriched = enrichTopicContent(title, detail);
		const type = String(node.type || 'subtopic');
		const packMinutes = enriched.lessonPacks.reduce(
			(sum, pack) => sum + (Number(pack.readingTime) || 0),
			0,
		);
		return {
			title,
			...enriched,
			estimatedMinutes: fallbackMinutes || packMinutes || minutesFor(type),
			difficulty: type === 'topic' ? 'intermediate' : 'beginner',
			sourceNodeId: String(node.id),
			nodeType: type,
			references: [],
		};
	};

	const sections = mainTopics.map((topic, index) => {
		const y0 = Number(topic.position?.y || 0) - 120;
		const nextY = mainTopics[index + 1]
			? Number(mainTopics[index + 1].position?.y || 0) - 40
			: Number.POSITIVE_INFINITY;

		const linked = (linkedChildren.get(String(topic.id)) || [])
			.map(id => byId.get(id))
			.filter((node): node is AnyNode => Boolean(node && labelOf(node)))
			.filter(node => node.type === 'subtopic' || node.type === 'topic');

		const spatial = subtopics.filter(node => {
			const y = Number(node.position?.y || 0);
			return y >= y0 && y < nextY;
		});

		const bandLabels = labels.filter(node => {
			const y = Number(node.position?.y || 0);
			return y >= y0 && y < nextY;
		});

		const childMap = new Map<string, AnyNode>();
		for (const node of [...linked, ...spatial]) {
			if (String(node.id) === String(topic.id)) continue;
			childMap.set(String(node.id), node);
		}

		const children = [...childMap.values()]
			.sort((a, b) => Number(a.position?.y || 0) - Number(b.position?.y || 0))
			.filter(node => {
				const id = String(node.id);
				if (claimed.has(id)) return false;
				claimed.add(id);
				return true;
			});

		const groupHints = bandLabels
			.sort((a, b) => Number(a.position?.y || 0) - Number(b.position?.y || 0))
			.map(labelOf)
			.filter(Boolean);

		const base = makeTopicRow(topic, 75);
		const moduleDescription = [
			base.contentMarkdown || base.description,
			groupHints.length ? `\n\n### Related groups\n\n${groupHints.map(item => `- ${item}`).join('\n')}` : '',
		]
			.filter(Boolean)
			.join('');

		const topics = [
			{
				...base,
				description: stripMarkdownNoise(moduleDescription).slice(0, 420) || base.description,
				contentMarkdown: moduleDescription || base.contentMarkdown,
			},
			...children.map(node => makeTopicRow(node)),
		];

		const estimatedMinutes = topics.reduce(
			(sum, row) => sum + (Number(row.estimatedMinutes) || 0),
			0,
		);

		return {
			title: labelOf(topic),
			sourceNodeId: String(topic.id),
			estimatedMinutes,
			estimatedHours: Math.max(0.5, Math.round((estimatedMinutes / 60) * 10) / 10),
			groupLabels: groupHints,
			topics,
		};
	});

	const leftover = subtopics.filter(node => !claimed.has(String(node.id)));
	if (leftover.length) {
		sections.push({
			title: 'More topics',
			sourceNodeId: '',
			estimatedMinutes: leftover.length * 30,
			estimatedHours: Math.max(0.5, Math.round((leftover.length * 30) / 60 * 10) / 10),
			groupLabels: [],
			topics: leftover
				.sort((a, b) => Number(a.position?.y || 0) - Number(b.position?.y || 0))
				.map(node => makeTopicRow(node)),
		});
	}

	const allTopics = sections.flatMap(section => section.topics);
	const estimatedHours = Math.max(
		1,
		Math.ceil(allTopics.reduce((sum, topic) => sum + (Number(topic.estimatedMinutes) || 0), 0) / 60),
	);

	return {
		title: titleOf(data),
		description: textOf(data?.description),
		category: 'Roadmap',
		difficulty: 'intermediate',
		estimatedHours,
		tags: [String(data?.slug || 'roadmap')].filter(Boolean),
		sections,
		graph: simplifyOfficialGraph(data),
		importSource: 'official',
	};
}
