import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { MoneyService } from './money.service';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
 

@UseGuards(JwtAuthGuard)
@Controller('money')
export class MoneyController {
	constructor(private readonly moneyService: MoneyService) {}

	private getUserId(req: any): string {
		return req?.user?.id || req?.userId || req?.headers?.['x-user-id'];
	}

	/* =========================================================
	 * Dashboard
	 * ======================================================= */

	@Get('dashboard')
	getDashboard(@Req() req: any, @Query() query: any) {
		const userId = this.getUserId(req);
		return this.moneyService.getDashboard(userId, query?.mode );
	}

	@Get('monthly-summary')
	getMonthlySummary(
		@Req() req: any,
		@Query() query: any,
	) {
		const userId = this.getUserId(req);
		return this.moneyService.getMonthlySummary(userId, query?.from, query?.to, query?.mode);
	}

	/* =========================================================
	 * Wallets
	 * ======================================================= */

	@Post('wallets')
	createWallet(@Req() req: any, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.createWallet(userId, dto);
	}

	@Get('wallets')
	getWallets(@Req() req: any) {
		const userId = this.getUserId(req);
		return this.moneyService.getWallets(userId);
	}

	@Get('wallets/:id')
	getWalletById(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.getWalletById(userId, id);
	}

	@Patch('wallets/:id')
	updateWallet(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.updateWallet(userId, id, dto);
	}

	@Delete('wallets/:id')
	deleteWallet(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.deleteWallet(userId, id);
	}

	/* =========================================================
	 * Income
	 * ======================================================= */

	@Post('income')
	createIncome(@Req() req: any, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.createIncome(userId, dto);
	}

	@Get('income')
	getIncome(@Req() req: any) {
		const userId = this.getUserId(req);
		return this.moneyService.getIncome(userId);
	}

	@Get('income/:id')
	getIncomeById(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.getIncomeById(userId, id);
	}

	@Patch('income/:id')
	updateIncome(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.updateIncome(userId, id, dto);
	}

	@Delete('income/:id')
	deleteIncome(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.deleteIncome(userId, id);
	}

	/* =========================================================
	 * Expenses
	 * ======================================================= */

	@Post('expenses')
	createExpense(@Req() req: any, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.createExpense(userId, dto);
	}

	@Get('expenses')
	getExpenses(@Req() req: any) {
		const userId = this.getUserId(req);
		return this.moneyService.getExpenses(userId);
	}

	@Get('expenses/:id')
	getExpenseById(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.getExpenseById(userId, id);
	}

	@Patch('expenses/:id')
	updateExpense(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.updateExpense(userId, id, dto);
	}

	@Delete('expenses/:id')
	deleteExpense(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.deleteExpense(userId, id);
	}

	/* =========================================================
	 * Commitments
	 * ======================================================= */

	@Post('commitments')
	createCommitment(@Req() req: any, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.createCommitment(userId, dto);
	}

	@Get('commitments')
	getCommitments(@Req() req: any) {
		const userId = this.getUserId(req);
		return this.moneyService.getCommitments(userId);
	}

	@Get('commitments/:id')
	getCommitmentById(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.getCommitmentById(userId, id);
	}

	@Patch('commitments/:id')
	updateCommitment(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.updateCommitment(userId, id, dto);
	}

	@Patch('commitments/:id/toggle-status')
	toggleCommitmentStatus(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.toggleCommitmentStatus(userId, id);
	}

	@Delete('commitments/:id')
	deleteCommitment(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.deleteCommitment(userId, id);
	}

	/* =========================================================
	 * Zakat
	 * ======================================================= */

	@Post('zakat')
	createZakatLog(@Req() req: any, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.createZakatLog(userId, dto);
	}

	@Get('zakat')
	getZakatLogs(@Req() req: any) {
		const userId = this.getUserId(req);
		return this.moneyService.getZakatLogs(userId);
	}

	@Get('zakat/:id')
	getZakatLogById(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.getZakatLogById(userId, id);
	}

	@Patch('zakat/:id')
	updateZakatLog(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.updateZakatLog(userId, id, dto);
	}

	@Delete('zakat/:id')
	deleteZakatLog(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.deleteZakatLog(userId, id);
	}

	/* =========================================================
	 * Notifications
	 * ======================================================= */

	@Post('notifications')
	createNotification(@Req() req: any, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.createNotification(userId, dto);
	}

	@Get('notifications')
	getNotifications(@Req() req: any) {
		const userId = this.getUserId(req);
		return this.moneyService.getNotifications(userId);
	}

	@Get('notifications/:id')
	getNotificationById(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.getNotificationById(userId, id);
	}

	@Patch('notifications/:id')
	updateNotification(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.updateNotification(userId, id, dto);
	}

	@Patch('notifications/:id/read')
	markNotificationRead(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.markNotificationRead(userId, id);
	}

	@Delete('notifications/:id')
	deleteNotification(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.deleteNotification(userId, id);
	}

	/* =========================================================
	 * Expected
	 * ======================================================= */

	@Post('expected')
	createExpected(@Req() req: any, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.createExpected(userId, dto);
	}

	@Get('expected')
	getExpected(@Req() req: any) {
		const userId = this.getUserId(req);
		return this.moneyService.getExpected(userId);
	}

	@Get('expected/:id')
	getExpectedById(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.getExpectedById(userId, id);
	}

	@Patch('expected/:id')
	updateExpected(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
		const userId = this.getUserId(req);
		return this.moneyService.updateExpected(userId, id, dto);
	}

	@Delete('expected/:id')
	deleteExpected(@Req() req: any, @Param('id') id: string) {
		const userId = this.getUserId(req);
		return this.moneyService.deleteExpected(userId, id);
	}
}