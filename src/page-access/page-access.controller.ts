import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '../../entities/global.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UpdateRolePagesDto, UpdateUserPagesDto } from './page-access.dto';
import { PageAccessService } from './page-access.service';

@Controller('page-access')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PageAccessController {
	constructor(private readonly pageAccess: PageAccessService) {}

	@Get('roles')
	listRoles() {
		return this.pageAccess.listRoles();
	}

	@Put('roles/:role')
	replaceRole(@Param('role') role: string, @Body() dto: UpdateRolePagesDto, @Req() req: any) {
		return this.pageAccess.replaceRole(role, dto.modes, req.user.id);
	}

	@Get('users/:id')
	getUser(@Param('id', ParseUUIDPipe) id: string) {
		return this.pageAccess.getUser(id);
	}

	@Put('users/:id')
	setUser(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserPagesDto, @Req() req: any) {
		return this.pageAccess.setUser(id, dto, req.user.id);
	}
}
