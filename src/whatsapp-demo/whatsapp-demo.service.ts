import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DataSource, In, Repository } from 'typeorm';
import { User, UserRole } from '../../entities/global.entity';
import {
  CreateDemoContactDto,
  CreateDemoConversationDto,
  CreateDemoEventDto,
  CreateDemoMessageDto,
  CreateDemoProfileDto,
  UpdateDemoContactDto,
  UpdateDemoConversationDto,
  UpdateDemoEventDto,
  UpdateDemoMessageDto,
  UpdateDemoProfileDto,
  UpdateDemoSettingsDto,
} from './dto/whatsapp-demo.dto';
import {
  DemoConversationSourceType,
  DemoAttachmentKind,
  WhatsAppDemoAttachment,
  WhatsAppDemoContact,
  WhatsAppDemoConversation,
  WhatsAppDemoEvent,
  WhatsAppDemoMessage,
  WhatsAppDemoProfile,
  WhatsAppDemoReaction,
  WhatsAppDemoSettings,
} from './entities/whatsapp-demo.entity';

const DEMO_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const DEMO_MEDIA_QUOTA_BYTES = 500 * 1024 * 1024;
const DEMO_MEDIA_TYPES: Record<string, { kind: DemoAttachmentKind; extension: string }> = {
  'image/jpeg': { kind: DemoAttachmentKind.IMAGE, extension: 'jpg' },
  'image/png': { kind: DemoAttachmentKind.IMAGE, extension: 'png' },
  'image/webp': { kind: DemoAttachmentKind.IMAGE, extension: 'webp' },
  'video/mp4': { kind: DemoAttachmentKind.VIDEO, extension: 'mp4' },
  'video/webm': { kind: DemoAttachmentKind.VIDEO, extension: 'webm' },
  'audio/mpeg': { kind: DemoAttachmentKind.AUDIO, extension: 'mp3' },
  'audio/ogg': { kind: DemoAttachmentKind.AUDIO, extension: 'ogg' },
  'audio/webm': { kind: DemoAttachmentKind.AUDIO, extension: 'webm' },
  'audio/mp4': { kind: DemoAttachmentKind.AUDIO, extension: 'm4a' },
  'application/pdf': { kind: DemoAttachmentKind.DOCUMENT, extension: 'pdf' },
  'application/msword': { kind: DemoAttachmentKind.DOCUMENT, extension: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: DemoAttachmentKind.DOCUMENT,
    extension: 'docx',
  },
  'application/vnd.ms-excel': { kind: DemoAttachmentKind.DOCUMENT, extension: 'xls' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: DemoAttachmentKind.DOCUMENT,
    extension: 'xlsx',
  },
};

const demoMediaRoot = () =>
  path.resolve(process.env.DEMO_WHATSAPP_MEDIA_ROOT || path.join(process.cwd(), 'storage', 'whatsapp-demo-media'));

const DEFAULT_FLAGS = {
  useFakeContacts: true,
  useFakeTyping: true,
  useFakeMessages: true,
  overlayRealChats: false,
  randomTyping: false,
  randomDelays: false,
  hideDemoBadge: false,
};

type Owner = { userId: string; tenantAdminId: string };

function hasDemoMediaSignature(buffer: Buffer, mimeType: string): boolean {
  if (!buffer.length) return false;
  const ascii = (start: number, end: number) => buffer.subarray(start, end).toString('ascii');
  switch (mimeType) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'video/mp4':
    case 'audio/mp4':
      return ascii(4, 8) === 'ftyp';
    case 'video/webm':
    case 'audio/webm':
      return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case 'audio/ogg':
      return ascii(0, 4) === 'OggS';
    case 'audio/mpeg':
      return ascii(0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    case 'application/pdf':
      return ascii(0, 5) === '%PDF-';
    case 'application/msword':
    case 'application/vnd.ms-excel':
      return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return buffer[0] === 0x50 && buffer[1] === 0x4b;
    default:
      return false;
  }
}

