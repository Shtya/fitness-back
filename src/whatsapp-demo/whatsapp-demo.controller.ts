import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
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
import { WhatsAppDemoService } from './whatsapp-demo.service';

@Controller('whatsapp-demo')
@UseGuards(JwtAuthGuard)
export class WhatsAppDemoController {
  constructor(private readonly service: WhatsAppDemoService) {}

  @Get('settings')
  getSettings(@Req() req: any) {
    return this.service.getSettings(req.user);
  }

  @Patch('settings')
  updateSettings(@Req() req: any, @Body() dto: UpdateDemoSettingsDto) {
    return this.service.updateSettings(req.user, dto);
  }

  @Get('profiles')
  listProfiles(@Req() req: any) {
    return this.service.listProfiles(req.user);
  }

  @Post('profiles')
  createProfile(@Req() req: any, @Body() dto: CreateDemoProfileDto) {
    return this.service.createProfile(req.user, dto);
  }

  @Get('profiles/:profileId')
  getProfile(@Req() req: any, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.service.getProfile(req.user, profileId);
  }

  @Patch('profiles/:profileId')
  updateProfile(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: UpdateDemoProfileDto,
  ) {
    return this.service.updateProfile(req.user, profileId, dto);
  }

  @Delete('profiles/:profileId')
  deleteProfile(@Req() req: any, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.service.deleteProfile(req.user, profileId);
  }

  @Post('profiles/:profileId/activate')
  activateProfile(@Req() req: any, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.service.activateProfile(req.user, profileId);
  }

  @Post('profiles/:profileId/clone')
  cloneProfile(@Req() req: any, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.service.cloneProfile(req.user, profileId);
  }

  @Get('profiles/:profileId/contacts')
  listContacts(@Req() req: any, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.service.listContacts(req.user, profileId);
  }

  @Post('profiles/:profileId/contacts')
  createContact(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: CreateDemoContactDto,
  ) {
    return this.service.createContact(req.user, profileId, dto);
  }

  @Get('profiles/:profileId/contacts/:contactId')
  getContact(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    return this.service.getContact(req.user, profileId, contactId);
  }

  @Patch('profiles/:profileId/contacts/:contactId')
  updateContact(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateDemoContactDto,
  ) {
    return this.service.updateContact(req.user, profileId, contactId, dto);
  }

  @Delete('profiles/:profileId/contacts/:contactId')
  deleteContact(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    return this.service.deleteContact(req.user, profileId, contactId);
  }

  @Get('profiles/:profileId/conversations')
  listConversations(@Req() req: any, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.service.listConversations(req.user, profileId);
  }

  @Post('profiles/:profileId/conversations')
  createConversation(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: CreateDemoConversationDto,
  ) {
    return this.service.createConversation(req.user, profileId, dto);
  }

  @Get('profiles/:profileId/conversations/:conversationId')
  getConversation(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.service.getConversation(req.user, profileId, conversationId);
  }

  @Patch('profiles/:profileId/conversations/:conversationId')
  updateConversation(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: UpdateDemoConversationDto,
  ) {
    return this.service.updateConversation(req.user, profileId, conversationId, dto);
  }

  @Delete('profiles/:profileId/conversations/:conversationId')
  deleteConversation(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.service.deleteConversation(req.user, profileId, conversationId);
  }

  @Get('conversations/:conversationId/messages')
  listMessages(@Req() req: any, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
    return this.service.listMessages(req.user, conversationId);
  }

  @Post('conversations/:conversationId/messages')
  createMessage(
    @Req() req: any,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: CreateDemoMessageDto,
  ) {
    return this.service.createMessage(req.user, conversationId, dto);
  }

  @Get('conversations/:conversationId/messages/:messageId')
  getMessage(
    @Req() req: any,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.service.getMessage(req.user, conversationId, messageId);
  }

  @Patch('conversations/:conversationId/messages/:messageId')
  updateMessage(
    @Req() req: any,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: UpdateDemoMessageDto,
  ) {
    return this.service.updateMessage(req.user, conversationId, messageId, dto);
  }

  @Delete('conversations/:conversationId/messages/:messageId')
  deleteMessage(
    @Req() req: any,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.service.deleteMessage(req.user, conversationId, messageId);
  }

  @Get('profiles/:profileId/events')
  listEvents(@Req() req: any, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.service.listEvents(req.user, profileId);
  }

  @Post('profiles/:profileId/events')
  createEvent(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: CreateDemoEventDto,
  ) {
    return this.service.createEvent(req.user, profileId, dto);
  }

  @Get('profiles/:profileId/events/:eventId')
  getEvent(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.getEvent(req.user, profileId, eventId);
  }

  @Patch('profiles/:profileId/events/:eventId')
  updateEvent(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateDemoEventDto,
  ) {
    return this.service.updateEvent(req.user, profileId, eventId, dto);
  }

  @Delete('profiles/:profileId/events/:eventId')
  deleteEvent(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.deleteEvent(req.user, profileId, eventId);
  }
}
