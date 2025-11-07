import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FormService } from './form.service';
import { FormController } from './form.controller';
import { Form, FormField, FormSubmission, User } from 'entities/global.entity';
import { JwtService } from '@nestjs/jwt';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [TypeOrmModule.forFeature([Form, FormField, FormSubmission , User]) , NotificationModule],
  providers: [FormService, JwtService],
  controllers: [FormController],
  exports: [FormService],
})
export class FormModule {}