@Injectable()
export class WhatsAppDemoService {
  constructor(
    @InjectRepository(WhatsAppDemoSettings) private readonly settingsRepo: Repository<WhatsAppDemoSettings>,
    @InjectRepository(WhatsAppDemoProfile) private readonly profileRepo: Repository<WhatsAppDemoProfile>,
    @InjectRepository(WhatsAppDemoContact) private readonly contactRepo: Repository<WhatsAppDemoContact>,
    @InjectRepository(WhatsAppDemoConversation) private readonly conversationRepo: Repository<WhatsAppDemoConversation>,
    @InjectRepository(WhatsAppDemoMessage) private readonly messageRepo: Repository<WhatsAppDemoMessage>,
    @InjectRepository(WhatsAppDemoAttachment) private readonly attachmentRepo: Repository<WhatsAppDemoAttachment>,
    @InjectRepository(WhatsAppDemoReaction) private readonly reactionRepo: Repository<WhatsAppDemoReaction>,
    @InjectRepository(WhatsAppDemoEvent) private readonly eventRepo: Repository<WhatsAppDemoEvent>,
    private readonly dataSource: DataSource,
  ) {}

  private owner(user: User): Owner {
    const tenantAdminId =
      user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN ? user.id : user.adminId;
    if (!user.id || !tenantAdminId) {
      throw new ForbiddenException('Tenant adminId is missing for this user.');
    }
    return { userId: user.id, tenantAdminId };
  }

  private async ownedProfile(user: User, id: string): Promise<WhatsAppDemoProfile> {
    const owner = this.owner(user);
    const profile = await this.profileRepo.findOne({ where: { id, ...owner } });
    if (!profile) throw new NotFoundException('Demo profile not found');
    return profile;
  }

  private async ownedConversation(user: User, id: string, profileId?: string): Promise<WhatsAppDemoConversation> {
    const owner = this.owner(user);
    const conversation = await this.conversationRepo.findOne({
      where: { id, ...owner, ...(profileId ? { profileId } : {}) },
    });
    if (!conversation) throw new NotFoundException('Demo conversation not found');
    return conversation;
  }

  async getSettings(user: User) {
    const owner = this.owner(user);
    let settings = await this.settingsRepo.findOne({ where: owner, relations: { activeProfile: true } });
    if (!settings) {
      settings = await this.settingsRepo.save(
        this.settingsRepo.create({ ...owner, enabled: false, activeProfileId: null, flags: DEFAULT_FLAGS }),
      );
    }
    settings.flags = { ...DEFAULT_FLAGS, ...(settings.flags || {}) };
    return settings;
  }

  async updateSettings(user: User, dto: UpdateDemoSettingsDto) {
    const owner = this.owner(user);
    const settings = await this.getSettings(user);
    if (dto.activeProfileId !== undefined && dto.activeProfileId !== null) {
      await this.ownedProfile(user, dto.activeProfileId);
    }
    if (dto.enabled !== undefined) settings.enabled = dto.enabled;
    if (dto.activeProfileId !== undefined) settings.activeProfileId = dto.activeProfileId;
    if (dto.flags) settings.flags = { ...DEFAULT_FLAGS, ...(settings.flags || {}), ...dto.flags };
    return this.settingsRepo.save({ ...settings, ...owner });
  }

  listProfiles(user: User) {
    return this.profileRepo.find({ where: this.owner(user), order: { createdAt: 'ASC' } });
  }

  createProfile(user: User, dto: CreateDemoProfileDto) {
    return this.profileRepo.save(
      this.profileRepo.create({ ...dto, ...this.owner(user), locale: dto.locale || 'en', randomSeed: dto.randomSeed ?? 1 }),
    );
  }

  async getProfile(user: User, id: string) {
    return this.ownedProfile(user, id);
  }

