import * as path from 'path';
import {
	MAX_LIBRARY_FOLDER_NAME,
	MAX_LIBRARY_ITEM_TITLE,
	defaultItemTitle,
	isSupportedLibraryMediaType,
	libraryFileExtension,
	libraryMediaType,
	libraryStorageRelativePath,
	normalizeFolderName,
	normalizeItemTitle,
	resolveLibraryPathInsideRoot,
} from './whatsapp-media-library';

describe('libraryMediaType', () => {
	it('maps push-to-talk and voice onto the voice send type', () => {
		expect(libraryMediaType('ptt')).toBe('voice');
		expect(libraryMediaType('voice')).toBe('voice');
		expect(libraryMediaType('PTT')).toBe('voice');
	});

	it('passes other supported types through', () => {
		expect(libraryMediaType('image')).toBe('image');
		expect(libraryMediaType('video')).toBe('video');
		expect(libraryMediaType('document')).toBe('document');
		expect(libraryMediaType('audio')).toBe('audio');
	});

	it('rejects anything else', () => {
		expect(libraryMediaType('location')).toBeNull();
		expect(libraryMediaType('')).toBeNull();
		expect(libraryMediaType(null)).toBeNull();
		expect(isSupportedLibraryMediaType('contact')).toBe(false);
		expect(isSupportedLibraryMediaType('sticker')).toBe(true);
	});
});

describe('name normalisation', () => {
	it('collapses whitespace and trims', () => {
		expect(normalizeFolderName('  Converted   Voices \n')).toBe('Converted Voices');
		expect(normalizeItemTitle('  my \t clip ')).toBe('my clip');
	});

	it('caps length', () => {
		expect(normalizeFolderName('x'.repeat(400))).toHaveLength(MAX_LIBRARY_FOLDER_NAME);
		expect(normalizeItemTitle('y'.repeat(400))).toHaveLength(MAX_LIBRARY_ITEM_TITLE);
	});

	it('falls back when the title is empty', () => {
		expect(normalizeItemTitle('   ')).toBe('Saved media');
		expect(normalizeItemTitle(null, 'Clip')).toBe('Clip');
		expect(normalizeFolderName(null)).toBe('');
	});
});

describe('defaultItemTitle', () => {
	it('prefers the original file name without its extension', () => {
		expect(defaultItemTitle('video', 'holiday clip.mp4')).toBe('holiday clip');
	});

	it('describes a voice note by length when there is no name', () => {
		expect(defaultItemTitle('voice', null, 95)).toBe('Voice note 1:35');
		expect(defaultItemTitle('voice', '', 8)).toBe('Voice note 0:08');
	});

	it('falls back to the capitalised type', () => {
		expect(defaultItemTitle('image', null, null)).toBe('Image');
	});
});

describe('libraryFileExtension', () => {
	it('uses the original extension when it looks sane', () => {
		expect(libraryFileExtension('note.OGG', 'audio/ogg')).toBe('.ogg');
	});

	it('derives from the MIME type otherwise', () => {
		expect(libraryFileExtension(null, 'image/png')).toBe('.png');
		expect(libraryFileExtension(null, 'audio/ogg; codecs=opus')).toBe('.ogg');
		expect(libraryFileExtension(null, 'video/quicktime')).toBe('.mov');
	});

	it('keeps audio/mpeg playable as mp3 rather than mpeg', () => {
		expect(libraryFileExtension(null, 'audio/mpeg', 'audio')).toBe('.mp3');
		expect(libraryFileExtension(null, 'video/mpeg', 'video')).toBe('.mpeg');
	});

	it('falls back per media type when nothing is usable', () => {
		expect(libraryFileExtension(null, 'application/octet-stream', 'voice')).toBe('.ogg');
		expect(libraryFileExtension(null, null, 'document')).toBe('.bin');
	});
});

describe('libraryStorageRelativePath', () => {
	it('namespaces per user and is unique per call', () => {
		const built = libraryStorageRelativePath('user-1', 'voice', '.ogg', 1000, 'abc123');
		expect(built).toBe('library/user-1/voice-1000-abc123.ogg');
	});

	it('strips anything that could climb out of the folder', () => {
		const built = libraryStorageRelativePath('../../etc', 'vo/ice', 'ogg', 5, 'r');
		expect(built).toBe('library/etc/voice-5-r.ogg');
		expect(built).not.toContain('..');
	});
});

describe('resolveLibraryPathInsideRoot', () => {
	const root = path.resolve('/srv/media');

	it('resolves a normal relative path', () => {
		expect(resolveLibraryPathInsideRoot(root, 'library/user-1/voice-1.ogg')).toBe(
			path.resolve(root, 'library/user-1/voice-1.ogg'),
		);
	});

	it('accepts backslash separators from Windows rows', () => {
		expect(resolveLibraryPathInsideRoot(root, 'library\\user-1\\a.ogg')).toBe(
			path.resolve(root, 'library/user-1/a.ogg'),
		);
	});

	it('refuses traversal, absolute paths and empty values', () => {
		expect(resolveLibraryPathInsideRoot(root, '../../etc/passwd')).toBeNull();
		expect(resolveLibraryPathInsideRoot(root, 'library/../../secret')).toBeNull();
		expect(resolveLibraryPathInsideRoot(root, '/etc/passwd')).toBeNull();
		expect(resolveLibraryPathInsideRoot(root, '')).toBeNull();
	});
});
