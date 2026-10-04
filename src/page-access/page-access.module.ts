import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/global.entity';
import { PageAccessController } from './page-access.controller';
import { RolePageSetting, UserPageOverride } from './page-access.entity';
import { PageAccessService } from './page-access.service';

@Module({
	imports: [TypeOrmModule.forFeature([RolePageSetting, UserPageOverride, User])],
	providers: [PageAccessService],
	controllers: [PageAccessController],
	exports: [PageAccessService],
})
export class PageAccessModule {}
