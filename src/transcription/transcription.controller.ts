import {
	Body,
	BadRequestException,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,
	Query,
	Req,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import {
	SaveProviderCredentialDto,
	UpdateTranscriptionDto,
} from './dto/transcription.dto';
import { AudioUpload, TranscriptionService } from './transcription.service';

const ALLOWED_EXTENSIONS = /\.(mp3|wav|m4a|webm|ogg|mp4)$/i;
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

@Controller('transcriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TranscriptionController {
	constructor(private readonly transcriptionService: TranscriptionService) {}

	@Get('providers/:provider/credential')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	credentialStatus(@Param('provider') provider: string) {
		return this.transcriptionService.credentialStatus(provider);
	}

	@Put('providers/:provider/credential')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	saveCredential(
		@Req() req: any,
		@Param('provider') provider: string,
		@Body() dto: SaveProviderCredentialDto,
	) {
		return this.transcriptionService.saveCredential(req.user.id, provider, dto.apiKey);
	}

	@Delete('providers/:provider/credential')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	removeCredential(@Param('provider') provider: string) {
		return this.transcriptionService.removeCredential(provider);
	}

	@Post()
	@UseInterceptors(
		FileInterceptor('file', {
			storage: diskStorage({
				destination: tmpdir(),
				filename: (_req, _file, callback) => callback(null, `so7bafit-upload-${randomUUID()}`),
			}),
			limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
			fileFilter: (_req, file, callback) => {
				const valid = ALLOWED_EXTENSIONS.test(file.originalname);
				callback(valid ? null : new BadRequestException('Unsupported audio format'), valid);
			},
		}),
	)
	create(
		@Req() req: any,
		@UploadedFile() file: AudioUpload,
		@Body() dto: any,
	) {
		if (!file) throw new BadRequestException('Audio file is required');
		return this.transcriptionService.transcribe(req.user.id, file, dto);
	}

	@Get()
	list(@Req() req: any, @Query('limit') limit?: string) {
		return this.transcriptionService.list(req.user.id, Number(limit));
	}

	@Patch(':id')
	update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTranscriptionDto) {
		return this.transcriptionService.update(req.user.id, id, dto.text);
	}

	@Delete(':id')
	remove(@Req() req: any, @Param('id') id: string) {
		return this.transcriptionService.remove(req.user.id, id);
	}
}
