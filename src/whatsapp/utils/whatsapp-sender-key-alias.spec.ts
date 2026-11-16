import {
	alternateSenderKeyIds,
	buildSenderKeyId,
	parseSenderKeyId,
	withSenderKeyAliases,
} from './whatsapp-sender-key-alias';

const PN = '201001234567';
const LID = '128050339573779';

/** In-memory Baileys-style key store: { [type]: { [id]: value } }. */
function memoryStore(initial: Record<string, Record<string, any>> = {}) {
	const data: Record<string, Record<string, any>> = JSON.parse(JSON.stringify(initial));
	return {
		data,
		get: jest.fn(async (type: string, ids: string[]) => {
			const out: Record<string, any> = {};
			for (const id of ids) if (data[type]?.[id] != null) out[id] = data[type][id];
			return out;
		}),
		set: jest.fn(async (patch: Record<string, Record<string, any>>) => {
			for (const [type, values] of Object.entries(patch)) {
				data[type] = data[type] || {};
				for (const [id, value] of Object.entries(values)) {
					if (value == null) delete data[type][id];
					else data[type][id] = value;
				}
			}
		}),
	};
}

const mapping = { 'lid-mapping': { [PN]: LID, [`${LID}_reverse`]: PN } };

describe('sender key ids', () => {
	it('parses phone, LID and hosted addresses', () => {
		expect(parseSenderKeyId(`status@broadcast::${PN}::0`)).toEqual({ group: 'status@broadcast', user: PN, domain: 0, device: '0' });
		expect(parseSenderKeyId(`status@broadcast::${LID}_1::3`)).toEqual({ group: 'status@broadcast', user: LID, domain: 1, device: '3' });
		expect(parseSenderKeyId('120363@g.us::99_129::0')?.domain).toBe(129);
		expect(parseSenderKeyId('not-a-key')).toBeNull();
		expect(buildSenderKeyId({ group: 'g', user: '5', domain: 1, device: '2' })).toBe('g::5_1::2');
	});

	it('maps each address to the other one through lid-mapping', async () => {
		const store = memoryStore(mapping);
		const read = (k: string[]) => store.get('lid-mapping', k);
		const alt = await alternateSenderKeyIds([`status@broadcast::${PN}::0`, `status@broadcast::${LID}_1::2`, 'status@broadcast::999::0'], read);
		expect(alt.get(`status@broadcast::${PN}::0`)).toBe(`status@broadcast::${LID}_1::0`);
		expect(alt.get(`status@broadcast::${LID}_1::2`)).toBe(`status@broadcast::${PN}::2`);
		expect(alt.has('status@broadcast::999::0')).toBe(false); // no mapping known
	});
});

describe('withSenderKeyAliases', () => {
	it('finds a story key stored under the phone number when the story arrives under the LID', async () => {
		const store = memoryStore({ ...mapping, 'sender-key': { [`status@broadcast::${PN}::0`]: 'KEY' } });
		const onFallback = jest.fn();
		const keys = withSenderKeyAliases(store as any, onFallback);
		const got = await keys.get('sender-key', [`status@broadcast::${LID}_1::0`]);
		expect(got[`status@broadcast::${LID}_1::0`]).toBe('KEY');
		expect(onFallback).toHaveBeenCalledWith(`status@broadcast::${LID}_1::0`, `status@broadcast::${PN}::0`);
	});

	it('and the other way round', async () => {
		const store = memoryStore({ ...mapping, 'sender-key': { [`status@broadcast::${LID}_1::0`]: 'KEY' } });
		const keys = withSenderKeyAliases(store as any);
		expect((await keys.get('sender-key', [`status@broadcast::${PN}::0`]))[`status@broadcast::${PN}::0`]).toBe('KEY');
	});

	it('writes a sender key under both addresses so they stay in step', async () => {
		const store = memoryStore(mapping);
		const keys = withSenderKeyAliases(store as any);
		await keys.set({ 'sender-key': { [`status@broadcast::${LID}_1::0`]: 'NEW' } });
		expect(store.data['sender-key'][`status@broadcast::${LID}_1::0`]).toBe('NEW');
		expect(store.data['sender-key'][`status@broadcast::${PN}::0`]).toBe('NEW');
	});

	it('leaves other key types and unknown people alone', async () => {
		const store = memoryStore({ session: { a: 1 } });
		const keys = withSenderKeyAliases(store as any);
		expect(await keys.get('session', ['a'])).toEqual({ a: 1 });
		expect(await keys.get('sender-key', ['status@broadcast::555::0'])).toEqual({});
		await keys.set({ 'sender-key': { 'status@broadcast::555::0': 'X' } });
		expect(Object.keys(store.data['sender-key'])).toEqual(['status@broadcast::555::0']);
	});
});