  async updateProfile(user: User, id: string, dto: UpdateDemoProfileDto) {
    const profile = await this.ownedProfile(user, id);
    Object.assign(profile, dto);
    return this.profileRepo.save(profile);
  }

  async deleteProfile(user: User, id: string) {
    const profile = await this.ownedProfile(user, id);
    const attachments = await this.attachmentRepo.find({
      where: { profileId: id, ...this.owner(user) },
      select: { storageKey: true },
    });
    await this.profileRepo.remove(profile);
    await this.settingsRepo.update(
      { activeProfileId: id, ...this.owner(user) },
      { activeProfileId: null, enabled: false },
    );
    await this.removeUnreferencedMediaFiles(attachments.map((attachment) => attachment.storageKey));
    return { ok: true };
  }

  async activateProfile(user: User, id: string) {
    await this.ownedProfile(user, id);
    return this.updateSettings(user, { activeProfileId: id, enabled: true });
  }

  async cloneProfile(user: User, id: string) {
    const source = await this.ownedProfile(user, id);
    const owner = this.owner(user);
    return this.dataSource.transaction(async (manager) => {
      const profile = await manager.save(
        manager.create(WhatsAppDemoProfile, {
          ...owner,
          name: `${source.name} (copy)`,
          locale: source.locale,
          randomSeed: source.randomSeed,
        }),
      );
      const contacts = await manager.find(WhatsAppDemoContact, { where: { profileId: id, ...owner } });
      const contactIds = new Map<string, string>();
      for (const contact of contacts) {
        const copy = await manager.save(
          manager.create(WhatsAppDemoContact, {
            ...owner,
            profileId: profile.id,
            name: contact.name,
            avatarColor: contact.avatarColor,
            phone: contact.phone,
            about: contact.about,
            verified: contact.verified,
            presenceStatus: contact.presenceStatus,
            lastSeenAt: contact.lastSeenAt,
            photoAttachmentId: null,
          }),
        );
        contactIds.set(contact.id, copy.id);
      }
      const conversations = await manager.find(WhatsAppDemoConversation, { where: { profileId: id, ...owner } });
      const conversationIds = new Map<string, string>();
      const messageIds = new Map<string, string>();
      const sourceMessages: WhatsAppDemoMessage[] = [];
      for (const conversation of conversations) {
        const copy = await manager.save(
          manager.create(WhatsAppDemoConversation, {
            ...owner,
            profileId: profile.id,
            sourceType: conversation.sourceType,
            contactId: conversation.contactId ? contactIds.get(conversation.contactId) : null,
            realAccountId: conversation.realAccountId,
            realConversationId: conversation.realConversationId,
            pinned: conversation.pinned,
            archived: conversation.archived,
            unreadCount: conversation.unreadCount,
            mutedUntil: conversation.mutedUntil,
            manualOrder: conversation.manualOrder,
            overrides: conversation.overrides,
          }),
        );
        conversationIds.set(conversation.id, copy.id);
        const messages = await manager.find(WhatsAppDemoMessage, {
          where: { conversationId: conversation.id, ...owner },
          order: { timestamp: 'ASC' },
        });
        for (const message of messages) {
          sourceMessages.push(message);
          const messageCopy = await manager.save(
            manager.create(WhatsAppDemoMessage, {
              ...owner,
              conversationId: copy.id,
              direction: message.direction,
              type: message.type,
              text: message.text,
              timestamp: message.timestamp,
              status: message.status,
              showReadReceipt: message.showReadReceipt,
              replyToId: null,
              forwarded: message.forwarded,
              editedAt: message.editedAt,
              deletedMode: message.deletedMode,
              location: message.location,
              metadata: message.metadata,
            }),
          );
          messageIds.set(message.id, messageCopy.id);
        }
      }
      for (const message of sourceMessages) {
        if (message.replyToId && messageIds.has(message.replyToId)) {
          await manager.update(WhatsAppDemoMessage, messageIds.get(message.id)!, {
            replyToId: messageIds.get(message.replyToId)!,
          });
        }
        const reactions = await manager.find(WhatsAppDemoReaction, {
          where: { messageId: message.id, ...owner },
        });
        if (reactions.length) {
          await manager.save(
            reactions.map((reaction) =>
              manager.create(WhatsAppDemoReaction, {
                ...owner,
                messageId: messageIds.get(message.id)!,
                emoji: reaction.emoji,
                actorKey: reaction.actorKey,
              }),
            ),
          );
        }
      }
      const attachments = await manager.find(WhatsAppDemoAttachment, { where: { profileId: id, ...owner } });
      const attachmentIds = new Map<string, string>();
      for (const attachment of attachments) {
        const copy = await manager.save(
          manager.create(WhatsAppDemoAttachment, {
            ...owner,
            profileId: profile.id,
            messageId: attachment.messageId ? messageIds.get(attachment.messageId) || null : null,
            kind: attachment.kind,
            storageKey: attachment.storageKey,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            width: attachment.width,
            height: attachment.height,
            durationMs: attachment.durationMs,
          }),
        );
        attachmentIds.set(attachment.id, copy.id);
      }
      for (const contact of contacts) {
        if (contact.photoAttachmentId && attachmentIds.has(contact.photoAttachmentId)) {
          await manager.update(WhatsAppDemoContact, contactIds.get(contact.id)!, {
            photoAttachmentId: attachmentIds.get(contact.photoAttachmentId)!,
          });
        }
      }
      const events = await manager.find(WhatsAppDemoEvent, { where: { profileId: id, ...owner } });
      for (const event of events) {
        await manager.save(
          manager.create(WhatsAppDemoEvent, {
            ...owner,
            profileId: profile.id,
            conversationId: event.conversationId ? conversationIds.get(event.conversationId) : null,
            eventType: event.eventType,
            delayMs: event.delayMs,
            scheduledAt: event.scheduledAt,
            durationMs: event.durationMs,
            infinite: event.infinite,
            randomize: event.randomize,
            payload: event.payload,
            enabled: event.enabled,
            sequence: event.sequence,
          }),
        );
      }
      return profile;
    });
  }

