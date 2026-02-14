/* 

*/

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Form, FormField, FormSubmission, NotificationAudience, NotificationType } from 'entities/global.entity';
import { CreateFormDto, UpdateFormDto, SubmitFormDto, ReorderFieldsDto } from './form.dto';
import { NotificationService } from 'src/notification/notification.service';
import { User, UserRole } from 'entities/global.entity';

type Requester = { id: string; role: UserRole, adminId?: string | null };

@Injectable()
export class FormService {
	constructor(
		@InjectRepository(Form)
		private readonly formRepository: Repository<Form>,
		@InjectRepository(FormField)
		private readonly fieldRepository: Repository<FormField>,
		@InjectRepository(FormSubmission)
		private readonly submissionRepository: Repository<FormSubmission>,
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		private readonly notificationService: NotificationService,
	) { }

	private isSuper(r: Requester) {
		return r?.role === UserRole.SUPER_ADMIN;
	}

	private async ensureCanMutateForm(formId: number, requester: Requester): Promise<Form> {
		const form = await this.formRepository.findOne({ where: { id: formId } });
		if (!form) throw new NotFoundException('Form not found');

		if (!this.isSuper(requester)) {
			// non-super cannot mutate global (adminId null) nor others' forms
			if (!form.adminId || form.adminId !== requester.id) {
				throw new ForbiddenException('Not allowed');
			}
		}
		return form;
	}

	private async ensureCanReadForm(formId: number, requester: Requester): Promise<Form> {
		const form = await this.formRepository.findOne({ where: { id: formId } });
		if (!form) throw new NotFoundException('Form not found');
 
		return form;
	}

	// ============ Create/Update/Delete Forms ============

	async createForm(dto: CreateFormDto, requester: Requester): Promise<Form> {
		const form = this.formRepository.create({
			title: dto.title,
			adminId: this.isSuper(requester) ? null : requester.id,  
		});
		const savedForm = await this.formRepository.save(form);

		const fields = (dto.fields || []).map(fieldDto =>
			this.fieldRepository.create({
				...fieldDto,
				form: savedForm,
			}),
		);

		savedForm.fields = await this.fieldRepository.save(fields);
		return savedForm;
	}

	async updateForm(dto: any, requester: Requester): Promise<Form> {
		const form = await this.ensureCanMutateForm(dto.id, requester);

		form.title = dto.title;

		// كل field داخل dto لازم يبقى موجود علشان نحدثه
		for (const fieldDto of dto.fields) {
			if (!fieldDto.id) {
				throw new BadRequestException('Each field must have an id for update');
			}
		}

		const existing = await this.fieldRepository.find({ where: { form: { id: form.id } } });
		const updatedFields = [];
		for (const fieldDto of dto.fields) {
			const old = existing.find(f => f.id === (fieldDto as any).id);
			if (!old) {
				throw new NotFoundException(`Field with id ${(fieldDto as any).id} not found in this form`);
			}
			Object.assign(old, fieldDto);
			updatedFields.push(await this.fieldRepository.save(old));
		}

		form.fields = updatedFields;
		return await this.formRepository.save(form);
	}

	async getAllForms(page = 1, limit = 10, requester: Requester, includeGlobal = true) {

		console.log(requester);
		const skip = (page - 1) * limit;

		let where: any;

		if (requester?.role == "coach") {
			where = [{ adminId: requester.id },
			{ adminId: requester.adminId }, { adminId: IsNull() }]
		} else {
			if (this.isSuper(requester)) {
				where = includeGlobal ? {} : { adminId: Not(IsNull()) };
			} else {
				where = includeGlobal ? [{ adminId: requester.id }, { adminId: IsNull() }] : { adminId: requester.id };
			}

		}

		const [results, total] = await this.formRepository.findAndCount({
			where,
			relations: ['fields'],
			skip,
			take: limit,
			order: { created_at: 'DESC' },
		});

		return {
			data: results,
			total,
			page,
			last_page: Math.ceil(total / limit),
		};
	}

	async getFormById(id: number): Promise<Form> {
		const form = await this.formRepository.findOne({
			where: { id },
			relations: ['fields'],
		});
		if (!form) throw new NotFoundException('Form not found');
		return form;
	}

	async getFormByIdScoped(id: number, requester: Requester): Promise<Form> {
		await this.ensureCanReadForm(id, requester);
		return this.getFormById(id);
	}

	async deleteForm(id: number, requester: Requester): Promise<{ message: string }> {
		await this.ensureCanMutateForm(id, requester);
		const result = await this.formRepository.delete(id);
		if (result.affected === 0) throw new NotFoundException('Form not found');
		return { message: 'Form deleted successfully' };
	}

	async addFieldsToForm(formId: number, dto: any, requester: Requester) {
		await this.ensureCanMutateForm(formId, requester);
		const form = await this.formRepository.findOne({ where: { id: formId } });
		if (!form) throw new NotFoundException('Form not found');

		const fields = (dto.fields || []).map((field: any) =>
			this.fieldRepository.create({
				label: field.label,
				key: field.key,
				type: field.type,
				placeholder: field.placeholder,
				required: !!field.required,
				options: field.options,
				order: field.order,
				form,
			}),
		);

		return this.fieldRepository.save(fields);
	}

	async deleteFieldFromForm(formId: number, fieldId: number, requester: Requester): Promise<{ message: string }> {
		await this.ensureCanMutateForm(formId, requester);

		const field = await this.fieldRepository.findOne({
			where: { id: fieldId, form: { id: formId } },
			relations: ['form'],
		});

		if (!field) throw new NotFoundException('Field not found in this form');

		await this.fieldRepository.delete(fieldId);
		return { message: `Field ${fieldId} deleted from form ${formId}` };
	}

