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

import { UserRole } from '../../entities/global.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { BillingService } from './billing.service';
import { CreatePlanDto, RecordPaymentDto, UpdatePlanDto } from './dto/billing.dto';

/** Money and packages are gym-owner actions; coaches keep read access to their own clients. */
const MONEY_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.COACH)
export class BillingController {
	constructor(private readonly billingService: BillingService) { }

	/* =========================================================
	 * Plans
	 * ======================================================= */

	@Post('plans')
	@Roles(...MONEY_ROLES)
	createPlan(@Body() dto: CreatePlanDto, @Req() req: any) {
		return this.billingService.createPlan(dto, req.user);
	}

	@Get('plans')
	getPlans(@Query() query: any, @Req() req: any) {
		return this.billingService.getPlans(query, req.user);
	}

	@Get('plans/:id')
	getPlan(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.findPlanById(id, req.user);
	}

	@Patch('plans/:id')
	@Roles(...MONEY_ROLES)
	updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto, @Req() req: any) {
		return this.billingService.updatePlan(id, dto, req.user);
	}

	@Delete('plans/:id')
	@Roles(...MONEY_ROLES)
	removePlan(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.removePlan(id, req.user);
	}

	/* =========================================================
	 * Subscriptions
	 * ======================================================= */

	@Post('subscriptions')
	@Roles(...MONEY_ROLES)
	createSubscription(@Body() dto: any, @Req() req: any) {
		return this.billingService.createSubscription(dto, req.user);
	}

	@Get('subscriptions')
	getSubscriptions(@Query() query: any, @Req() req: any) {
		return this.billingService.getSubscriptions(query, req.user);
	}

	@Get('subscriptions/:id')
	getSubscription(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.findSubscriptionById(id, req.user);
	}

	@Patch('subscriptions/:id')
	@Roles(...MONEY_ROLES)
	updateSubscription(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any, @Req() req: any) {
		return this.billingService.updateSubscription(id, dto, req.user);
	}

	@Patch('subscriptions/:id/cancel')
	@Roles(...MONEY_ROLES)
	cancelSubscription(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any, @Req() req: any) {
		return this.billingService.cancelSubscription(id, dto?.reason, req.user);
	}

	@Get('users/:userId/current-subscription')
	getCurrentSubscription(@Param('userId', ParseUUIDPipe) userId: string, @Req() req: any) {
		return this.billingService.getCurrentSubscription(userId, req.user);
	}

	/* =========================================================
	 * Invoices
	 * ======================================================= */

	@Post('invoices')
	@Roles(...MONEY_ROLES)
	createInvoice(@Body() dto: any, @Req() req: any) {
		return this.billingService.createInvoice(dto, req.user);
	}

	@Get('invoices')
	getInvoices(@Query() query: any, @Req() req: any) {
		return this.billingService.getInvoices(query, req.user);
	}

	@Get('invoices/:id')
	getInvoice(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.findInvoiceById(id, req.user);
	}

	@Patch('invoices/:id')
	@Roles(...MONEY_ROLES)
	updateInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any, @Req() req: any) {
		return this.billingService.updateInvoice(id, dto, req.user);
	}

	@Patch('invoices/:id/mark-paid')
	@Roles(...MONEY_ROLES)
	markInvoicePaid(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.markInvoicePaid(id, req.user);
	}

	/* =========================================================
	 * Payments
	 * ======================================================= */

	/** Records a received payment and, when it covers a period, extends the client's subscription. */
	@Post('payments/record')
	@Roles(...MONEY_ROLES)
	recordPayment(@Body() dto: RecordPaymentDto, @Req() req: any) {
		return this.billingService.recordPayment(dto, req.user);
	}

	@Post('payments')
	@Roles(...MONEY_ROLES)
	createPayment(@Body() dto: any, @Req() req: any) {
		return this.billingService.createPayment(dto, req.user);
	}

	@Get('payments')
	getPayments(@Query() query: any, @Req() req: any) {
		return this.billingService.getPayments(query, req.user);
	}

	@Get('payments/:id')
	getPayment(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.findPaymentById(id, req.user);
	}

	@Patch('payments/:id')
	@Roles(...MONEY_ROLES)
	updatePayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any, @Req() req: any) {
		return this.billingService.updatePayment(id, dto, req.user);
	}

	/** Deletes a payment and rolls back the subscription period it added (if still current). */
	@Delete('payments/:id')
	@Roles(...MONEY_ROLES)
	deletePayment(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.deletePayment(id, req.user);
	}

	/* =========================================================
	 * Stats
	 * ======================================================= */

	@Get('stats/overview')
	getStats(@Req() req: any) {
		return this.billingService.getStats(req.user);
	}

	/* =========================================================
	 * Coach Client Management
	 * ======================================================= */

	@Get('clients')
	getClients(@Query() query: any, @Req() req: any) {
		return this.billingService.getClients(query, req.user);
	}

	@Get('clients/:id')
	getClientById(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.getClientById(id, req.user);
	}

	@Get('clients/:id/timeline')
	getClientTimeline(@Param('id', ParseUUIDPipe) id: string, @Query() query: any, @Req() req: any) {
		return this.billingService.getClientTimeline(id, query, req.user);
	}

	@Get('clients/:id/progress')
	getClientProgress(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.getClientProgress(id, req.user);
	}

	@Get('clients/:id/checkins')
	getClientCheckins(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.getClientCheckins(id, req.user);
	}

	@Get('clients/:id/notes')
	getClientNotes(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.getClientNotes(id, req.user);
	}

	@Post('clients/:id/notes')
	createClientNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any, @Req() req: any) {
		return this.billingService.createClientNote(id, dto, req.user);
	}

	@Patch('clients/:id/notes/:noteId')
	updateClientNote(
		@Param('id', ParseUUIDPipe) id: string,
		@Param('noteId', ParseUUIDPipe) noteId: string,
		@Body() dto: any,
		@Req() req: any,
	) {
		return this.billingService.updateClientNote(id, noteId, dto, req.user);
	}

	@Delete('clients/:id/notes/:noteId')
	deleteClientNote(@Param('id', ParseUUIDPipe) id: string, @Param('noteId', ParseUUIDPipe) noteId: string, @Req() req: any) {
		return this.billingService.deleteClientNote(id, noteId, req.user);
	}

	@Get('clients/:id/plans-history')
	getClientPlansHistory(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.getClientPlansHistory(id, req.user);
	}

	@Get('clients/:id/communications')
	getClientCommunications(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.billingService.getClientCommunications(id, req.user);
	}

	@Post('clients/:id/communications/send')
	sendClientCommunications(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any, @Req() req: any) {
		return this.billingService.sendClientCommunication(id, dto, req.user);
	}
}