  async listContacts(user: User, profileId: string) {
    await this.ownedProfile(user, profileId);
    return this.contactRepo.find({
      where: { profileId, ...this.owner(user) },
      relations: { photoAttachment: true },
      order: { createdAt: 'ASC' },
    });
  }

  async getContact(user: User, profileId: string, id: string) {
    await this.ownedProfile(user, profileId);
    const contact = await this.contactRepo.findOne({
      where: { id, profileId, ...this.owner(user) },
      relations: { photoAttachment: true },
    });
    if (!contact) throw new NotFoundException('Demo contact not found');
    return contact;
  }

  async createContact(user: User, profileId: string, dto: CreateDemoContactDto) {
    await this.ownedProfile(user, profileId);
    if (dto.photoAttachmentId) await this.assertAttachmentInProfile(user, profileId, dto.photoAttachmentId);
    return this.contactRepo.save(
      this.contactRepo.create({
        ...dto,
        ...this.owner(user),
        profileId,
        lastSeenAt: dto.lastSeenAt ? new Date(dto.lastSeenAt) : null,
      }),
    );
  }

  async updateContact(user: User, profileId: string, id: string, dto: UpdateDemoContactDto) {
    await this.ownedProfile(user, profileId);
    const owner = this.owner(user);
    const contact = await this.contactRepo.findOne({
      where: { id, profileId, ...owner },
      relations: { photoAttachment: true },
    });
    if (!contact) throw new NotFoundException('Demo contact not found');
    if (dto.photoAttachmentId) await this.assertAttachmentInProfile(user, profileId, dto.photoAttachmentId);
    const previousStorageKey = contact.photoAttachment?.storageKey;
    Object.assign(contact, dto, {
      ...(dto.lastSeenAt !== undefined ? { lastSeenAt: dto.lastSeenAt ? new Date(dto.lastSeenAt) : null } : {}),
    });
    const saved = await this.contactRepo.save(contact);
    if (previousStorageKey && dto.photoAttachmentId !== undefined) {
      const previousAttachment = await this.attachmentRepo.findOne({
        where: { storageKey: previousStorageKey, ...owner },
      });
      if (previousAttachment && previousAttachment.id !== dto.photoAttachmentId) {
        await this.attachmentRepo.remove(previousAttachment);
        await this.removeUnreferencedMediaFiles([previousStorageKey]);
      }
    }
    return saved;
  }

