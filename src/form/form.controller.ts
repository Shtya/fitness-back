import { Body, Controller, Get, Post, Put, Delete, Param, UseGuards, Patch, Req, Query, UploadedFiles, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FormService } from './form.service';
import { CreateFormDto, UpdateFormDto, SubmitFormDto, ReorderFieldsDto, AssignSubmissionDto } from './form.dto';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { MultipartLoggerInterceptor } from '../../common/MultipartLoggerInterceptor';
import { isUUID } from 'class-validator';

function safeName(name: string) {
	return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Controller('forms')
export class FormController {
	constructor(private readonly formService: FormService) { }

	// ============ Admin/Coach (Protected) ============

	@UseGuards(JwtAuthGuard)
	@Post()
	async createForm(@Body() dto: CreateFormDto, @Req() req: any) {
		return this.formService.createForm(dto, { id: req.user.id, role: req.user.role });
	}

	@UseGuards(JwtAuthGuard)
	@Patch()
	async updateForm(@Body() dto: UpdateFormDto, @Req() req: any) {
		return this.formService.updateForm(dto, { id: req.user.id, role: req.user.role });
	}

	@UseGuards(JwtAuthGuard)
	@Get()
	async getAllForms(@Query('page') page = 1, @Query('limit') limit = 10, @Query('includeGlobal') includeGlobal: 'true' | 'false' = 'true', @Req() req: any) {
		return this.formService.getAllForms(+page, +limit, { ...req.user, id: req.user.id, role: req.user.role }, includeGlobal === 'true');
	}

	@UseGuards(JwtAuthGuard)
	@Get(':id')
	async getFormById(@Param('id') id: string, @Req() req: any) {
		return this.formService.getFormByIdScoped(+id, { id: req.user.id, role: req.user.role });
	}

	@UseGuards(JwtAuthGuard)
	@Delete(':id')
	async deleteForm(@Param('id') id: string, @Req() req: any) {
		return this.formService.deleteForm(+id, { id: req.user.id, role: req.user.role });
	}

	@UseGuards(JwtAuthGuard)
	@Post(':id/fields')
	async addFieldToForm(@Param('id') formId: string, @Body() dto: any, @Req() req: any) {
		return this.formService.addFieldsToForm(+formId, dto, { id: req.user.id, role: req.user.role });
	}

	@UseGuards(JwtAuthGuard)
	@Delete(':formId/fields/:fieldId')
	async deleteFieldFromForm(@Param('formId') formId: string, @Param('fieldId') fieldId: string, @Req() req: any) {
		return this.formService.deleteFieldFromForm(+formId, +fieldId, { id: req.user.id, role: req.user.role });
	}

	@UseGuards(JwtAuthGuard)
	@Patch('re-order')
	async updateFieldOrders(@Body() dto: ReorderFieldsDto, @Req() req: any) {
		return this.formService.updateFieldOrders(dto, { id: req.user.id, role: req.user.role });
	}

	@UseGuards(JwtAuthGuard)
	@Get(':id/submissions')
	async getFormSubmissions(
		@Param('id') id: string,
		@Query('page') page = 1,
		@Query('limit') limit = 10,
		@Req() req: any,
		@Query('assignedTo') assignedTo?: string,
	) {
		return this.formService.getFormSubmissionsScoped(
			+id,
			+page,
			+limit,
			{ id: req.user.id, role: req.user.role },
			req.user.id,
		);
	}


	// ⬇️ تعيين submission لمستخدم
	@UseGuards(JwtAuthGuard)
	@Post(':formId/submissions/:submissionId/assign')
	async assignSubmission(@Param('formId') formId: string, @Param('submissionId') submissionId: string, @Body() body: AssignSubmissionDto, @Req() req: any) {
		return this.formService.assignSubmission(+formId, +submissionId, body.userId, { id: req.user.id, role: req.user.role });
	}

	// ============ Public (submission) ============

	@Get(':id/public')
	async getFormByIdPublic(@Param('id') id: string) {
		return this.formService.getFormById(+id); // public view allows any form
	}

	@Post(':id/submit')
	@UseInterceptors(
		AnyFilesInterceptor({
			storage: diskStorage({
				destination: './uploads/forms',
				filename: (req, file, cb) => {
					const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
					const ext = extname(file.originalname || '');
					cb(null, `${safeName(file.fieldname)}-${unique}${ext}`);
				},
			}),
			limits: {
				fileSize: 25 * 1024 * 1024, // 25MB
				files: 10,
			}

		}),
		MultipartLoggerInterceptor,
	)
	async submitForm(
		@Param('id') id: string,
		@UploadedFiles() files: any[],
		@Body() body: any,
		@Req() req: any,
		@Query('report_to') reportTo?: string,
	) {
		const ipAddress = req.ip || req.connection?.remoteAddress || '';

		// body.answers comes as string in multipart
		const answers = typeof body.answers === 'string' ? JSON.parse(body.answers) : (body.answers || {});
		const dto = {
			email: body.email,
			phone: body.phone,
			answers,
		};

		if (reportTo && !isUUID(reportTo)) {
			throw new BadRequestException('Please review the form using the link again.');
		}

		return this.formService.submitFormMultipart(+id, dto, ipAddress, files || [], reportTo);
	}
}
