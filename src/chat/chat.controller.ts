// src/chat/chat.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { ChatService } from './chat.service';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { chatImageUploadOptions, chatVideoUploadOptions, chatFileUploadOptions } from './upload.config';

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('conversations')
  async createConversation(@Req() req: any, @Body() body: any) {
    return this.chatService.createConversation(
      req.user,
      body.participantIds,
      body.name,
      body.isGroup
    );
  }

  @Get('conversations')
  async getUserConversations(
    @Req() req: any,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50
  ) {
    return this.chatService.getUserConversations(req.user.id, page, limit);
  }

  @Get('conversations/:id/messages')
  async getConversationMessages(
    @Req() req: any,
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50
  ) {
    return this.chatService.getConversationMessages(id, req.user.id, page, limit);
  }

  @Post('conversations/:id/participants')
  async addParticipants(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any
  ) {
    return this.chatService.addParticipants(id, body.userIds, req.user.id);
  }

  @Delete('conversations/:conversationId/participants/:userId')
  async removeParticipant(
    @Req() req: any,
    @Param('conversationId') conversationId: string,
    @Param('userId') userId: string
  ) {
    return this.chatService.removeParticipant(conversationId, userId, req.user.id);
  }

  @Get('coach/conversations')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  async getCoachConversations(
    @Req() req: any,
    @Query('clientId') clientId?: string
  ) {
    return this.chatService.getConversationForCoach(req.user.id, clientId);
  }

  @Get('search')
  async searchConversations(
    @Req() req: any,
    @Query('q') query: string
  ) {
    return this.chatService.searchConversations(req.user.id, query);
  }

  // Search users endpoint
  @Get('users/search')
  async searchUsers(
    @Req() req: any,
    @Query('q') query: string,
    @Query('role') role?: UserRole
  ) {
    return this.chatService.searchUsers(req.user.id, query, role);
  }

  // Get or create direct conversation
  @Post('conversations/direct/:userId')
  async getOrCreateDirectConversation(
    @Req() req: any,
    @Param('userId') userId: string
  ) {
    return this.chatService.getOrCreateDirectConversation(req.user.id, userId);
  }

  // File upload endpoints
  @Post('upload/image')
  @UseInterceptors(FileInterceptor('file', chatImageUploadOptions))
  async uploadImage(@UploadedFile() file: any) {
    return {
      url: `/uploads/chat/images/${file.filename}`,
      path: file.path,
      filename: file.filename,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
  }

  @Post('upload/video')
  @UseInterceptors(FileInterceptor('file', chatVideoUploadOptions))
  async uploadVideo(@UploadedFile() file: any) {
     return {
      url: `/uploads/chat/videos/${file.filename}`,
      path: file.path,
      filename: file.filename,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
  }

  @Post('upload/file')
  @UseInterceptors(FileInterceptor('file', chatFileUploadOptions))
  async uploadFile(@UploadedFile() file: any) {
    return {
      url: `/uploads/chat/files/${file.filename}`,
      path: file.path,
      filename: file.filename,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
  }
}