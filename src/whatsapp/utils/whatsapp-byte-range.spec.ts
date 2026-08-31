import { parseByteRange } from './whatsapp-byte-range';

describe('parseByteRange', () => {
	const SIZE = 1000;

	it('serves the whole body when there is nothing to satisfy', () => {
		expect(parseByteRange('', SIZE)).toBeNull();
		expect(parseByteRange('bytes=-', SIZE)).toBeNull();
		expect(parseByteRange('items=0-10', SIZE)).toBeNull();
		expect(parseByteRange('bytes=abc', SIZE)).toBeNull();
		// Multi-range is allowed to be answered in full rather than as multipart.
		expect(parseByteRange('bytes=0-99,200-299', SIZE)).toBeNull();
		expect(parseByteRange('bytes=0-99', 0)).toBeNull();
	});

	it('parses closed, open and suffix ranges', () => {
		expect(parseByteRange('bytes=0-99', SIZE)).toEqual({ start: 0, end: 99 });
		expect(parseByteRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 });
		expect(parseByteRange('bytes=-100', SIZE)).toEqual({ start: 900, end: 999 });
		expect(parseByteRange(' bytes=10-20 ', SIZE)).toEqual({ start: 10, end: 20 });
	});

	it('answers bytes=0- with a range so Safari keeps seeking enabled', () => {
		expect(parseByteRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 });
	});

	it('clamps an end past the file instead of failing', () => {
		expect(parseByteRange('bytes=900-5000', SIZE)).toEqual({ start: 900, end: 999 });
		expect(parseByteRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 });
	});

	it('reports unsatisfiable ranges for 416', () => {
		expect(parseByteRange('bytes=1000-1100', SIZE)).toBe('unsatisfiable');
		expect(parseByteRange('bytes=800-700', SIZE)).toBe('unsatisfiable');
		expect(parseByteRange('bytes=-0', SIZE)).toBe('unsatisfiable');
	});
});
