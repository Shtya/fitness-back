import {
	Body,
	Controller,
	Get,
	Param,
	ParseUUIDPipe,
	Post,
	Put,
	Req,
	UploadedFiles,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { BodyMeasurementService } from './body-measurement.service';
import { SaveBodyMeasurementDto } from './dto/body-measurement.dto';
import { bodyMeasurementUploadOptions } from './body-measurement.upload';

@UseGuards(JwtAuthGuard)
@Controller('users/:id/body-measurements')
export class BodyMeasurementController {
	constructor(private readonly service: BodyMeasurementService) {}

	@Get('latest')
	latest(@Req() req, @Param('id', ParseUUIDPipe) id: string) {
		return this.service.latest(req.user, id);
	}

	@Get()
	list(@Req() req, @Param('id', ParseUUIDPipe) id: string) {
		return this.service.list(req.user, id);
	}

	@Post('analyze')
	@UseInterceptors(
		FileFieldsInterceptor(
			[
				{ name: 'front', maxCount: 1 },
				{ name: 'side', maxCount: 1 },
			],
			bodyMeasurementUploadOptions,
		),
	)
	analyze(
		@Req() req,
		@Param('id', ParseUUIDPipe) id: string,
		@UploadedFiles()
		files: { front?: Express.Multer.File[]; side?: Express.Multer.File[] },
	) {
		return this.service.analyze(req.user, id, files, req.body?.height);
	}

	@Post()
	save(@Req() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveBodyMeasurementDto) {
		return this.service.save(req.user, id, dto);
	}

	@Put()
	replace(@Req() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveBodyMeasurementDto) {
		return this.service.save(req.user, id, { ...dto, replaceExisting: true });
	}
}
