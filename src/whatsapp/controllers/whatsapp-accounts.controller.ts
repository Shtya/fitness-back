import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Put,
	Req,
	UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../../entities/global.entity';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	CreateWhatsAppAccountDto,
	UpdateWhatsAppAccountAccessDto,
	UpdateWhatsAppPrivacySettingsDto,
} from '../dto/whatsapp.dto';
import { WhatsAppAccountsService } from '../services/whatsapp-accounts.service';

@Controller('whatsapp/accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppAccountsController {
	constructor(private readonly accounts: WhatsAppAccountsService) {}

	@Get()
	list(@Req() req: any) {
		return this.accounts.list(req.user);
	}

	@Get('staff')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	listStaff(@Req() req: any) {
		return this.accounts.listEligibleStaff(req.user);
	}

	@Post()
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	create(@Req() req: any, @Body() body: CreateWhatsAppAccountDto) {
		return this.accounts.create(req.user, body);
	}

	@Delete(':accountId')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	remove(@Req() req: any, @Param('accountId') accountId: string) {
		return this.accounts.remove(req.user, accountId);
	}

	@Post(':accountId/reset-data')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	resetData(@Req() req: any, @Param('accountId') accountId: string) {
		return this.accounts.resetData(req.user, accountId);
	}

	@Get(':accountId/access')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	getAccess(@Req() req: any, @Param('accountId') accountId: string) {
		return this.accounts.getAccess(req.user, accountId);
	}

	@Put(':accountId/access')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	replaceAccess(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: UpdateWhatsAppAccountAccessDto,
	) {
		return this.accounts.replaceAccess(req.user, accountId, body.access);
	}

	@Get(':accountId/privacy')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	getPrivacySettings(@Req() req: any, @Param('accountId') accountId: string) {
		return this.accounts.getPrivacySettings(req.user, accountId);
	}

	@Put(':accountId/privacy')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	updatePrivacySettings(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: UpdateWhatsAppPrivacySettingsDto,
	) {
		return this.accounts.updatePrivacySettings(req.user, accountId, body);
	}
}
