import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Form, FormField, FormSubmission, NotificationAudience, NotificationType } from 'entities/global.entity';
import { CreateFormDto, UpdateFormDto, SubmitFormDto, ReorderFieldsDto } from './form.dto';
import { NotificationService } from 'src/notification/notification.service';

@Injectable()
export class FormService {
  constructor(
    @InjectRepository(Form)
    private readonly formRepository: Repository<Form>,
    @InjectRepository(FormField)
    private readonly fieldRepository: Repository<FormField>,
    @InjectRepository(FormSubmission)
    private readonly submissionRepository: Repository<FormSubmission>,
    private readonly notificationService: NotificationService,
  ) {}

  async createForm(dto: CreateFormDto): Promise<Form> {
    const form = this.formRepository.create({
      title: dto.title,
    });
    const savedForm = await this.formRepository.save(form);

    const fields = dto.fields.map(fieldDto =>
      this.fieldRepository.create({
        ...fieldDto,
        form: savedForm,
      }),
    );

    savedForm.fields = await this.fieldRepository.save(fields);
    return savedForm;
  }

  async updateForm(dto: any): Promise<Form> {
    const form = await this.formRepository.findOne({
      where: { id: dto.id },
      relations: ['fields'],
    });

    if (!form) {
      throw new NotFoundException('Form not found');
    }

    form.title = dto.title;

    for (const fieldDto of dto.fields) {
      if (!fieldDto.id) {
        throw new BadRequestException('Each field must have an id');
      }
    }

    const updatedFields = [];
    for (const fieldDto of dto.fields) {
      const existingField = form.fields.find(f => f.id === fieldDto.id);
      if (!existingField) {
        throw new NotFoundException(`Field with id ${fieldDto.id} not found in this form`);
      }
      Object.assign(existingField, fieldDto);
      updatedFields.push(await this.fieldRepository.save(existingField));
    }

    form.fields = updatedFields;
    return await this.formRepository.save(form);
  }

  async getAllForms(page = 1, limit = 10) {
    const [results, total] = await this.formRepository.findAndCount({
      relations: ['fields'],
      skip: (page - 1) * limit,
      take: limit,
      order: {
        created_at: 'DESC',
      },
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

  async deleteForm(id: number): Promise<{ message: string }> {
    const result = await this.formRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException('Form not found');
    }
    return { message: 'Form deleted successfully' };
  }

  async addFieldsToForm(formId: number, dto: any) {
    const form = await this.formRepository.findOne({ where: { id: formId } });
    if (!form) throw new NotFoundException('Form not found');

    const fields = dto.fields.map(field => {
      return this.fieldRepository.create({
        label: field.label,
        key: field.key,
        type: field.type,
        placeholder: field.placeholder,
        required: field.required,
        options: field.options,
        order: field.order,
        form,
      });
    });

    return this.fieldRepository.save(fields);
  }

  async deleteFieldFromForm(formId: number, fieldId: number): Promise<{ message: string }> {
    const form = await this.formRepository.findOne({
      where: { id: formId },
      relations: ['fields'],
    });

    if (!form) throw new NotFoundException('Form not found');

    const field = form.fields.find(f => f.id === fieldId);
    if (!field) throw new NotFoundException('Field not found in this form');

    await this.fieldRepository.delete(fieldId);
    return { message: `Field ${fieldId} deleted from form ${formId}` };
  }

  async updateFieldOrders(dto: ReorderFieldsDto): Promise<{ message: string }> {
    for (const field of dto.fields) {
      await this.fieldRepository.update(field.id, { order: field.order });
    }
    return { message: 'Field orders updated successfully' };
  }

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

    // fire-and-forget notification (don’t block user if it fails)
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
      .catch(err => {
        // log and ignore, so submission succeeds anyway
        console.error('Failed to create notification:', err?.message || err);
      });

    return saved;
  }

  // async submitForm(formId: number, dto: SubmitFormDto, ipAddress: string): Promise<FormSubmission> {
  //   const form = await this.formRepository.findOne({
  //     where: { id: formId },
  //     relations: ['fields'],
  //   });

  //   if (!form) {
  //     throw new NotFoundException('Form not found');
  //   }

  //   const submission = this.submissionRepository.create({
  //     form,
  //     email: dto.email,
  //     phone: dto.phone,
  //     ipAddress,
  //     answers: dto.answers,
  //   });

  //   return await this.submissionRepository.save(submission);
  // }

  async getFormSubmissions(formId: number, page = 1, limit = 10) {
    const [results, total] = await this.submissionRepository.findAndCount({
      where: { form: { id: formId } },
      relations: ['form'],
      skip: (page - 1) * limit,
      take: limit,
      order: {
        created_at: 'DESC',
      },
    });

    return {
      data: results,
      total,
      page,
      last_page: Math.ceil(total / limit),
    };
  }

  async getSubmissionById(id: number): Promise<FormSubmission> {
    const submission = await this.submissionRepository.findOne({
      where: { id },
      relations: ['form'],
    });
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }
}
