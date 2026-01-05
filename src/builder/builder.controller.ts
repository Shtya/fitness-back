import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { BuilderService } from './builder.service';

@Controller('builder')
export class BuilderController {
  constructor(private readonly builderService: BuilderService) {}

  // 🔐 Admin
  @Get('project/:tenant')
  getProject(@Param('tenant') tenant: string) {
    return this.builderService.getProject(tenant);
  }

  @Post('save')
  saveDraft(@Body() body: { tenant: string; draftDoc: any }) {
    return this.builderService.saveDraft(body.tenant, body.draftDoc);
  }

  @Post('settings')
  saveSettings(@Body() body: { tenant: string; settings: any }) {
    return this.builderService.saveSettings(body.tenant, body.settings);
  }

  @Post('publish')
  publish(@Body() body: { tenant: string; draftDoc?: any; settings?: any }) {
    return this.builderService.publish(body.tenant, body.draftDoc, body.settings);
  }

  // 🌍 Public
  @Get('site/:domain')
  getSite(
    @Param('domain') domain: string,
    @Query('mode') mode?: string,
  ) {
    return this.builderService.getSite(domain, mode);
  }
}
