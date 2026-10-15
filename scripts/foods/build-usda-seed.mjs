/**
 * Builds migrations/20261016_foods_usda_seed.sql from the USDA FoodData Central
 * "SR Legacy" CSV release (public domain, CC0).
 *
 *   1. Download https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
 *   2. Unzip it, then run:
 *        node scripts/foods/build-usda-seed.mjs <unzipped folder> [--report]
 *
 * Non-halal items (pork, alcohol, gelatin, ...), baby food, US-only restaurant and
 * grocery brands and near-duplicate meat cuts are skipped. Arabic names are composed
 * from the phrase dictionary in ./usda-ar.mjs; foods whose main name has no Arabic
 * entry keep an English name only (still searchable in English).
 * Egyptian dishes and gym staples from ./egyptian-foods.mjs are appended as estimates.
 *
 * --report writes missing-heads / missing-segments / names / dups *.tmp.txt files next to
 * this script to grow the dictionary; delete them afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADS, PHRASES, IGNORE, METHODS, PIECE_LABELS, FEMININE_HEADS, FEMININE, GENERIC_HEADS, OVERRIDES, FOWL_HEADS, FOWL_PARTS } from './usda-ar.mjs';
import { EGYPTIAN_FOODS, SEED_RENAMES } from './egyptian-foods.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = process.argv[2];
const report = process.argv.includes('--report');
if (!srcDir || !fs.existsSync(path.join(srcDir, 'food.csv'))) {
	console.error('Usage: node scripts/foods/build-usda-seed.mjs <SR Legacy CSV folder> [--report]');
	process.exit(1);
}

/* ─────────────── CSV ─────────────── */
function readCsv(file, onRow) {
	const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
	let head = null;
	let row = [];
	let field = '';
	let quoted = false;
	const flush = () => {
		if (!head) head = row;
		else onRow(Object.fromEntries(head.map((h, i) => [h, row[i]])));
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
			} else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') { row.push(field); field = ''; }
		else if (ch === '\n') { row.push(field); flush(); row = []; field = ''; }
		else if (ch !== '\r') field += ch;
	}
	if (field || row.length) { row.push(field); flush(); }
}

/* ─────────────── Filters ─────────────── */
const DROP_CATEGORIES = new Set(['Pork Products', 'Baby Foods', 'American Indian/Alaska Native Foods', 'Restaurant Foods']);
const HARAM = /\b(pork|ham|hams|bacon|lard|wine|beer|alcoholic|liqueur|liquor|champagne|whiskey|whisky|vodka|rum|gin|brandy|sake|cocktail|daiquiri|margarita|pina colada|tequila|pepperoni|bologna|salami|chorizo|prosciutto|pancetta|gelatin|gelatins|blood sausage|bourbon|scotch|creme de menthe|marsala|liverwurst|bratwurst|kielbasa|yachtwurst|braunschweiger|headcheese|knackwurst|mortadella|polish|frankfurter|hot dog|hotdog|sausage|luncheon|pate)\b/i;
const HALAL_PROCESSED = /\b(beef|chicken|turkey)\b/i;
const ODD = /\b(bear|beaver|squirrel|opossum|raccoon|muskrat|whale|seal|walrus|caribou|moose|elk|bison|buffalo|antelope|boar|frog|turtle|snail|dove|squab|emu|ostrich|horse|steelhead|cisco|burbot|eulachon|lungs|spleen|brain|brains|pancreas|thymus|tongue|kidneys|tripe|giblets|feet|chitterlings|mechanically|sweetbread|sweetbreads|ears?|snout|head|grouse|pheasant|guinea hen|school lunch|usda commodity|infant|toddler|incaparina|formula|meat extender)\b/i;
const FAST_FOOD_CHAINS = /\b(mcdonald's|kfc|burger king|pizza hut|domino's|papa john's|little caesars|subway|wendy's|taco bell|popeyes)\b/i;

