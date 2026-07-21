import { Test } from '@nestjs/testing';
import { UserRole } from '../../entities/global.entity';
import { WhatsAppDemoController } from './whatsapp-demo.controller';
import { WhatsAppDemoService } from './whatsapp-demo.service';

describe('WhatsAppDemoController', () => {
  const service = {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
    listProfiles: jest.fn(),
  };
  let controller: WhatsAppDemoController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [WhatsAppDemoController],
      providers: [{ provide: WhatsAppDemoService, useValue: service }],
    }).compile();
    controller = module.get(WhatsAppDemoController);
  });

  it('passes the authenticated user to the service as the ownership source', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      adminId: '22222222-2222-4222-8222-222222222222',
      role: UserRole.CLIENT,
    };
    service.updateSettings.mockResolvedValue({ enabled: true });

    await controller.updateSettings(
      { user },
      { enabled: true, tenantAdminId: '99999999-9999-4999-8999-999999999999' } as any,
    );

    expect(service.updateSettings).toHaveBeenCalledWith(user, expect.objectContaining({ enabled: true }));
    expect(service.updateSettings.mock.calls[0][0]).toBe(user);
  });
});
