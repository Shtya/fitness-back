import {
	Body,
	Controller,
	Get,
	Param,
	Put,
	Req,
	UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { AssignWhatsAppConversationDto } from '../dto/whatsapp.dto';
import { WhatsAppAssignmentService } from '../services/whatsapp-assignment.service';

@Controller('whatsapp/conversations/:conversationId/assignment')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppAssignmentsController {
	constructor(private readonly assignments: WhatsAppAssignmentService) {}

	@Put()
	change(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Body() body: AssignWhatsAppConversationDto,
	) {
		return this.assignments.changeAssignment(
			req.user,
			conversationId,
			body.userId,
			body.note,
		);
	}

	@Get('history')
	history(@Req() req: any, @Param('conversationId') conversationId: string) {
		return this.assignments.history(req.user, conversationId);
	}
}
