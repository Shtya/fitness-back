type BaileysModule = typeof import('@whiskeysockets/baileys');

let modulePromise: Promise<BaileysModule> | null = null;

/** Baileys is ESM-only — keep a native dynamic import under Nest CJS. */
const nativeImport = new Function(
	'specifier',
	'return import(specifier);',
) as (specifier: string) => Promise<BaileysModule>;

export const loadBaileysModule = async (): Promise<BaileysModule> => {
	if (!modulePromise) {
		modulePromise = nativeImport('@whiskeysockets/baileys');
	}
	return modulePromise;
};
