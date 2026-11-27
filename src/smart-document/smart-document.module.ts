import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmartDocument, SmartSharedDocument } from 'entities/smart-document.entity';
import { SmartDocumentController } from './smart-document.controller';
import { SmartDocumentService } from './smart-document.service';
import { SmartDocumentStoreService } from './smart-document-store.service';

@Module({
	imports: [TypeOrmModule.forFeature([SmartSharedDocument, SmartDocument])],
	controllers: [SmartDocumentController],
	providers: [SmartDocumentService, SmartDocumentStoreService],
	exports: [SmartDocumentService],
})
export class SmartDocumentModule {}
