import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmartSharedDocument } from 'entities/smart-document.entity';
import { SmartDocumentController } from './smart-document.controller';
import { SmartDocumentService } from './smart-document.service';

@Module({
	imports: [TypeOrmModule.forFeature([SmartSharedDocument])],
	controllers: [SmartDocumentController],
	providers: [SmartDocumentService],
	exports: [SmartDocumentService],
})
export class SmartDocumentModule {}
