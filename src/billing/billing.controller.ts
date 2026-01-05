// --- File: src/billing/billing.controller.ts ---
import {
	Controller,
	Get,
	Post,
	Patch,
	Delete,
	Body,
	Param,
	Query,
	UseGuards,
	Request,
	ForbiddenException,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guard/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
 
@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
	constructor(private billingService: BillingService) { }

	// ============= WALLET ENDPOINTS =============

	@Get('wallet')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async getWallet(@Request() req) {
		const adminId =
			req.user.role === UserRole.SUPER_ADMIN
				? req.query.adminId || req.user.id
				: req.user.id;

		return this.billingService.getWalletBalance(adminId);
	}

	@Get('wallet/:adminId')
	@Roles(UserRole.SUPER_ADMIN)
	async getAdminWallet(@Param('adminId') adminId: string) {
		return this.billingService.getWalletBalance(adminId);
	}

	// ============= TRANSACTION ENDPOINTS =============

	@Post('transactions')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async createTransaction(@Body() dto: any) {
		return this.billingService.createTransaction(dto);
	}

	@Get('transactions')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async getTransactions(@Request() req, @Query() filter: any) {
		const adminId =
			req.user.role === UserRole.SUPER_ADMIN && req.query.adminId
				? (req.query.adminId as string)
				: req.user.id;

		return this.billingService.getTransactions(adminId, filter);
	}

	@Get('transactions/all')
	@Roles(UserRole.SUPER_ADMIN)
	async getAllTransactions(@Query() filter: any) {
		return this.billingService.getSystemTransactions(filter);
	}

	@Get('transactions/:id')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async getTransaction(@Param('id') id: string, @Request() req) {
		// NOTE: keeping your original behavior (it returns admin transactions)
		// If you want single transaction by id, tell me and I will adjust service too.
		return this.billingService.getTransactions(req.user.id);
	}

	// ============= SUBSCRIPTION ENDPOINTS =============

	@Post('subscriptions')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async createSubscription(@Body() dto: any) {
		return this.billingService.createSubscription(dto);
	}

	@Get('subscriptions')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async getSubscription(@Request() req) {
		const adminId =
			req.user.role === UserRole.SUPER_ADMIN && req.query.adminId
				? (req.query.adminId as string)
				: req.user.id;

		return this.billingService.getSubscription(adminId);
	}

	@Post('subscriptions/:id/renew')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async renewSubscription(@Param('id') id: string, @Request() req) {
		// ✅ FIX: service now renews by subscription id
		return this.billingService.renewSubscription(id);
	}

	// ============= WITHDRAWAL ENDPOINTS =============

	@Post('withdrawals/request')
	@Roles(UserRole.ADMIN)
	async requestWithdrawal(@Body() dto: any, @Request() req) {
		if (dto.adminId !== req.user.id) {
			throw new ForbiddenException('Cannot request withdrawal for another admin');
		}
		return this.billingService.requestWithdrawal(dto);
	}

	@Get('withdrawals')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async getWithdrawals(
		@Request() req,
		@Query('status') status?: string,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
	) {
		const adminId =
			req.user.role === UserRole.SUPER_ADMIN && req.query.adminId
				? (req.query.adminId as string)
				: req.user.id;

		const withdrawalStatus = status as any;
		return this.billingService.getWithdrawalRequests(
			adminId,
			withdrawalStatus,
			page,
			limit,
		);
	}

	@Get('withdrawals/all')
	@Roles(UserRole.SUPER_ADMIN)
	async getAllWithdrawals(
		@Query('status') status?: string,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
	) {
		const withdrawalStatus = status as any;
		return this.billingService.getWithdrawalRequests(
			undefined,
			withdrawalStatus,
			page,
			limit,
		);
	}

	@Patch('withdrawals/:id/approve')
	@Roles(UserRole.SUPER_ADMIN)
	async approveWithdrawal(@Param('id') id: string, @Request() req) {
		return this.billingService.approveWithdrawal(id, req.user.id);
	}

	@Patch('withdrawals/:id/reject')
	@Roles(UserRole.SUPER_ADMIN)
	async rejectWithdrawal(
		@Param('id') id: string,
		@Body() dto: any,
		@Request() req,
	) {
		return this.billingService.rejectWithdrawal(
			id,
			dto.rejectionReason,
			req.user.id,
		);
	}

	@Patch('withdrawals/:id/complete')
	@Roles(UserRole.SUPER_ADMIN)
	async completeWithdrawal(@Param('id') id: string, @Request() req) {
		return this.billingService.completeWithdrawal(id, req.user.id);
	}

	// ============= CLIENT PAYMENT ENDPOINTS =============

	@Post('client-payments')
	@Roles(UserRole.ADMIN)
	async recordClientPayment(@Body() dto: any, @Request() req) {
		if (dto.adminId !== req.user.id) {
			throw new ForbiddenException('Cannot record payment for another admin');
		}
		return this.billingService.recordClientPayment(dto);
	}

	@Get('client-payments')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async getClientPayments(@Request() req, @Query() filter: any) {
		const adminId =
			req.user.role === UserRole.SUPER_ADMIN && req.query.adminId
				? (req.query.adminId as string)
				: req.user.id;

		return this.billingService.getClientPayments(adminId, filter);
	}

	@Patch('client-payments/:id/mark-paid')
	@Roles(UserRole.ADMIN)
	async markPaymentAsPaid(@Param('id') id: string, @Request() req) {
		// ✅ better guard: only admin can mark his own payment paid
		return this.billingService.markPaymentAsPaid(id, req.user.id);
	}

	// ✅ NEW: DELETE payment
	@Delete('client-payments/:id')
	@Roles(UserRole.ADMIN)
	async deleteClientPayment(@Param('id') id: string, @Request() req) {
		return this.billingService.deleteClientPayment(id, req.user.id);
	}

	// ============= ANALYTICS ENDPOINTS =============

	@Get('analytics/admin')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async getAdminAnalytics(@Request() req) {
		const adminId =
			req.user.role === UserRole.SUPER_ADMIN && req.query.adminId
				? (req.query.adminId as string)
				: req.user.id;

		return this.billingService.getAdminAnalytics(adminId);
	}

	@Get('analytics/overview')
	@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
	async getAdminOverview(@Request() req) {
		const adminId =
			req.user.role === UserRole.SUPER_ADMIN && req.query.adminId
				? (req.query.adminId as string)
				: req.user.id;

		return this.billingService.getAdminBillingOverview(adminId);
	}

	@Get('analytics/system')
	@Roles(UserRole.SUPER_ADMIN)
	async getSystemAnalytics() {
		return this.billingService.getSystemBillingReport();
	}

	@Get('analytics/wallets')
	@Roles(UserRole.SUPER_ADMIN)
	async getAllWallets(@Query('page') page?: number, @Query('limit') limit?: number) {
		return this.billingService.getAllAdminWallets(page, limit);
	}
}