  async deleteContact(user: User, profileId: string, id: string) {
    await this.ownedProfile(user, profileId);
    const owner = this.owner(user);
    const contact = await this.contactRepo.findOne({
      where: { id, profileId, ...owner },
      relations: { photoAttachment: true },
    });
    if (!contact) throw new NotFoundException('Demo contact not found');
    const photoAttachment = contact.photoAttachment;
    const messageAttachments = await this.attachmentRepo
      .createQueryBuilder('attachment')
      .innerJoin(WhatsAppDemoMessage, 'message', 'message.id = attachment.messageId')
      .innerJoin(WhatsAppDemoConversation, 'conversation', 'conversation.id = message.conversationId')
      .select('attachment.storageKey', 'storageKey')
      .where('conversation.contactId = :id', { id })
      .andWhere('attachment.userId = :userId', owner)
      .andWhere('attachment.tenantAdminId = :tenantAdminId', owner)
      .getRawMany<{ storageKey: string }>();
    const result = await this.contactRepo.delete({ id, profileId, ...owner });
    if (!result.affected) throw new NotFoundException('Demo contact not found');
    if (photoAttachment) {
      await this.attachmentRepo.remove(photoAttachment);
    }
    await this.removeUnreferencedMediaFiles([
      ...(photoAttachment ? [photoAttachment.storageKey] : []),
      ...messageAttachments.map((attachment) => attachment.storageKey),
    ]);
    return { ok: true };
  }

  async listConversations(user: User, profileId: string) {
    await this.ownedProfile(user, profileId);
    return this.conversationRepo.find({
      where: { profileId, ...this.owner(user) },
      relations: { contact: { photoAttachment: true } },
      order: { pinned: 'DESC', manualOrder: 'ASC', updatedAt: 'DESC' },
    });
  }

  async getConversation(user: User, profileId: string, id: string) {
    await this.ownedProfile(user, profileId);
    const conversation = await this.conversationRepo.findOne({
      where: { id, profileId, ...this.owner(user) },
      relations: { contact: { photoAttachment: true } },
    });
    if (!conversation) throw new NotFoundException('Demo conversation not found');
    return conversation;
  }

  async createConversation(user: User, profileId: string, dto: CreateDemoConversationDto) {
    await this.ownedProfile(user, profileId);
    await this.validateConversation(user, profileId, dto);
    return this.conversationRepo.save(
      this.conversationRepo.create({
        ...dto,
        ...this.owner(user),
        profileId,
        mutedUntil: dto.mutedUntil ? new Date(dto.mutedUntil) : null,
      }),
    );
  }

  async updateConversation(user: User, profileId: string, id: string, dto: UpdateDemoConversationDto) {
    const conversation = await this.ownedConversation(user, id, profileId);
    const merged = { ...conversation, ...dto };
    await this.validateConversation(user, profileId, merged);
    Object.assign(conversation, dto, {
      ...(dto.mutedUntil !== undefined ? { mutedUntil: dto.mutedUntil ? new Date(dto.mutedUntil) : null } : {}),
    });
    return this.conversationRepo.save(conversation);
  }

