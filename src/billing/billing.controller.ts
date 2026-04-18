// src/modules/billing/billing.controller.ts
import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	Delete,
	Query,
} from '@nestjs/common';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
	constructor(private readonly billingService: BillingService) { }

	/* =========================================================
	 * Plans
	 * ======================================================= */

	@Post('plans')
	createPlan(@Body() dto: any) {
		return this.billingService.createPlan(dto);
	}

	@Get('plans')
	getPlans(@Query() query: any) {
		return this.billingService.getPlans(query);
	}

	@Get('plans/:id')
	getPlan(@Param('id') id: string) {
		return this.billingService.findPlanById(id);
	}

	@Patch('plans/:id')
	updatePlan(@Param('id') id: string, @Body() dto: any) {
		return this.billingService.updatePlan(id, dto);
	}

	@Delete('plans/:id')
	removePlan(@Param('id') id: string) {
		return this.billingService.removePlan(id);
	}

	/* =========================================================
	 * Subscriptions
	 * ======================================================= */

	@Post('subscriptions')
	createSubscription(@Body() dto: any) {
		return this.billingService.createSubscription(dto);
	}

	@Get('subscriptions')
	getSubscriptions(@Query() query: any) {
		return this.billingService.getSubscriptions(query);
	}

	@Get('subscriptions/:id')
	getSubscription(@Param('id') id: string) {
		return this.billingService.findSubscriptionById(id);
	}

	@Patch('subscriptions/:id')
	updateSubscription(@Param('id') id: string, @Body() dto: any) {
		return this.billingService.updateSubscription(id, dto);
	}

	@Patch('subscriptions/:id/cancel')
	cancelSubscription(
		@Param('id') id: string,
		@Body() dto: any,
	) {
		return this.billingService.cancelSubscription(id, dto.reason);
	}

	@Get('users/:userId/current-subscription')
	getCurrentSubscription(@Param('userId') userId: string) {
		return this.billingService.getCurrentSubscription(userId);
	}

	/* =========================================================
	 * Invoices
	 * ======================================================= */

	@Post('invoices')
	createInvoice(@Body() dto: any) {
		return this.billingService.createInvoice(dto);
	}

	@Get('invoices')
	getInvoices(@Query() query: any) {
		return this.billingService.getInvoices(query);
	}

	@Get('invoices/:id')
	getInvoice(@Param('id') id: string) {
		return this.billingService.findInvoiceById(id);
	}

	@Patch('invoices/:id')
	updateInvoice(@Param('id') id: string, @Body() dto: any) {
		return this.billingService.updateInvoice(id, dto);
	}

	@Patch('invoices/:id/mark-paid')
	markInvoicePaid(@Param('id') id: string) {
		return this.billingService.markInvoicePaid(id);
	}

	/* =========================================================
	 * Payments
	 * ======================================================= */

	@Post('payments')
	createPayment(@Body() dto: any) {
		return this.billingService.createPayment(dto);
	}

	@Get('payments')
	getPayments(@Query() query: any) {
		return this.billingService.getPayments(query);
	}

	@Get('payments/:id')
	getPayment(@Param('id') id: string) {
		return this.billingService.findPaymentById(id);
	}

	@Patch('payments/:id')
	updatePayment(@Param('id') id: string, @Body() dto: any) {
		return this.billingService.updatePayment(id, dto);
	}

	/* =========================================================
	 * Stats
	 * ======================================================= */

	@Get('stats/overview')
	getStats(@Query() query: any) {
		return this.billingService.getStats(query);
	}

	/* =========================================================
	 * Coach Client Management
	 * ======================================================= */

	@Get('clients')
	getClients(@Query() query: any) {
		return this.billingService.getClients(query);
	}

	@Get('clients/:id')
	getClientById(@Param('id') id: string) {
		return this.billingService.getClientById(id);
	}

	@Get('clients/:id/timeline')
	getClientTimeline(@Param('id') id: string, @Query() query: any) {
		return this.billingService.getClientTimeline(id, query);
	}

	@Get('clients/:id/progress')
	getClientProgress(@Param('id') id: string) {
		return this.billingService.getClientProgress(id);
	}

	@Get('clients/:id/checkins')
	getClientCheckins(@Param('id') id: string) {
		return this.billingService.getClientCheckins(id);
	}

	@Get('clients/:id/notes')
	getClientNotes(@Param('id') id: string) {
		return this.billingService.getClientNotes(id);
	}

	@Post('clients/:id/notes')
	createClientNote(@Param('id') id: string, @Body() dto: any) {
		return this.billingService.createClientNote(id, dto);
	}

	@Patch('clients/:id/notes/:noteId')
	updateClientNote(@Param('id') id: string, @Param('noteId') noteId: string, @Body() dto: any) {
		return this.billingService.updateClientNote(id, noteId, dto);
	}

	@Delete('clients/:id/notes/:noteId')
	deleteClientNote(@Param('id') id: string, @Param('noteId') noteId: string) {
		return this.billingService.deleteClientNote(id, noteId);
	}

	@Get('clients/:id/plans-history')
	getClientPlansHistory(@Param('id') id: string) {
		return this.billingService.getClientPlansHistory(id);
	}

	@Get('clients/:id/communications')
	getClientCommunications(@Param('id') id: string) {
		return this.billingService.getClientCommunications(id);
	}

	@Post('clients/:id/communications/send')
	sendClientCommunications(@Param('id') id: string, @Body() dto: any) {
		return this.billingService.sendClientCommunication(id, dto);
	}
}