const BRANDS = /\b(archway|vitasoy|pepperidge farm|digiorno|pillsbury|glutino|udi's|nabisco|van's|oscar mayer|silk|kraft|house foods|keebler|continental mills|mckee|mission foods|martha white|george weston|schar|andrea's|crunchmaster|rudi's|mary's gone|sage valley|interstate brands|heinz|hormel|reddi wip|lean pockets|lebanon bologna|v8 splash|goldfish|real medleys)\b/i;

function isBrand(original) {
	if (BRANDS.test(original)) return true;
	if (FAST_FOOD_CHAINS.test(original)) return false;
	return original.split(/,\s*/).some(seg => {
		const letters = seg.replace(/[^A-Za-z]/g, '');
		return letters.length >= 3 && letters === letters.toUpperCase();
	});
}

function dropReason(cat, d) {
	if (DROP_CATEGORIES.has(cat)) return 'category';
	if (HARAM.test(d)) {
		const processedHalal = /\b(frankfurter|hot dog|sausage|bologna|salami|pepperoni|luncheon)\b/i.test(d) && HALAL_PROCESSED.test(d) && !/\b(pork|ham|bacon)\b/i.test(d);
		if (!processedHalal) return 'non-halal';
	}
	if (ODD.test(d)) return 'uncommon';
	if (isBrand(d)) return 'brand';
	const meat = cat === 'Beef Products' || cat === 'Lamb, Veal, and Game Products';
	if (/separable fat/i.test(d)) return 'duplicate cut';
	if (meat && (/, (select|prime|choice),/.test(d) || /trimmed to 1\/(4|8)" fat/.test(d) || /\bimported\b/i.test(d))) return 'duplicate cut';
	return null;
}

/* ─────────────── Arabic names ─────────────── */
const lower = s => s.toLowerCase().trim();
const rawSegmentsOf = d => d.split(/,\s*|;\s*/).map(s => s.trim()).filter(Boolean);
const segmentsOf = d => rawSegmentsOf(d).map(lower);
const lookup = seg => PHRASES[seg] ?? PHRASES[seg.replace(/\s*\(.*$/, '').trim()];

/** Segments describing preparation state; always kept so raw vs cooked never collapses. */
const STATE = new Set([...METHODS, 'raw', 'cooked', 'canned', 'frozen', 'dried', 'dry', 'uncooked', 'unprepared', 'prepared', 'condensed',
	'prepared with equal volume water', 'prepared with water', 'ready-to-serve', 'dry mix', 'drained', 'drained solids', 'solids and liquids']);

const PRODUCE = new Set(['Fruits and Fruit Juices', 'Vegetables and Vegetable Products']);

function arabicName(d, cat) {
	const override = OVERRIDES[lower(d).replace(/\s+/g, ' ')];
	if (override) return { name: override[0], aliases: override[1], untranslated: [] };
	const segs = segmentsOf(d);
	const original = rawSegmentsOf(d);
	const head = HEADS[segs[0]] ?? HEADS[segs[0].replace(/\s*\(.*$/, '').trim()];
	if (!head) return { name: '', aliases: '', untranslated: [] };
	const [headName, headAliases = ''] = Array.isArray(head) ? head : [head];
	const feminine = FEMININE_HEADS.has(headName);
	const desc = [];
	const state = [];
	const untranslated = [];
	const hasMethod = segs.some(s => METHODS.has(s));
	const fowl = FOWL_HEADS.has(headName);
	let part = '';
	const seen = text => [headName, part, ...desc, ...state].some(p => ` ${p} `.includes(` ${text} `));
	segs.slice(1).forEach((seg, i) => {
		if (IGNORE.has(seg)) return;
		if (seg === 'cooked' && hasMethod) return;
		if (fowl && !part && FOWL_PARTS[seg]) { part = FOWL_PARTS[seg]; return; }
		let ar = seg === 'raw' && PRODUCE.has(cat) ? 'طازج' : lookup(seg);
		if (ar === undefined) {
			const lean = seg.match(/^(\d+)% lean meat \/ \d+% fat$/);
			const fat = seg.match(/^(\d+(?:\.\d+)?)% (?:milkfat|fat)$/);
			if (lean) ar = `${lean[1]}% صافي`;
			else if (fat) ar = `${fat[1]}% دسم`;
			else untranslated.push(original[i + 1]);
		}
		if (!ar) return;
		if (feminine) ar = toFeminine(ar);
		if (seen(ar)) return;
		(STATE.has(seg) ? state : desc).push(ar);
	});
	const dropHead = GENERIC_HEADS.has(headName) && desc.length > 0 && !untranslated.length;
	const name = [...(dropHead ? [] : [part ? `${part} ${headName}` : headName]), ...desc.slice(0, 3), ...state.slice(0, 2)].join(' ');
	const aliases = dropHead ? [headName, headAliases].filter(Boolean).join(' ') : headAliases;
	return { name, aliases, untranslated };
}

function toFeminine(phrase) {
	if (FEMININE[phrase]) return FEMININE[phrase];
	const [first, ...rest] = phrase.split(' ');
	return FEMININE[first] ? [FEMININE[first], ...rest].join(' ') : phrase;
}

/* ─────────────── Categories ─────────────── */
function categoryOf(cat, d) {
	const x = d.toLowerCase();
	if (/\b(protein supplement|protein powder|whey protein|soy protein isolate|formulated bar|meal replacement|energy drink|nutritional supplement)\b/.test(x)) return 'supplements';
	switch (cat) {
		case 'Beef Products':
		case 'Lamb, Veal, and Game Products':
		case 'Poultry Products':
		case 'Sausages and Luncheon Meats': return 'meat';
		case 'Finfish and Shellfish Products': return 'seafood';
		case 'Dairy and Egg Products': return 'dairy';
		case 'Cereal Grains and Pasta': return 'grains';
		case 'Baked Products': return /\b(cake|cookie|cookies|pie|doughnut|doughnuts|pastry|brownie|brownies|muffin|muffins|croissant|danish|sweet rolls|cinnamon|frosting|toaster pastries|strudel|turnover|eclair|cream puff|coffeecake)\b/.test(x) ? 'sweets' : 'grains';
		case 'Breakfast Cereals': return 'breakfast';
		case 'Fruits and Fruit Juices': return /\bjuice|nectar\b/.test(x) ? 'beverages' : 'fruits';
		case 'Vegetables and Vegetable Products': return 'vegetables';
		case 'Legumes and Legume Products': return 'legumes';
		case 'Nut and Seed Products': return 'nuts';
		case 'Fats and Oils': return /dressing|mayonnaise/.test(x) ? 'condiments' : 'fats';
		case 'Sweets':
		case 'Snacks': return 'sweets';
		case 'Beverages': return 'beverages';
		case 'Fast Foods': return 'fast_food';
		case 'Soups, Sauces, and Gravies': return /\bsoup|broth|chowder|bouillon\b/.test(x) ? 'soups' : 'condiments';
		case 'Spices and Herbs': return 'condiments';
		case 'Meals, Entrees, and Side Dishes': return 'international';
		default: return 'other';
	}
}

/* ─────────────── Load ─────────────── */
const categories = {};
readCsv('food_category.csv', r => { categories[r.id] = r.description; });

const foods = new Map();
const dropped = {};
readCsv('food.csv', r => {
	const cat = categories[r.food_category_id];
	const reason = dropReason(cat, r.description);
	if (reason) { dropped[reason] = (dropped[reason] || 0) + 1; return; }
	foods.set(r.fdc_id, { id: r.fdc_id, cat, desc: r.description.trim(), n: {} });
});

const NUTRIENTS = { 1008: 'kcal', 1003: 'protein', 1005: 'carbs', 1004: 'fat', 1079: 'fiber', 2000: 'sugar', 1258: 'saturatedFat', 1093: 'sodiumMg' };
readCsv('food_nutrient.csv', r => {
	const food = foods.get(r.fdc_id);
	const key = NUTRIENTS[r.nutrient_id];
	if (food && key && r.amount !== '') food.n[key] = Number(r.amount);
});

const COUNTABLE = /^(large|medium|small|extra large|jumbo|slice|piece|fruit|whole|egg|breast|drumstick|thigh|wing|leg|fillet|patty|cookie|muffin|bagel|pita|roll|bun|bar|sandwich|item|pancake|waffle|tortilla|biscuit|cracker|doughnut|croissant|bun|loaf|stalk|spear|clove|ear|head|leaf|date|fig|olive|nut|kernel|piece \(.*\)|serving packet|packet|scoop|link|burger|taco|burrito|nugget|strip|tender|cake|pie|cupcake|brownie|stick|cube|wedge)\b/i;
const portions = new Map();
readCsv('food_portion.csv', r => {
	const food = foods.get(r.fdc_id);
	if (!food) return;
	const label = lower(`${r.modifier || ''} ${r.portion_description || ''}`).replace(/\s+/g, ' ').trim();
	const amount = Number(r.amount) || 1;
	const grams = Number(r.gram_weight);
	if (!grams || !COUNTABLE.test(label) || /\b(cup|tbsp|tsp|oz|lb|fl|package|container|can|jar|bottle|pint|quart|gallon)\b/.test(label)) return;
	const rank = /^medium/.test(label) ? 0 : /^large/.test(label) ? 1 : /^(slice|piece|fruit|egg)/.test(label) ? 2 : 3;
	const prev = portions.get(r.fdc_id);
	if (!prev || rank < prev.rank) portions.set(r.fdc_id, { rank, grams: grams / amount, label });
});

/* ─────────────── Build rows ─────────────── */
const round = (v, d = 2) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const rows = [];
const missingHeads = {};
const missingSegs = {};
for (const f of foods.values()) {
	const { kcal, protein, carbs, fat } = f.n;
	if ([kcal, protein, carbs, fat].some(v => v == null)) { dropped['no macros'] = (dropped['no macros'] || 0) + 1; continue; }
	if (protein + carbs + fat > 101) { dropped['bad macros'] = (dropped['bad macros'] || 0) + 1; continue; }
	const ar = arabicName(f.desc, f.cat);
	const segs = segmentsOf(f.desc);
	if (!ar.name) missingHeads[segs[0]] = (missingHeads[segs[0]] || 0) + 1;
	for (const s of segs.slice(1)) if (!IGNORE.has(s) && lookup(s) === undefined) missingSegs[s] = (missingSegs[s] || 0) + 1;
	const piece = portions.get(f.id);
	const pieceKey = piece?.label.split(/[\s,(]/)[0];
	rows.push({
		seedKey: `usda:${f.id}`,
		nameAr: ar.name.slice(0, 200),
		nameEn: f.desc.slice(0, 200),
		aliases: ar.aliases,
		category: categoryOf(f.cat, f.desc),
		baseUnit: f.cat === 'Beverages' || /\b(juice|milk|soymilk|nectar|drink|beverage|oil)\b/i.test(f.desc) && !/\b(powder|dry|dried|chocolate)\b/i.test(f.desc) ? 'ml' : 'g',
		kcal: round(kcal),
		protein: round(protein),
		carbs: round(carbs),
		fat: round(fat),
		fiber: round(f.n.fiber),
		sugar: round(f.n.sugar),
		saturatedFat: round(f.n.saturatedFat),
		sodiumMg: round(f.n.sodiumMg),
		pieceGrams: piece ? round(piece.grams, 1) : null,
		pieceLabelAr: piece ? PIECE_LABELS[pieceKey] || 'قطعة' : null,
		pieceLabelEn: piece ? piece.label.slice(0, 80) : null,
		source: 'usda',
		sourceRef: f.id,
		verified: true,
		untranslated: ar.untranslated,
	});
}

// Foods that would share one Arabic name get their distinguishing English word appended.
const nameCount = {};
for (const r of rows) if (r.nameAr) nameCount[r.nameAr] = (nameCount[r.nameAr] || 0) + 1;
for (const r of rows) {
	if (r.nameAr && nameCount[r.nameAr] > 1 && r.untranslated.length) r.nameAr = `${r.nameAr} (${r.untranslated[0]})`.slice(0, 200);
}

const usdaCount = rows.length;
for (const [key, nameAr, nameEn, aliases, category, baseUnit, protein, carbs, fat, fiber, pieceGrams, pieceAr, pieceEn] of EGYPTIAN_FOODS) {
	rows.push({
		seedKey: `eg:${key}`, nameAr, nameEn, aliases, category, baseUnit,
		kcal: round(protein * 4 + carbs * 4 + fat * 9, 0), protein, carbs, fat, fiber, sugar: null, saturatedFat: null, sodiumMg: null,
		pieceGrams, pieceLabelAr: pieceAr, pieceLabelEn: pieceEn,
		source: 'seed', sourceRef: 'estimate', verified: false, untranslated: [],
	});
}
console.log('egyptian estimates', rows.length - usdaCount);

console.log('kept', rows.length, 'dropped', dropped);
const withAr = rows.filter(r => r.nameAr).length;
console.log(`arabic names ${withAr}/${rows.length} (${((withAr / rows.length) * 100).toFixed(1)}%), with piece weight ${rows.filter(r => r.pieceGrams).length}`);

if (report) {
	const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v}\t${k}`).join('\n');
	fs.writeFileSync(path.join(here, 'missing-heads.tmp.txt'), top(missingHeads, 2000));
	fs.writeFileSync(path.join(here, 'missing-segments.tmp.txt'), top(missingSegs, 3000));
	fs.writeFileSync(path.join(here, 'names.tmp.txt'), rows.map(r => `${r.nameAr}\t|\t${r.nameEn}`).join('\n'));
	const groups = {};
	for (const r of rows) if (r.nameAr) (groups[r.nameAr] ||= []).push(r.nameEn);
	const dups = Object.entries(groups).filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
	console.log('duplicate arabic names', dups.length, 'groups covering', dups.reduce((s, [, v]) => s + v.length, 0), 'rows');
	fs.writeFileSync(path.join(here, 'dups.tmp.txt'), dups.map(([k, v]) => `${v.length}\t${k}\n\t${v.join('\n\t')}`).join('\n'));
	console.log('report written to scripts/foods/missing-*.tmp.txt');
	process.exit(0);
}

/* ─────────────── SQL ─────────────── */
const sql = v => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const COLS = ['seed_key', 'name_ar', 'name_en', 'aliases', 'category', 'base_unit', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'saturated_fat', 'sodium_mg', 'piece_grams', 'piece_label_ar', 'piece_label_en', 'source', 'source_ref', 'verified'];
const values = r => `(${[r.seedKey, r.nameAr, r.nameEn, r.aliases || null, r.category, r.baseUnit, r.kcal, r.protein, r.carbs, r.fat, r.fiber, r.sugar, r.saturatedFat, r.sodiumMg, r.pieceGrams, r.pieceLabelAr, r.pieceLabelEn, r.source, r.sourceRef].map(sql).join(', ')}, ${r.verified ? 'TRUE' : 'FALSE'})`;

const chunks = [];
for (let i = 0; i < rows.length; i += 500) {
	chunks.push(`INSERT INTO foods (${COLS.join(', ')}) VALUES\n${rows.slice(i, i + 500).map(values).join(',\n')}\nON CONFLICT (seed_key) DO NOTHING;`);
}
const renames = SEED_RENAMES.map(([key, from, to]) =>
	`UPDATE foods SET name_ar = ${sql(to)}, aliases = trim(concat_ws(' ', aliases, ${sql(from)}))\n  WHERE seed_key = ${sql(key)} AND name_ar = ${sql(from)};`).join('\n');

const out = `-- Generated by scripts/foods/build-usda-seed.mjs. Do not edit by hand; rerun the script.
-- ${usdaCount} foods from USDA FoodData Central SR Legacy (public domain), seed_key 'usda:<fdc_id>', verified.
-- ${rows.length - usdaCount} Egyptian dishes and gym staples (scripts/foods/egyptian-foods.mjs), seed_key 'eg:<key>',
-- recipe estimates: verified = false, source_ref = 'estimate'.
-- Idempotent: ON CONFLICT (seed_key) DO NOTHING.
-- Requires migrations/20261015_foods_database.sql.
BEGIN;

${chunks.join('\n\n')}

-- Egyptian names for the first seed; skipped for rows an admin already renamed.
${renames}

COMMIT;
`;
const target = path.join(here, '..', '..', 'migrations', '20261016_foods_usda_seed.sql');
fs.writeFileSync(target, out, 'utf8');
console.log('wrote', path.relative(process.cwd(), target), `${(out.length / 1024).toFixed(0)} KB`);
