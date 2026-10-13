import {
	contentDispositionHeader,
	isInternalStorageFileName,
	originalNameFromStorageName,
	resolveOutgoingDisplayFileName,
	sanitizeDisplayFileName,
} from './whatsapp-display-file-name';

describe('whatsapp display file names', () => {
	it('keeps the name the user picked, including Arabic and spaces', () => {
		expect(
			resolveOutgoingDisplayFileName({
				requested: 'تقرير الاشتراك النهائي.docx',
				storagePath: 'outgoing/acc/user/1791833788952-x7k2p9qa.docx',
				type: 'document',
			}),
		).toBe('تقرير الاشتراك النهائي.docx');
	});

	it('never sends the upload storage name', () => {
		expect(
			resolveOutgoingDisplayFileName({
				storagePath: 'outgoing/acc/user/1791833788952-x7k2p9qa.docx',
				type: 'document',
			}),
		).toBe('document.docx');
		expect(isInternalStorageFileName('1791833788952-x7k2p9qa.pdf')).toBe(true);
	});

	it('recovers the original name from the share/forward storage name', () => {
		expect(originalNameFromStorageName('share_1791833788952_b722a5c7_Plan_v2.docx')).toBe('Plan_v2.docx');
		expect(
			resolveOutgoingDisplayFileName({
				requested: 'share_1791833788952_b722a5c7_Plan.xlsx',
				storagePath: 'outgoing/a/u/share_1791833788952_b722a5c7_Plan.xlsx',
			}),
		).toBe('Plan.xlsx');
	});

	it('recovers the original name from the saved-media storage name', () => {
		expect(originalNameFromStorageName('slides-1791833788952-ab12cd.pptx')).toBe('slides.pptx');
	});

	it('keeps ordinary names that only look numeric', () => {
		expect(originalNameFromStorageName('2024-report.pdf')).toBe('2024-report.pdf');
		expect(isInternalStorageFileName('IMG-20261012-WA0001.jpg')).toBe(false);
	});

	it('adds the real extension when the requested name has none', () => {
		expect(
			resolveOutgoingDisplayFileName({ requested: 'Contract', storagePath: 'x/1791833788952-abcdefgh.pdf' }),
		).toBe('Contract.pdf');
	});

	it('strips paths, control and bidi-override characters', () => {
		expect(sanitizeDisplayFileName('C:\\Users\\me\\a.zip')).toBe('a.zip');
		expect(sanitizeDisplayFileName('../../etc/passwd')).toBe('passwd');
		expect(sanitizeDisplayFileName('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
		expect(sanitizeDisplayFileName('   ')).toBeNull();
	});

	it('caps very long names and keeps the extension', () => {
		const long = `${'a'.repeat(400)}.pdf`;
		const out = sanitizeDisplayFileName(long)!;
		expect(out.length).toBe(200);
		expect(out.endsWith('.pdf')).toBe(true);
	});

	it('builds an RFC 6266 header that keeps Unicode names', () => {
		const header = contentDispositionHeader('attachment', 'تقرير "نهائي".pdf');
		expect(header).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
		expect(header).not.toMatch(/filename="[^"]*"[^;]*"/);
		expect(decodeURIComponent(header.split("UTF-8''")[1])).toBe('تقرير "نهائي".pdf');
	});
});
