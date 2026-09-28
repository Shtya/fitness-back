import { ForbiddenException } from '@nestjs/common';
import { SettingsService } from './settings.service';

function makeService() {
  const rows = new Map<string, any>([
    ['admin-1', { adminId: 'admin-1', orgName: 'Gym 1', aiSecretKey: 'k-1' }],
    ['admin-2', { adminId: 'admin-2', orgName: 'Gym 2', aiSecretKey: 'k-2' }],
  ]);
  const settingsRepo = {
    findOne: jest.fn(async ({ where }) => rows.get(where.adminId) ?? null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  return { service: new SettingsService(settingsRepo as any, {} as any, {} as any), settingsRepo };
}

describe('SettingsService.getForRequester', () => {
  it('returns the requester own settings including the AI key', async () => {
    const { service } = makeService();
    const result = await service.getForRequester({ id: 'admin-1', role: 'admin' });
    expect(result.aiSecretKey).toBe('k-1');
  });

  it('lets a coach read the own admin settings (exercise AI tools keep working)', async () => {
    const { service } = makeService();
    const result = await service.getForRequester({ id: 'coach-1', role: 'coach', adminId: 'admin-1' }, 'admin-1');
    expect(result.orgName).toBe('Gym 1');
    expect(result.aiSecretKey).toBe('k-1');
  });

  it('strips the AI key when a client reads the own admin settings', async () => {
    const { service } = makeService();
    const result = await service.getForRequester({ id: 'client-1', role: 'client', adminId: 'admin-1' }, 'admin-1');
    expect(result.orgName).toBe('Gym 1');
    expect(result.aiSecretKey).toBeNull();
  });

  it('rejects reading (or creating) another organisation settings', async () => {
    const { service, settingsRepo } = makeService();
    await expect(
      service.getForRequester({ id: 'coach-1', role: 'coach', adminId: 'admin-1' }, 'admin-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getForRequester({ id: 'admin-1', role: 'admin' }, 'random-id')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(settingsRepo.findOne).not.toHaveBeenCalled();
    expect(settingsRepo.save).not.toHaveBeenCalled();
  });

  it('allows super admins to read any settings', async () => {
    const { service } = makeService();
    const result = await service.getForRequester({ id: 'root', role: 'super_admin' }, 'admin-2');
    expect(result.aiSecretKey).toBe('k-2');
  });
});
