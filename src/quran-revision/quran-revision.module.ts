import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuranRevisionState } from 'entities/quran-revision.entity';
import { QuranRevisionController } from './quran-revision.controller';
import { QuranRevisionService } from './quran-revision.service';

@Module({
	imports: [TypeOrmModule.forFeature([QuranRevisionState])],
	controllers: [QuranRevisionController],
	providers: [QuranRevisionService],
	exports: [QuranRevisionService],
})
export class QuranRevisionModule {}
