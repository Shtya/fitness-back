import { resolveOutgoingUploadMime } from './whatsapp-conversations.controller';

describe('which files can be sent from the composer', () => {
	it('sends a zip from Windows (application/x-zip-compressed) as a zip document', () => {
		expect(resolveOutgoingUploadMime('application/x-zip-compressed', 'RouterManager-to-send.zip')).toBe(
			'application/zip',
		);
		expect(resolveOutgoingUploadMime('application/zip', 'a.zip')).toBe('application/zip');
	});

	it('works out the type from the extension when the browser gives none', () => {
		expect(resolveOutgoingUploadMime('', 'archive.rar')).toBe('application/vnd.rar');
		expect(resolveOutgoingUploadMime('application/octet-stream', 'notes.txt')).toBe('text/plain');
		expect(resolveOutgoingUploadMime('application/octet-stream', 'app.apk')).toBe(
			'application/vnd.android.package-archive',
		);
		// unknown extension: still a document, like WhatsApp
		expect(resolveOutgoingUploadMime('', 'backup.bin')).toBe('application/octet-stream');
	});

	it('keeps images, video, voice and office files as before', () => {
		expect(resolveOutgoingUploadMime('image/jpeg', 'a.jpg')).toBe('image/jpeg');
		expect(resolveOutgoingUploadMime('audio/ogg; codecs=opus', 'voice-3s.ogg')).toBe('audio/ogg;codecs=opus');
		expect(resolveOutgoingUploadMime('application/vnd.ms-powerpoint', 'deck.ppt')).toBe(
			'application/vnd.ms-powerpoint',
		);
		expect(resolveOutgoingUploadMime('text/csv', 'list.csv')).toBe('text/csv');
	});

	it('refuses files a browser would run as a page from our domain', () => {
		expect(resolveOutgoingUploadMime('text/html', 'page.html')).toBeNull();
		expect(resolveOutgoingUploadMime('image/svg+xml', 'logo.svg')).toBeNull();
		expect(resolveOutgoingUploadMime('application/xhtml+xml', 'x.xhtml')).toBeNull();
		expect(resolveOutgoingUploadMime('application/octet-stream', 'evil.html')).toBeNull();
		expect(resolveOutgoingUploadMime('', 'script.js')).toBeNull();
	});
});
