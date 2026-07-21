import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { WhatsAppDemoService } from './whatsapp-demo.service';

@Controller('whatsapp-demo')
@UseGuards(JwtAuthGuard)
export class WhatsAppDemoMediaController {
  constructor(private readonly service: WhatsAppDemoService) {}

  @Post('profiles/:profileId/media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Req() req: any,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  ) {
    return this.service.uploadMedia(req.user, profileId, file);
  }

  @Get('attachments/:attachmentId/content')
  async content(
    @Req() req: any,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { attachment, absolutePath } = await this.service.getMedia(req.user, attachmentId);
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Length', attachment.sizeBytes);
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    );
    response.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(createReadStream(absolutePath));
  }

  @Delete('attachments/:attachmentId')
  delete(
    @Req() req: any,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.service.deleteMedia(req.user, attachmentId);
  }
}
