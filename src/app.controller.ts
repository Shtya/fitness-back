import { Controller, Get, Req } from '@nestjs/common';
import { AppService } from './app.service';
import { I18nService } from 'nestjs-i18n';
import { Request } from 'express';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  async getHello() {

    return {
      message : "hello",
    };
  }
}