  async deleteConversation(user: User, profileId: string, id: string) {
    const conversation = await this.ownedConversation(user, id, profileId);
    const attachments = await this.attachmentRepo
      .createQueryBuilder('attachment')
      .innerJoin(WhatsAppDemoMessage, 'message', 'message.id = attachment.messageId')
      .select('attachment.storageKey', 'storageKey')
      .where('message.conversationId = :id', { id })
      .andWhere('attachment.userId = :userId', this.owner(user))
      .andWhere('attachment.tenantAdminId = :tenantAdminId', this.owner(user))
      .getRawMany<{ storageKey: string }>();
    await this.conversationRepo.remove(conversation);
    await this.removeUnreferencedMediaFiles(attachments.map((attachment) => attachment.storageKey));
    return { ok: true };
  }

  private async validateConversation(
    user: User,
    profileId: string,
    dto: Pick<CreateDemoConversationDto, 'sourceType' | 'contactId' | 'realAccountId' | 'realConversationId'>,
  ) {
    if (dto.sourceType === DemoConversationSourceType.FAKE) {
      if (!dto.contactId || dto.realAccountId || dto.realConversationId) {
        throw new BadRequestException('Fake conversations require only contactId');
      }
      const contact = await this.contactRepo.findOne({ where: { id: dto.contactId, profileId, ...this.owner(user) } });
      if (!contact) throw new BadRequestException('Contact must belong to this demo profile');
    } else if (!dto.realAccountId || !dto.realConversationId || dto.contactId) {
      throw new BadRequestException('Real overlays require opaque realAccountId and realConversationId only');
    }
  }

  async listMessages(user: User, conversationId: string) {
    await this.ownedConversation(user, conversationId);
    return this.messageRepo.find({
      where: { conversationId, ...this.owner(user) },
      relations: { replyTo: true, attachments: true, reactions: true },
      order: { timestamp: 'ASC' },
    });
  }

  async getMessage(user: User, conversationId: string, id: string) {
    await this.ownedConversation(user, conversationId);
    const message = await this.messageRepo.findOne({
      where: { id, conversationId, ...this.owner(user) },
      relations: { replyTo: true, attachments: true, reactions: true },
    });
    if (!message) throw new NotFoundException('Demo message not found');
    return message;
  }

  async createMessage(user: User, conversationId: string, dto: CreateDemoMessageDto) {
    const conversation = await this.ownedConversation(user, conversationId);
    const owner = this.owner(user);
    if (dto.replyToId) await this.assertReplyInConversation(user, conversationId, dto.replyToId);
    const { attachmentIds = [], reactions = [], ...messageDto } = dto;
    const uniqueAttachmentIds = [...new Set(attachmentIds)];
    const attachments = uniqueAttachmentIds.length
      ? await this.attachmentRepo.find({
          where: {
            id: In(uniqueAttachmentIds),
            profileId: conversation.profileId,
            messageId: null,
            ...owner,
          },
        })
      : [];
    if (attachments.length !== uniqueAttachmentIds.length) {
      throw new BadRequestException('Every attachment must be an unused upload from this demo profile');
    }
    return this.dataSource.transaction(async (manager) => {
      const message = await manager.save(
        manager.create(WhatsAppDemoMessage, {
          ...messageDto,
          ...owner,
          conversationId,
          timestamp: new Date(dto.timestamp),
          editedAt: dto.editedAt ? new Date(dto.editedAt) : null,
        }),
      );
      if (attachments.length) {
        await manager.update(WhatsAppDemoAttachment, { id: In(uniqueAttachmentIds), ...owner }, {
          messageId: message.id,
        });
      }
      if (reactions.length) {
        await manager.save(
          reactions.map((reaction) =>
            manager.create(WhatsAppDemoReaction, { ...reaction, ...owner, messageId: message.id }),
          ),
        );
      }
      return manager.findOne(WhatsAppDemoMessage, {
        where: { id: message.id, ...owner },
        relations: { replyTo: true, attachments: true, reactions: true },
      });
    });
  }

