import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	CreateWhatsAppContactDto,
	LookupWhatsAppNumberDto,
	MergeWhatsAppContactsDto,
	StartWhatsAppContactChatDto,
	UpdateWhatsAppContactDto,
} from '../dto/whatsapp-contacts.dto';
import { WhatsAppContactsService } from '../services/whatsapp-contacts.service';

@Controller('whatsapp/accounts/:accountId/contacts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppContactsController {
	constructor(private readonly contacts: WhatsAppContactsService) {}

	@Get()
	list(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Query('search') search?: string,
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Query('scope') scope?: string,
	) {
		return this.contacts.list(req.user, accountId, {
			search,
			page: Number(page) || undefined,
			limit: Number(limit) || undefined,
			scope,
		});
	}

	@Get('capabilities')
	capabilities(@Req() req: any, @Param('accountId', ParseUUIDPipe) accountId: string) {
		return this.contacts.capabilities(req.user, accountId);
	}

	@Get('duplicates')
	duplicates(@Req() req: any, @Param('accountId', ParseUUIDPipe) accountId: string) {
		return this.contacts.duplicates(req.user, accountId);
	}

	@Post('lookup')
	lookup(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Body() body: LookupWhatsAppNumberDto,
	) {
		return this.contacts.lookup(req.user, accountId, body);
	}

	@Post('start-chat')
	startChat(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Body() body: StartWhatsAppContactChatDto,
	) {
		return this.contacts.startChat(req.user, accountId, body);
	}

	@Post()
	create(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Body() body: CreateWhatsAppContactDto,
	) {
		return this.contacts.create(req.user, accountId, body);
	}

	@Patch(':contactId')
	update(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Param('contactId', ParseUUIDPipe) contactId: string,
		@Body() body: UpdateWhatsAppContactDto,
	) {
		return this.contacts.update(req.user, accountId, contactId, body);
	}

	@Delete(':contactId')
	remove(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Param('contactId', ParseUUIDPipe) contactId: string,
		@Query('removeFromWhatsApp') removeFromWhatsApp?: string,
	) {
		return this.contacts.remove(req.user, accountId, contactId, {
			removeFromWhatsApp: removeFromWhatsApp === '1' || removeFromWhatsApp === 'true',
		});
	}

	@Post(':contactId/sync')
	sync(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Param('contactId', ParseUUIDPipe) contactId: string,
	) {
		return this.contacts.retrySync(req.user, accountId, contactId);
	}

	@Post(':contactId/merge')
	merge(
		@Req() req: any,
		@Param('accountId', ParseUUIDPipe) accountId: string,
		@Param('contactId', ParseUUIDPipe) contactId: string,
		@Body() body: MergeWhatsAppContactsDto,
	) {
		return this.contacts.merge(req.user, accountId, contactId, body.duplicateIds);
	}
}