	async updateFieldOrders(dto: ReorderFieldsDto, requester: Requester): Promise<{ message: string }> {
		// نتأكد إن كل الحقول دي تخص نفس الأدمن (أو سوبر)
		const ids = dto.fields.map(f => f.id);
		const fields = await this.fieldRepository.find({
			where: { id: In(ids) },
			relations: ['form'],
		});

		if (!fields.length) return { message: 'Field orders updated successfully' };

		// لو مش سوبر، اتأكد إن كل forms ملكه ومش global
		if (!this.isSuper(requester)) {
			for (const f of fields) {
				if (!f.form?.adminId || f.form.adminId !== requester.id) {
					throw new ForbiddenException('Not allowed');
				}
			}
		}

		for (const field of dto.fields) {
			await this.fieldRepository.update(field.id, { order: field.order });
		}
		return { message: 'Field orders updated successfully' };
	}

	// ============ Submissions ============

	async submitForm(formId: number, dto: SubmitFormDto, ipAddress: string): Promise<FormSubmission> {
		const form = await this.formRepository.findOne({
			where: { id: formId },
			relations: ['fields'],
		});

		if (!form) {
			throw new NotFoundException('Form not found');
		}

		const submission = this.submissionRepository.create({
			form,
			email: dto.email,
			phone: dto.phone,
			ipAddress,
			answers: dto.answers,
		});
		const saved = await this.submissionRepository.save(submission);

		// إشعار للإدارة
		this.notificationService
			.create({
				type: NotificationType.FORM_SUBMISSION,
				title: `New submission on "${form.title}"`,
				message: `Email: ${dto.email} | Phone: ${dto.phone}`,
				data: {
					formId: form.id,
					formTitle: form.title,
					submissionId: saved.id,
					email: dto.email,
					phone: dto.phone,
					ipAddress,
				},
				audience: NotificationAudience.ADMIN,
			})
			.catch(() => { });

		return saved;
	}

	async getFormSubmissionsScoped(
		formId: number,
		page = 1,
		limit = 10,
		requester: Requester,
		assignedTo?: string, // ✅ NEW
	) {
		const form = await this.ensureCanReadForm(formId, requester);

		const where: any = { form: { id: form.id } };

		if (assignedTo) {
			where.assignedToId = assignedTo; // ✅ filter
		}

		const [results, total] = await this.submissionRepository.findAndCount({
			where,
			relations: ['form', 'assignedTo'],
			skip: (page - 1) * limit,
			take: limit,
			order: { created_at: 'DESC' },
		});

		return {
			data: results,
			total,
			page,
			last_page: Math.ceil(total / limit),
		};
	}


	async assignSubmission(formId: number, submissionId: number, userId: string, requester: Requester): Promise<FormSubmission> {
		// لازم الأدمن يكون يقدر يدير الفورم ده
		await this.ensureCanMutateForm(formId, requester);

		const submission = await this.submissionRepository.findOne({
			where: { id: submissionId, form: { id: formId } },
			relations: ['form', 'assignedTo'],
		});
		if (!submission) throw new NotFoundException('Submission not found');

		const user = await this.userRepository.findOne({ where: { id: userId } });
		if (!user) throw new NotFoundException('User not found');

		submission.assignedTo = user;
		submission.assignedToId = user.id;
		submission.assignedAt = new Date();

		return this.submissionRepository.save(submission);
	}







	async submitFormMultipart(
		formId: number,
		dto: SubmitFormDto,
		ipAddress: string,
		files: any[],
		reportTo?: string, // ✅ NEW
	): Promise<FormSubmission> {
		const form = await this.formRepository.findOne({
			where: { id: formId },
			relations: ['fields'],
		});
		if (!form) throw new NotFoundException('Form not found');

		const fileMap: Record<string, any[]> = {};
		for (const f of files || []) {
			if (!fileMap[f.fieldname]) fileMap[f.fieldname] = [];
			fileMap[f.fieldname].push(f);
		}

		const finalAnswers: Record<string, any> = { ...(dto.answers || {}) };

		for (const field of form.fields || []) {
			if (field.type === 'file') {
				const uploadedList = fileMap[field.key] || [];

				if (uploadedList.length) {
					finalAnswers[field.key] = uploadedList.map(
						(f) => `/uploads/forms/${f.filename}`,
					);
				} else {
					finalAnswers[field.key] = Array.isArray(finalAnswers[field.key])
						? finalAnswers[field.key]
						: [];
				}
			}
		}

		const submission = this.submissionRepository.create({
			form,
			email: dto.email,
			phone: dto.phone,
			ipAddress,
			answers: finalAnswers,
		});

		const saved = await this.submissionRepository.save(submission);

		if (reportTo) {
			const user = await this.userRepository.findOne({ where: { id: reportTo } });
			if (!user) {
				throw new NotFoundException('report_to user not found');
			}

			saved.assignedTo = user;
			saved.assignedToId = user.id;
			saved.assignedAt = new Date();

			await this.submissionRepository.save(saved);
		}


		this.notificationService
			.create({
				type: NotificationType.FORM_SUBMISSION,
				title: `New submission on "${form.title}"`,
				message: `Email: ${dto.email} | Phone: ${dto.phone}`,
				data: {
					formId: form.id,
					formTitle: form.title,
					submissionId: saved.id,
					email: dto.email,
					phone: dto.phone,
					ipAddress,
				},
				audience: NotificationAudience.ADMIN,
			})
			.catch(() => { });

		return saved;
	}


}