  async updateMessage(user: User, conversationId: string, id: string, dto: UpdateDemoMessageDto) {
    await this.ownedConversation(user, conversationId);
    const owner = this.owner(user);
    const message = await this.messageRepo.findOne({ where: { id, conversationId, ...owner } });
    if (!message) throw new NotFoundException('Demo message not found');
    if (dto.replyToId) await this.assertReplyInConversation(user, conversationId, dto.replyToId);
    const { reactions, ...safe } = dto;
    delete safe.attachmentIds;
    Object.assign(message, safe, {
      ...(dto.timestamp !== undefined ? { timestamp: new Date(dto.timestamp) } : {}),
      ...(dto.editedAt !== undefined ? { editedAt: dto.editedAt ? new Date(dto.editedAt) : null } : {}),
    });
    return this.dataSource.transaction(async (manager) => {
      await manager.save(message);
      if (reactions !== undefined) {
        await manager.delete(WhatsAppDemoReaction, { messageId: id, ...owner });
        if (reactions.length) {
          await manager.save(
            reactions.map((reaction) =>
              manager.create(WhatsAppDemoReaction, { ...reaction, ...owner, messageId: id }),
            ),
          );
        }
      }
      return manager.findOne(WhatsAppDemoMessage, {
        where: { id, conversationId, ...owner },
        relations: { replyTo: true, attachments: true, reactions: true },
      });
    });
  }

  async deleteMessage(user: User, conversationId: string, id: string) {
    await this.ownedConversation(user, conversationId);
    const attachments = await this.attachmentRepo.find({
      where: { messageId: id, ...this.owner(user) },
      select: { storageKey: true },
    });
    const result = await this.messageRepo.delete({ id, conversationId, ...this.owner(user) });
    if (!result.affected) throw new NotFoundException('Demo message not found');
    await this.removeUnreferencedMediaFiles(attachments.map((attachment) => attachment.storageKey));
    return { ok: true };
  }

  async listEvents(user: User, profileId: string) {
    await this.ownedProfile(user, profileId);
    return this.eventRepo.find({
      where: { profileId, ...this.owner(user) },
      order: { sequence: 'ASC', createdAt: 'ASC' },
    });
  }

  async getEvent(user: User, profileId: string, id: string) {
    await this.ownedProfile(user, profileId);
    const event = await this.eventRepo.findOne({ where: { id, profileId, ...this.owner(user) } });
    if (!event) throw new NotFoundException('Demo event not found');
    return event;
  }

  async createEvent(user: User, profileId: string, dto: CreateDemoEventDto) {
    await this.ownedProfile(user, profileId);
    if (dto.conversationId) await this.ownedConversation(user, dto.conversationId, profileId);
    return this.eventRepo.save(this.eventRepo.create({
      ...dto,
      ...this.owner(user),
      profileId,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
    }));
  }

  async updateEvent(user: User, profileId: string, id: string, dto: UpdateDemoEventDto) {
    await this.ownedProfile(user, profileId);
    const event = await this.eventRepo.findOne({ where: { id, profileId, ...this.owner(user) } });
    if (!event) throw new NotFoundException('Demo event not found');
    if (dto.conversationId) await this.ownedConversation(user, dto.conversationId, profileId);
    Object.assign(event, dto, {
      ...(dto.scheduledAt !== undefined
        ? { scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null }
        : {}),
    });
    return this.eventRepo.save(event);
  }

  async deleteEvent(user: User, profileId: string, id: string) {
    await this.ownedProfile(user, profileId);
    const result = await this.eventRepo.delete({ id, profileId, ...this.owner(user) });
    if (!result.affected) throw new NotFoundException('Demo event not found');
    return { ok: true };
  }

