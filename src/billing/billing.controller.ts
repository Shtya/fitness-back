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
}