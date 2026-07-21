import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User, UserRole } from '../../entities/global.entity';
import {
  WhatsAppDemoAttachment,
  WhatsAppDemoContact,
  WhatsAppDemoConversation,
  WhatsAppDemoEvent,
  WhatsAppDemoMessage,
  WhatsAppDemoProfile,
  WhatsAppDemoReaction,
  WhatsAppDemoSettings,
} from './entities/whatsapp-demo.entity';
import { WHATSAPP_DEMO_ENTITIES } from './whatsapp-demo.module';
import { WhatsAppDemoService } from './whatsapp-demo.service';

const ENTITIES = [
  WhatsAppDemoSettings,
  WhatsAppDemoProfile,
  WhatsAppDemoContact,
  WhatsAppDemoConversation,
  WhatsAppDemoMessage,
  WhatsAppDemoAttachment,
  WhatsAppDemoReaction,
  WhatsAppDemoEvent,
];

const repositoryMock = () => ({
  create: jest.fn((value) => value),
  save: jest.fn(async (value) => ({ id: value.id || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...value })),
  find: jest.fn(),
  findOne: jest.fn(),
  delete: jest.fn(),
  remove: jest.fn(),
});

describe('WhatsAppDemoService tenant isolation', () => {
  let service: WhatsAppDemoService;
  let profiles: ReturnType<typeof repositoryMock>;

  const client = {
    id: '11111111-1111-4111-8111-111111111111',
    adminId: '22222222-2222-4222-8222-222222222222',
    role: UserRole.CLIENT,
  } as User;

  beforeEach(async () => {
    const providers: any[] = [
      WhatsAppDemoService,
      {
        provide: DataSource,
        useValue: { transaction: jest.fn() },
      },
    ];
    for (const entity of ENTITIES) {
      providers.push({ provide: getRepositoryToken(entity), useValue: repositoryMock() });
    }
    const module = await Test.createTestingModule({ providers }).compile();
    service = module.get(WhatsAppDemoService);
    profiles = module.get(getRepositoryToken(WhatsAppDemoProfile));
  });

  it('derives user and tenant ownership and cannot be overridden by input', async () => {
    await service.createProfile(client, {
      name: 'Demo',
      tenantAdminId: '99999999-9999-4999-8999-999999999999',
      userId: '99999999-9999-4999-8999-999999999999',
    } as any);

    expect(profiles.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: client.id,
        tenantAdminId: client.adminId,
        name: 'Demo',
      }),
    );
  });

  it('includes both authenticated owner keys in every profile lookup', async () => {
    profiles.findOne.mockResolvedValue(null);

    await expect(service.getProfile(client, '33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(profiles.findOne).toHaveBeenCalledWith({
      where: {
        id: '33333333-3333-4333-8333-333333333333',
        userId: client.id,
        tenantAdminId: client.adminId,
      },
    });
  });

  it('derives an admin tenant from the authenticated admin id', async () => {
    const admin = { id: client.adminId, role: UserRole.ADMIN, adminId: null } as User;
    profiles.find.mockResolvedValue([]);

    await service.listProfiles(admin);

    expect(profiles.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: admin.id, tenantAdminId: admin.id } }),
    );
  });

  it('injects only demo repositories and TypeORM infrastructure', () => {
    expect(WHATSAPP_DEMO_ENTITIES).toEqual(ENTITIES);
    expect(WHATSAPP_DEMO_ENTITIES.every((entity) => entity.name.startsWith('WhatsAppDemo'))).toBe(true);
    const dependencies = (Reflect.getMetadata('design:paramtypes', WhatsAppDemoService) || []).map(
      (dependency: any) => dependency?.name,
    );
    expect(dependencies).toEqual([
      Repository.name,
      Repository.name,
      Repository.name,
      Repository.name,
      Repository.name,
      Repository.name,
      Repository.name,
      Repository.name,
      DataSource.name,
    ]);
  });
});
