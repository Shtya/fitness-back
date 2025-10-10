import { Body, Controller, Get, Post, Put, Delete, Param, UseGuards, Patch, Req, Query } from '@nestjs/common';
import { FormService } from './form.service';
import { CreateFormDto, UpdateFormDto, SubmitFormDto, ReorderFieldsDto } from './form.dto';

 
@Controller('forms')
export class FormController {
  constructor(private readonly formService: FormService) {}

  // Coach endpoints (protected)
  @Post()
  async createForm(@Body() dto: CreateFormDto) {
    return this.formService.createForm(dto);
  }

  @Patch()
  async updateForm(@Body() dto: UpdateFormDto) {
    return this.formService.updateForm(dto);
  }

  @Get()
  async getAllForms(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.formService.getAllForms(+page, +limit);
  }

  @Get(':id')
  async getFormById(@Param('id') id: string) {
    return this.formService.getFormById(+id);
  }

  @Delete(':id')
  async deleteForm(@Param('id') id: string) {
    return this.formService.deleteForm(+id);
  }

  @Post(':id/fields')
  async addFieldToForm(@Param('id') formId: string, @Body() dto: any) {
    return this.formService.addFieldsToForm(+formId, dto);
  }

  @Delete(':formId/fields/:fieldId')
  async deleteFieldFromForm(@Param('formId') formId: string, @Param('fieldId') fieldId: string) {
    return this.formService.deleteFieldFromForm(+formId, +fieldId);
  }

  @Patch('re-order')
  async updateFieldOrders(@Body() dto: ReorderFieldsDto) {
    return this.formService.updateFieldOrders(dto);
  }

  @Get(':id/submissions')
  async getFormSubmissions(@Param('id') id: string, @Query('page') page = 1, @Query('limit') limit = 10) {
    return this.formService.getFormSubmissions(+id, +page, +limit);
  }

  // Public endpoints (no auth required for form submission)
  @Get(':id/public')
  async getFormByIdPublic(@Param('id') id: string) {
    return this.formService.getFormById(+id);
  }

  @Post(':id/submit')
  async submitForm(@Param('id') id: string, @Body() dto: SubmitFormDto, @Req() req: any) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    return this.formService.submitForm(+id, dto, ipAddress);
  }
}
