import { WhatsAppMediaLibraryController } from './whatsapp-media-library.controller';

describe('WhatsAppMediaLibraryController', () => {
	function createController() {
		const library = {
			listFolders: jest.fn().mockResolvedValue({ folders: [], rootCount: 0 }),
			createFolder: jest.fn().mockResolvedValue({ id: 'folder-1' }),
			renameFolder: jest.fn().mockResolvedValue({ id: 'folder-1' }),
			deleteFolder: jest.fn().mockResolvedValue({ deleted: true }),
			listItems: jest.fn().mockResolvedValue({ items: [] }),
			saveAttachment: jest.fn().mockResolvedValue({ id: 'item-1' }),
			saveVoiceEdit: jest.fn().mockResolvedValue({ id: 'item-2' }),
			updateItem: jest.fn().mockResolvedValue({ id: 'item-1' }),
			deleteItem: jest.fn().mockResolvedValue({ deleted: true }),
			sendItem: jest.fn().mockResolvedValue({ ok: true }),
		};
		return {
			controller: new WhatsAppMediaLibraryController(library as any),
			library,
			req: { user: { id: 'user-1' } },
		};
	}

	it('lists everything when no folder is given', async () => {
		const { controller, library, req } = createController();
		await controller.listItems(req, undefined);
		expect(library.listItems).toHaveBeenCalledWith(req.user);
	});

	it('treats the "root" folder id as unsorted items', async () => {
		const { controller, library, req } = createController();
		await controller.listItems(req, 'root');
		expect(library.listItems).toHaveBeenCalledWith(req.user, null);
	});

	it('passes a real folder id straight through', async () => {
		const { controller, library, req } = createController();
		await controller.listItems(req, 'folder-9');
		expect(library.listItems).toHaveBeenCalledWith(req.user, 'folder-9');
	});

	it('splits voice edit options from the library destination', async () => {
		const { controller, library, req } = createController();
		await controller.saveVoiceEdit(req, {
			attachmentId: 'attachment-1',
			folderId: 'folder-1',
			title: 'Intro clip',
			startSeconds: 10,
			endSeconds: 25,
			noiseReduction: true,
		} as any);

		expect(library.saveVoiceEdit).toHaveBeenCalledWith(
			req.user,
			'attachment-1',
			{ startSeconds: 10, endSeconds: 25, noiseReduction: true },
			{ folderId: 'folder-1', title: 'Intro clip' },
		);
	});

	it('keeps a null folderId so an item can move back to the root', async () => {
		const { controller, library, req } = createController();
		await controller.updateItem(req, 'item-1', { folderId: null } as any);
		expect(library.updateItem).toHaveBeenCalledWith(req.user, 'item-1', { folderId: null });
	});

	it('omits fields the client did not send', async () => {
		const { controller, library, req } = createController();
		await controller.updateItem(req, 'item-1', { title: 'Renamed' } as any);
		expect(library.updateItem).toHaveBeenCalledWith(req.user, 'item-1', { title: 'Renamed' });
	});

	it('forwards the target conversation when re-sending a saved item', async () => {
		const { controller, library, req } = createController();
		await controller.sendItem(req, 'item-1', {
			conversationId: 'conversation-1',
			clientMessageId: 'client-1',
		} as any);
		expect(library.sendItem).toHaveBeenCalledWith(req.user, 'item-1', 'conversation-1', {
			clientMessageId: 'client-1',
		});
	});
});
