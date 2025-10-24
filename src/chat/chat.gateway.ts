// src/chat/chat.gateway.ts
import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'entities/global.entity';
import { ChatConversation, ChatMessage, ChatParticipant } from 'entities/global.entity';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
@Injectable()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, string>();

  constructor(
    private jwtService: JwtService,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(ChatConversation) private conversationRepo: Repository<ChatConversation>,
    @InjectRepository(ChatMessage) private messageRepo: Repository<ChatMessage>,
    @InjectRepository(ChatParticipant) private participantRepo: Repository<ChatParticipant>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET!,
      });

      const user = await this.userRepo.findOne({ where: { id: decoded.id } });
      if (!user) {
        client.disconnect();
        return;
      }

      this.connectedUsers.set(user.id, client.id);
      client.join(`user_${user.id}`);

      // Join all user's conversations
      const participants = await this.participantRepo.find({
        where: { user: { id: user.id }, isActive: true },
        relations: ['conversation'],
      });

      participants.forEach(participant => {
        client.join(`conversation_${participant.conversation.id}`);
      });

      // Notify others about user online status
      this.server.emit('user_online', { userId: user.id, online: true });
    } catch (error) {
      console.error('Connection error:', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.connectedUsers.delete(userId);
        this.server.emit('user_online', { userId, online: false });
        break;
      }
    }
  }

  @SubscribeMessage('join_conversation')
  async handleJoinConversation(client: Socket, conversationId: string) {
    client.join(`conversation_${conversationId}`);
  }

  @SubscribeMessage('leave_conversation')
  async handleLeaveConversation(client: Socket, conversationId: string) {
    client.leave(`conversation_${conversationId}`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    client: Socket,
    payload: {
      conversationId: string;
      content: string;
      messageType?: string;
      attachments?: any[];
      replyToId?: string;
      tempId?: string;
    },
  ) {
    try {
      const token = client.handshake.auth.token;
      const decoded = this.jwtService.verify(token, { secret: process.env.JWT_SECRET! });
      const user = await this.userRepo.findOne({ where: { id: decoded.id } });

      if (!user) return;

      // Check if user is participant of conversation
      const participant = await this.participantRepo.findOne({
        where: {
          conversation: { id: payload.conversationId },
          user: { id: user.id },
          isActive: true,
        },
      });

      if (!participant) return;

      // Create and save message
      const message = this.messageRepo.create({
        conversation: { id: payload.conversationId },
        sender: user,
        content: payload.content,
        messageType: payload.messageType || 'text',
        attachments: payload.attachments || null,
        replyTo: payload.replyToId ? { id: payload.replyToId } : null,
      });

      const savedMessage = await this.messageRepo.save(message);

      // Update conversation last message
      await this.conversationRepo.update(payload.conversationId, {
        lastMessageAt: new Date(),
      });

      // Get complete message with relations
      const messageWithRelations = await this.messageRepo.findOne({
        where: { id: savedMessage.id },
        relations: ['sender', 'conversation', 'replyTo', 'replyTo.sender'],
      });

      // Prepare message for emission
      const messageToEmit = {
        ...messageWithRelations,
        tempId: payload.tempId,
        conversation: {
          id: messageWithRelations.conversation.id,
        },
      };

      // Emit to all participants in the conversation
      this.server.to(`conversation_${payload.conversationId}`).emit('new_message', messageToEmit);

      // Update conversation list for all participants
      const participants = await this.participantRepo.find({
        where: { conversation: { id: payload.conversationId }, isActive: true },
        relations: ['user'],
      });

      // Emit conversation update to all participants
      participants.forEach(async participant => {
        const userSocketId = this.connectedUsers.get(participant.user.id);

        // Get updated conversation with unread count
        const updatedConvo = await this.getConversationWithUnreadCount(payload.conversationId, participant.user.id);

        if (userSocketId) {
          this.server.to(userSocketId).emit('conversation_updated', updatedConvo);
        }
      });
    } catch (error) {
      console.error('Error sending message:', error);
      // Emit error back to sender
      client.emit('message_error', {
        tempId: payload.tempId,
        error: 'Failed to send message',
      });
    }
  }

  private async getConversationWithUnreadCount(conversationId: string, userId: string) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['chatParticipants', 'chatParticipants.user'],
    });

    if (!conversation) return null;

    // Get last message
    const lastMessage = await this.messageRepo.findOne({
      where: { conversation: { id: conversationId } },
      relations: ['sender'],
      order: { created_at: 'DESC' },
    });

    // Calculate unread count
    const participant = await this.participantRepo.findOne({
      where: {
        conversation: { id: conversationId },
        user: { id: userId },
      },
    });

    let unreadCount = 0;
    if (participant?.lastReadAt) {
      unreadCount = await this.messageRepo
        .createQueryBuilder('message')
        .where('message.conversationId = :conversationId', { conversationId })
        .andWhere('message.created_at > :lastRead', {
          lastRead: participant.lastReadAt,
        })
        .andWhere('message.senderId != :userId', { userId })
        .andWhere('message.isDeleted = false')
        .getCount();
    } else {
      unreadCount = await this.messageRepo.createQueryBuilder('message').where('message.conversationId = :conversationId', { conversationId }).andWhere('message.senderId != :userId', { userId }).andWhere('message.isDeleted = false').getCount();
    }

    return {
      ...conversation,
      lastMessage,
      unreadCount,
    };
  }

  @SubscribeMessage('typing_start')
  async handleTypingStart(client: Socket, conversationId: string) {
    try {
      const token = client.handshake.auth.token;
      const decoded = this.jwtService.verify(token, { secret: process.env.JWT_SECRET! });
      const user = await this.userRepo.findOne({ where: { id: decoded.id } });

      if (!user) return;

      client.to(`conversation_${conversationId}`).emit('user_typing', {
        conversationId,
        userId: user.id,
        userName: user.name,
        typing: true,
      });
    } catch (error) {
      console.error('Error handling typing start:', error);
    }
  }

  @SubscribeMessage('typing_stop')
  async handleTypingStop(client: Socket, conversationId: string) {
    try {
      const token = client.handshake.auth.token;
      const decoded = this.jwtService.verify(token, { secret: process.env.JWT_SECRET! });
      const user = await this.userRepo.findOne({ where: { id: decoded.id } });

      if (!user) return;

      client.to(`conversation_${conversationId}`).emit('user_typing', {
        conversationId,
        userId: user.id,
        userName: user.name,
        typing: false,
      });
    } catch (error) {
      console.error('Error handling typing stop:', error);
    }
  }

  @SubscribeMessage('mark_as_read')
  async handleMarkAsRead(client: Socket, conversationId: string) {
    try {
      const token = client.handshake.auth.token;
      const decoded = this.jwtService.verify(token, { secret: process.env.JWT_SECRET! });
      const user = await this.userRepo.findOne({ where: { id: decoded.id } });

      if (!user) return;

      // Update last read time
      await this.participantRepo.update({ conversation: { id: conversationId }, user: { id: user.id } }, { lastReadAt: new Date() });

      // Mark messages as read
      await this.messageRepo
      .createQueryBuilder()
      .update(ChatMessage)
      .set({ readBy: () => 'CURRENT_TIMESTAMP' }) // ✅ timestamptz
      .where('conversationId = :conversationId', { conversationId })
      .andWhere('senderId != :userId', { userId: user.id })
      .andWhere('readBy IS NULL') // ✅ مفيش JSON ولا @>
      .execute();

      // Notify others in conversation
      client.to(`conversation_${conversationId}`).emit('messages_read', {
        conversationId,
        userId: user.id,
        readAt: new Date(),
      });

      // Update conversation unread count for user
      const updatedConvo = await this.getConversationWithUnreadCount(conversationId, user.id);
      client.emit('conversation_updated', updatedConvo);
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }
}