  async uploadMedia(
    user: User,
    profileId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  ) {
    await this.ownedProfile(user, profileId);
    if (!file?.buffer?.length || file.size <= 0) {
      throw new BadRequestException('A non-empty demo media file is required');
    }
    if (file.size > DEMO_MEDIA_MAX_BYTES) {
      throw new BadRequestException('Demo media files may not exceed 50 MB');
    }
    const normalizedMimeType = String(file.mimetype || '').split(';')[0].toLowerCase();
    const mediaType = DEMO_MEDIA_TYPES[normalizedMimeType];
    if (!mediaType || !hasDemoMediaSignature(file.buffer, normalizedMimeType)) {
      throw new BadRequestException('Unsupported or invalid demo media file');
    }
    const owner = this.owner(user);
    const quota = await this.attachmentRepo
      .createQueryBuilder('attachment')
      .select('COALESCE(SUM(attachment.sizeBytes), 0)', 'total')
      .where('attachment.userId = :userId', owner)
      .andWhere('attachment.tenantAdminId = :tenantAdminId', owner)
      .getRawOne<{ total: string }>();
    if (Number(quota?.total || 0) + file.size > DEMO_MEDIA_QUOTA_BYTES) {
      throw new BadRequestException('The 500 MB demo media quota has been reached');
    }

    const storageKey = path.join(
      owner.tenantAdminId,
      owner.userId,
      profileId,
      `${randomUUID()}.${mediaType.extension}`,
    );
    const absolutePath = this.resolveMediaPath(storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.buffer, { flag: 'wx' });
    try {
      return await this.attachmentRepo.save(
        this.attachmentRepo.create({
          ...owner,
          profileId,
          messageId: null,
          kind: mediaType.kind,
          storageKey,
          fileName: path.basename(file.originalname || `demo-media.${mediaType.extension}`).slice(0, 255),
          mimeType: normalizedMimeType,
          sizeBytes: String(file.size),
          width: null,
          height: null,
          durationMs: null,
        }),
      );
    } catch (error) {
      await fs.unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async getMedia(user: User, attachmentId: string) {
    const attachment = await this.attachmentRepo.findOne({
      where: { id: attachmentId, ...this.owner(user) },
    });
    if (!attachment) throw new NotFoundException('Demo attachment not found');
    const absolutePath = this.resolveMediaPath(attachment.storageKey);
    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('Demo attachment file is unavailable');
    }
    return { attachment, absolutePath };
  }

  async deleteMedia(user: User, attachmentId: string) {
    const attachment = await this.attachmentRepo.findOne({
      where: { id: attachmentId, ...this.owner(user) },
    });
    if (!attachment) throw new NotFoundException('Demo attachment not found');
    if (attachment.messageId) {
      throw new BadRequestException('Delete the demo message before deleting its attachment');
    }
    const contactReference = await this.contactRepo.count({
      where: { photoAttachmentId: attachmentId, ...this.owner(user) },
    });
    if (contactReference) {
      throw new BadRequestException('Replace or delete the demo contact photo first');
    }
    await this.attachmentRepo.remove(attachment);
    await this.removeUnreferencedMediaFiles([attachment.storageKey]);
    return { ok: true };
  }

  private resolveMediaPath(storageKey: string) {
    const root = demoMediaRoot();
    const resolved = path.resolve(root, storageKey);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new BadRequestException('Invalid demo media path');
    }
    return resolved;
  }

  private async removeUnreferencedMediaFiles(storageKeys: string[]) {
    for (const storageKey of [...new Set(storageKeys.filter(Boolean))]) {
      const references = await this.attachmentRepo.count({ where: { storageKey } });
      if (references === 0) {
        await fs.unlink(this.resolveMediaPath(storageKey)).catch(() => undefined);
      }
    }
  }

  private async assertAttachmentInProfile(user: User, profileId: string, id: string) {
    const attachment = await this.attachmentRepo.findOne({ where: { id, profileId, ...this.owner(user) } });
    if (!attachment) throw new BadRequestException('Attachment must belong to this demo profile');
  }

  private async assertReplyInConversation(user: User, conversationId: string, id: string) {
    const reply = await this.messageRepo.findOne({ where: { id, conversationId, ...this.owner(user) } });
    if (!reply) throw new BadRequestException('Reply message must belong to this demo conversation');
  }
}
