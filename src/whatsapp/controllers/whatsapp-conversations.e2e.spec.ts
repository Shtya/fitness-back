import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { WhatsAppConversationsController } from './whatsapp-conversations.controller';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppMessageGroupsService } from '../services/whatsapp-message-groups.service';
import { WhatsAppSyncService } from '../services/whatsapp-sync.service';
import { WhatsAppVoiceEditorService } from '../services/whatsapp-voice-editor.service';

describe('WhatsApp conversations API (isolated HTTP integration)', () => {
	let app: INestApplication;
	const sync = {
		listConversations: jest.fn(),
		sendText: jest.fn(),
		sendMedia: jest.fn(),
	};
	const voiceEditor = {
		describeSource: jest.fn(),
		render: jest.fn(),
		send: jest.fn(),
	};

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			controllers: [WhatsAppConversationsController],
			providers: [
				{ provide: WhatsAppSyncService, useValue: sync },
				{
					provide: WhatsAppAccessService,
					useValue: { assertAccountPermission: jest.fn() },
				},
				{
					provide: WhatsAppMessageGroupsService,
					useValue: {
						listGroups: jest.fn(),
						createGroup: jest.fn(),
						renameGroup: jest.fn(),
						deleteGroup: jest.fn(),
						addMessages: jest.fn(),
						removeMessages: jest.fn(),
					},
				},
				{ provide: WhatsAppVoiceEditorService, useValue: voiceEditor },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({
				canActivate: (context: any) => {
					context.switchToHttp().getRequest().user = { id: 'test-user' };
					return true;
				},
			})
			.overrideGuard(RolesGuard)
			.useValue({ canActivate: () => true })
			.compile();

		app = moduleRef.createNestApplication();
		app.setGlobalPrefix('api/v1');
		app.useGlobalPipes(
			new ValidationPipe({
				transform: true,
				whitelist: true,
				forbidNonWhitelisted: true,
			}),
		);
		await app.init();
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		sync.listConversations.mockResolvedValue({ items: [], total: 0 });
		sync.sendText.mockResolvedValue({ ok: true, message: { id: 'message-1' } });
		sync.sendMedia.mockResolvedValue({ ok: true, message: { id: 'message-2' } });
		voiceEditor.send.mockResolvedValue({ ok: true, message: { id: 'message-3' } });
	});

	it('validates and dispatches a text message over HTTP', async () => {
		await request(app.getHttpServer())
			.post('/api/v1/whatsapp/conversations/conversation-1/messages')
			.send({ type: 'text', text: ' hello ' })
			.expect(201)
			.expect(({ body }) => expect(body.ok).toBe(true));

		expect(sync.sendText).toHaveBeenCalledWith(
			{ id: 'test-user' },
			'conversation-1',
			'hello',
			undefined,
			undefined,
		);
	});

	it('rejects unsupported types and unknown fields through the global pipe', async () => {
		await request(app.getHttpServer())
			.post('/api/v1/whatsapp/conversations/conversation-1/messages')
			.send({ type: 'template', text: 'not supported', secret: 'must be rejected' })
			.expect(400);
		expect(sync.sendText).not.toHaveBeenCalled();
		expect(sync.sendMedia).not.toHaveBeenCalled();
	});

	it('rejects media without a file id', async () => {
		await request(app.getHttpServer())
			.post('/api/v1/whatsapp/conversations/conversation-1/messages')
			.send({ type: 'image', caption: 'missing file' })
			.expect(400);
		expect(sync.sendMedia).not.toHaveBeenCalled();
	});

	it('forwards voice edit options when sending a video as a voice note', async () => {
		await request(app.getHttpServer())
			.post(
				'/api/v1/whatsapp/conversations/conversation-1/attachments/attachment-1/send-as-voice',
			)
			.send({
				startSeconds: 15,
				endSeconds: 45,
				gain: 1.5,
				removeBackgroundMusic: true,
				clientMessageId: 'client-1',
			})
			.expect(201);

		expect(voiceEditor.send).toHaveBeenCalledWith(
			{ id: 'test-user' },
			'conversation-1',
			'attachment-1',
			expect.objectContaining({ startSeconds: 15, endSeconds: 45, gain: 1.5 }),
			'client-1',
		);
	});

	it('rejects out-of-range voice edit options before any FFmpeg work', async () => {
		await request(app.getHttpServer())
			.post(
				'/api/v1/whatsapp/conversations/conversation-1/attachments/attachment-1/send-as-voice',
			)
			.send({ gain: 12 })
			.expect(400);
		expect(voiceEditor.send).not.toHaveBeenCalled();
	});

	it('passes pagination through the authenticated route', async () => {
		await request(app.getHttpServer())
			.get('/api/v1/whatsapp/accounts/account-1/conversations?page=2&limit=75')
			.expect(200);
		expect(sync.listConversations).toHaveBeenCalledWith(
			{ id: 'test-user' },
			'account-1',
			2,
			75,
			'',
			'all',
			'',
			'',
		);
	});
});
