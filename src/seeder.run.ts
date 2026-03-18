// src/database/seeders/demo-admin-preview-lite.seeder.ts
import { DataSource, In } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import 'reflect-metadata';

import {
	User,
	UserRole,
	UserStatus,
	ChatConversation,
	ChatParticipant,
	ChatMessage,
	Form,
	FormField,
	FormSubmission,
	FieldType,
} from 'entities/global.entity';

import {
	CalendarEventType,
	CalendarItem,
	CalendarCompletion,
	CalendarSettings,
	CommitmentTimer,
	CalendarRecurrence,
} from 'entities/calendar.entity';

import {
	WalletAccount,
	WalletAccountType,
	MoneyCurrency,
	IncomeEntry,
	ExpenseEntry,
	FinancialCommitment,
	CommitmentType,
	CommitmentStatus,
	FinanceNotification,
	FinanceNotificationType,
	RecurrenceType,
} from 'entities/money.entity';

import { WeeklyReport } from 'entities/weekly-report.entity';

import {
	TodoFolder,
	TodoTask,
	TodoSubtask,
	TodoPriority,
	TodoRepeat,
	TodoStatus,
} from 'entities/todo.entity';

import {
	BillingPlan,
	BillingInterval,
	BillingPlanStatus,
	UserSubscription,
	SubscriptionStatus,
	BillingInvoice,
	InvoiceStatus,
	PaymentTransaction,
	PaymentMethodType,
	PaymentStatus,
} from 'entities/billing.entity';

export const AppDataSource = new DataSource({
	type: 'postgres',
	host: 'aws-0-eu-central-1.pooler.supabase.com',
	port: 5432,
	username: 'postgres.sghvszzxubiyocwhfczj',
	password: 'ahmedshtya-083',
	database: 'gym-db',
	entities: [__dirname + '/../**/*.entity{.ts,.js}'],
	synchronize: false,
});

const DEMO_ADMIN_ID = 'd6da9cb9-ca3c-4768-93c8-a5f47d571698';

function daysAgo(n: number) {
	const d = new Date();
	d.setDate(d.getDate() - n);
	return d;
}

function daysFromNow(n: number) {
	const d = new Date();
	d.setDate(d.getDate() + n);
	return d;
}

function toDateOnly(date: Date) {
	return date.toISOString().slice(0, 10);
}

export class DemoAdminPreviewLiteSeeder {
	constructor(private readonly dataSource: DataSource) {}

	async run() {
		console.log('🌱 DemoAdminPreviewLiteSeeder started...');

		await this.dataSource.transaction(async (manager) => {
			const userRepo = manager.getRepository(User);

			const calendarTypeRepo = manager.getRepository(CalendarEventType);
			const calendarItemRepo = manager.getRepository(CalendarItem);
			const calendarCompletionRepo = manager.getRepository(CalendarCompletion);
			const calendarSettingsRepo = manager.getRepository(CalendarSettings);
			const commitmentTimerRepo = manager.getRepository(CommitmentTimer);

			const walletRepo = manager.getRepository(WalletAccount);
			const incomeRepo = manager.getRepository(IncomeEntry);
			const expenseRepo = manager.getRepository(ExpenseEntry);
			const commitmentRepo = manager.getRepository(FinancialCommitment);
			const financeNotificationRepo = manager.getRepository(FinanceNotification);

			const weeklyReportRepo = manager.getRepository(WeeklyReport);

			const todoFolderRepo = manager.getRepository(TodoFolder);
			const todoTaskRepo = manager.getRepository(TodoTask);
			const todoSubtaskRepo = manager.getRepository(TodoSubtask);

			const billingPlanRepo = manager.getRepository(BillingPlan);
			const subscriptionRepo = manager.getRepository(UserSubscription);
			const invoiceRepo = manager.getRepository(BillingInvoice);
			const paymentRepo = manager.getRepository(PaymentTransaction);

			const formRepo = manager.getRepository(Form);
			const formFieldRepo = manager.getRepository(FormField);
			const formSubmissionRepo = manager.getRepository(FormSubmission);

			const chatConversationRepo = manager.getRepository(ChatConversation);
			const chatParticipantRepo = manager.getRepository(ChatParticipant);
			const chatMessageRepo = manager.getRepository(ChatMessage);

			const admin = await userRepo.findOne({
				where: { id: DEMO_ADMIN_ID },
			});

			if (!admin) {
				throw new Error(`Admin not found: ${DEMO_ADMIN_ID}`);
			}

			if (admin.role !== UserRole.ADMIN) {
				admin.role = UserRole.ADMIN;
				admin.status = UserStatus.ACTIVE;
				await userRepo.save(admin);
			}

			const passwordHash = await bcrypt.hash('12345678', 10);

			// =====================================================
			// SEED IDENTITIES
			// =====================================================
			const coachesSeed = [
				{
					name: 'الكابتن عمر',
					email: 'coach.omar.demo.preview@example.com',
					phone: '01010000001',
					gender: 'male',
				},
				{
					name: 'الكابتن سارة',
					email: 'coach.sara.demo.preview@example.com',
					phone: '01010000002',
					gender: 'female',
				},
			];

			const clientsSeed = [
				{
					name: 'أحمد طارق',
					email: 'client.ahmed.preview@example.com',
					phone: '01020000001',
					gender: 'male',
					coachIndex: 0,
					membership: 'ذهبية',
				},
				{
					name: 'منى عادل',
					email: 'client.mona.preview@example.com',
					phone: '01020000002',
					gender: 'female',
					coachIndex: 1,
					membership: 'بلاتينية',
				},
				{
					name: 'يوسف هاني',
					email: 'client.youssef.preview@example.com',
					phone: '01020000003',
					gender: 'male',
					coachIndex: 0,
					membership: 'أساسية',
				},
				{
					name: 'ندى سامح',
					email: 'client.nada.preview@example.com',
					phone: '01020000004',
					gender: 'female',
					coachIndex: 1,
					membership: 'ذهبية',
				},
				{
					name: 'كريم عادل',
					email: 'client.karim.preview@example.com',
					phone: '01020000005',
					gender: 'male',
					coachIndex: 0,
					membership: 'بلاتينية',
				},
				{
					name: 'سلمى محمد',
					email: 'client.salma.preview@example.com',
					phone: '01020000006',
					gender: 'female',
					coachIndex: 1,
					membership: 'ذهبية',
				},
			];

			const seededEmails = [
				...coachesSeed.map((x) => x.email),
				...clientsSeed.map((x) => x.email),
			];

			const existingSeedUsers = await userRepo.find({
				where: { email: In(seededEmails) },
			});

			const seededUserIds = existingSeedUsers.map((u) => u.id);

			// =====================================================
			// SAFE RESET ONLY FOR THIS ADMIN / THIS SEEDER
			// =====================================================

			// Weekly reports for seeded clients
			if (seededUserIds.length) {
				await weeklyReportRepo
					.createQueryBuilder()
					.delete()
					.from(WeeklyReport)
					.where('userId IN (:...ids)', { ids: seededUserIds })
					.andWhere('adminId = :adminId', { adminId: DEMO_ADMIN_ID })
					.execute();
			}

			// Calendar only for this admin
			await calendarCompletionRepo
				.createQueryBuilder()
				.delete()
				.from(CalendarCompletion)
				.where('adminId = :adminId', { adminId: DEMO_ADMIN_ID })
				.execute();

			await calendarItemRepo
				.createQueryBuilder()
				.delete()
				.from(CalendarItem)
				.where('adminId = :adminId', { adminId: DEMO_ADMIN_ID })
				.execute();

			await calendarTypeRepo
				.createQueryBuilder()
				.delete()
				.from(CalendarEventType)
				.where('adminId = :adminId', { adminId: DEMO_ADMIN_ID })
				.execute();

			await calendarSettingsRepo
				.createQueryBuilder()
				.delete()
				.from(CalendarSettings)
				.where('adminId = :adminId', { adminId: DEMO_ADMIN_ID })
				.execute();

			await commitmentTimerRepo
				.createQueryBuilder()
				.delete()
				.from(CommitmentTimer)
				.where('adminId = :adminId', { adminId: DEMO_ADMIN_ID })
				.execute();

			// Money only for demo admin account
			await financeNotificationRepo.delete({ userId: DEMO_ADMIN_ID });
			await commitmentRepo.delete({ userId: DEMO_ADMIN_ID });
			await expenseRepo.delete({ userId: DEMO_ADMIN_ID });
			await incomeRepo.delete({ userId: DEMO_ADMIN_ID });
			await walletRepo.delete({ userId: DEMO_ADMIN_ID });

			// Todos only for this admin
			const demoTasks = await todoTaskRepo.find({
				where: { adminId: DEMO_ADMIN_ID },
				select: ['id'],
			});

			if (demoTasks.length) {
				await todoSubtaskRepo
					.createQueryBuilder()
					.delete()
					.from(TodoSubtask)
					.where('taskId IN (:...taskIds)', { taskIds: demoTasks.map((t) => t.id) })
					.execute();
			}

			await todoTaskRepo.delete({ adminId: DEMO_ADMIN_ID });
			await todoFolderRepo.delete({ adminId: DEMO_ADMIN_ID });

			// Billing only for demo plans/users
			const demoPlans = await billingPlanRepo.find({
				where: { adminId: DEMO_ADMIN_ID },
				select: ['id'],
			});
			const demoPlanIds = demoPlans.map((p) => p.id);

			const demoSubscriptions = await subscriptionRepo
				.createQueryBuilder('sub')
				.select(['sub.id'])
				.where('sub.userId IN (:...ids)', {
					ids: seededUserIds.length ? [DEMO_ADMIN_ID, ...seededUserIds] : [DEMO_ADMIN_ID],
				})
				.orWhere(demoPlanIds.length ? 'sub.planId IN (:...planIds)' : '1=0', {
					planIds: demoPlanIds.length ? demoPlanIds : ['00000000-0000-0000-0000-000000000000'],
				})
				.getMany();

			const demoSubscriptionIds = demoSubscriptions.map((s) => s.id);

			const demoInvoices = await invoiceRepo
				.createQueryBuilder('inv')
				.select(['inv.id'])
				.where('inv.userId IN (:...ids)', {
					ids: seededUserIds.length ? [DEMO_ADMIN_ID, ...seededUserIds] : [DEMO_ADMIN_ID],
				})
				.orWhere(demoPlanIds.length ? 'inv.planId IN (:...planIds)' : '1=0', {
					planIds: demoPlanIds.length ? demoPlanIds : ['00000000-0000-0000-0000-000000000000'],
				})
				.orWhere(demoSubscriptionIds.length ? 'inv.subscriptionId IN (:...subIds)' : '1=0', {
					subIds: demoSubscriptionIds.length ? demoSubscriptionIds : ['00000000-0000-0000-0000-000000000000'],
				})
				.getMany();

			const demoInvoiceIds = demoInvoices.map((i) => i.id);

			if (demoInvoiceIds.length) {
				await paymentRepo
					.createQueryBuilder()
					.delete()
					.from(PaymentTransaction)
					.where('invoiceId IN (:...invoiceIds)', { invoiceIds: demoInvoiceIds })
					.execute();
			}

			if (demoInvoiceIds.length) {
				await invoiceRepo
					.createQueryBuilder()
					.delete()
					.from(BillingInvoice)
					.where('id IN (:...invoiceIds)', { invoiceIds: demoInvoiceIds })
					.execute();
			}

			if (demoSubscriptionIds.length) {
				await subscriptionRepo
					.createQueryBuilder()
					.delete()
					.from(UserSubscription)
					.where('id IN (:...subIds)', { subIds: demoSubscriptionIds })
					.execute();
			}

			await billingPlanRepo.delete({ adminId: DEMO_ADMIN_ID });

			// Forms only for this admin
			const demoForms = await formRepo.find({
				where: { adminId: DEMO_ADMIN_ID },
				select: ['id'],
			});
			const demoFormIds = demoForms.map((f) => f.id);

			if (demoFormIds.length) {
				await formSubmissionRepo
					.createQueryBuilder()
					.delete()
					.from(FormSubmission)
					.where('"formId" IN (:...formIds)', { formIds: demoFormIds })
					.execute();

				await formFieldRepo
					.createQueryBuilder()
					.delete()
					.from(FormField)
					.where('"formId" IN (:...formIds)', { formIds: demoFormIds })
					.execute();
			}

			await formRepo.delete({ adminId: DEMO_ADMIN_ID });

			// Chats only seeded preview conversations by name prefix
			const demoConversations = await chatConversationRepo
				.createQueryBuilder('c')
				.select(['c.id'])
				.where('c.name LIKE :prefix', { prefix: 'محادثة المعاينة - %' })
				.getMany();

			const demoConversationIds = demoConversations.map((c) => c.id);

			if (demoConversationIds.length) {
				await chatMessageRepo
					.createQueryBuilder()
					.delete()
					.from(ChatMessage)
					.where('"conversationId" IN (:...conversationIds)', {
						conversationIds: demoConversationIds,
					})
					.execute();

				await chatParticipantRepo
					.createQueryBuilder()
					.delete()
					.from(ChatParticipant)
					.where('"conversationId" IN (:...conversationIds)', {
						conversationIds: demoConversationIds,
					})
					.execute();

				await chatConversationRepo
					.createQueryBuilder()
					.delete()
					.from(ChatConversation)
					.where('id IN (:...conversationIds)', {
						conversationIds: demoConversationIds,
					})
					.execute();
			}

			// Finally delete only the seeded users created by this seeder
			if (seededUserIds.length) {
				await userRepo
					.createQueryBuilder()
					.delete()
					.from(User)
					.where('id IN (:...ids)', { ids: seededUserIds })
					.execute();
			}

			// =====================================================
			// RE-CREATE COACHES
			// =====================================================
			const createdCoaches: User[] = [];

			for (const coachData of coachesSeed) {
				const coach:any = await userRepo.save(
					userRepo.create({
						name: coachData.name,
						email: coachData.email,
						phone: coachData.phone,
						membership: 'مدرب محترف',
						password: passwordHash,
						role: UserRole.COACH,
						status: UserStatus.ACTIVE,
						gender: coachData.gender,
						coachId: null,
						adminId: DEMO_ADMIN_ID,
						lastLogin: new Date(),
						resetPasswordToken: null,
						resetPasswordExpires: null,
						points: 250,
						defaultRestSeconds: 75,
						subscriptionStart: toDateOnly(daysAgo(60)),
						subscriptionEnd: null,
						caloriesTarget: null,
						FiberTarget: null,
						proteinPerDay: null,
						carbsPerDay: null,
						fatsPerDay: null,
						activityLevel: 'نشط',
						notes: 'حساب معاينة للمدرب',
						activeExercisePlanId: null,
						activeMealPlanId: null,
					} as any),
				);

				createdCoaches.push(coach);
			}

			// =====================================================
			// RE-CREATE CLIENTS
			// =====================================================
			const createdClients: User[] = [];

			for (const clientData of clientsSeed) {
				const client:any = await userRepo.save(
					userRepo.create({
						name: clientData.name,
						email: clientData.email,
						phone: clientData.phone,
						membership: clientData.membership,
						password: passwordHash,
						role: UserRole.CLIENT,
						status: UserStatus.ACTIVE,
						gender: clientData.gender,
						coachId: createdCoaches[clientData.coachIndex].id,
						adminId: DEMO_ADMIN_ID,
						lastLogin: daysAgo(clientData.coachIndex + 1),
						resetPasswordToken: null,
						resetPasswordExpires: null,
						points: 50 + clientData.coachIndex * 20,
						defaultRestSeconds: 60 + clientData.coachIndex * 15,
						subscriptionStart: toDateOnly(daysAgo(30 + clientData.coachIndex * 5)),
						subscriptionEnd: toDateOnly(daysFromNow(60 + clientData.coachIndex * 10)),
						caloriesTarget: 1800 + clientData.coachIndex * 200,
						FiberTarget: 25 + clientData.coachIndex * 2,
						proteinPerDay: 120 + clientData.coachIndex * 10,
						carbsPerDay: 180 + clientData.coachIndex * 20,
						fatsPerDay: 55 + clientData.coachIndex * 5,
						activityLevel: clientData.coachIndex === 0 ? 'نشاط متوسط' : 'نشط',
						notes: 'حساب عميل للمعاينة',
						activeExercisePlanId: null,
						activeMealPlanId: null,
					} as any),
				);

				createdClients.push(client);
			}

			// =====================================================
			// CALENDAR
			// =====================================================
			const workoutType = await calendarTypeRepo.save(
				calendarTypeRepo.create({
					name: 'تمرين',
					color: 'bg-gradient-to-br from-indigo-300 to-violet-200',
					textColor: 'text-indigo-900',
					border: 'border-indigo-200',
					ring: 'ring-indigo-500',
					icon: 'Dumbbell',
					isActive: true,
					adminId: DEMO_ADMIN_ID,
				}),
			);

			const checkinType = await calendarTypeRepo.save(
				calendarTypeRepo.create({
					name: 'متابعة أسبوعية',
					color: 'bg-gradient-to-br from-emerald-300 to-lime-200',
					textColor: 'text-emerald-900',
					border: 'border-emerald-200',
					ring: 'ring-emerald-500',
					icon: 'Target',
					isActive: true,
					adminId: DEMO_ADMIN_ID,
				}),
			);

			await calendarSettingsRepo.save(
				calendarSettingsRepo.create({
					showWeekNumbers: false,
					highlightWeekend: true,
					weekendDays: [5, 6],
					startOfWeek: 6,
					confirmBeforeDelete: true,
					userId: DEMO_ADMIN_ID,
					user: admin,
					adminId: DEMO_ADMIN_ID,
				}),
			);

			await commitmentTimerRepo.save(
				commitmentTimerRepo.create({
					userId: DEMO_ADMIN_ID,
					user: admin,
					startTimeMs: String(Date.now() - 1000 * 60 * 38),
					isRunning: true,
					adminId: DEMO_ADMIN_ID,
				}),
			);

			const calendarTargets = [admin, ...createdClients.slice(0, 4)];

			for (let i = 0; i < calendarTargets.length; i++) {
				const targetUser = calendarTargets[i];

				const workoutItem = await calendarItemRepo.save(
					calendarItemRepo.create({
						title: `جلسة تمرين - ${targetUser.name}`,
						typeKey: 'workout',
						typeId: workoutType.id,
						type: workoutType,
						startDate: toDateOnly(daysAgo(i)),
						startTime: '18:00',
						recurrence: CalendarRecurrence.WEEKLY,
						recurrenceInterval: 1,
						recurrenceDays: [6, 1, 3],
						userId: targetUser.id,
						user: targetUser,
						adminId: DEMO_ADMIN_ID,
					}),
				);

				await calendarCompletionRepo.save(
					calendarCompletionRepo.create({
						item: workoutItem,
						itemId: workoutItem.id,
						date: toDateOnly(daysAgo(7)),
						completed: true,
						userId: targetUser.id,
						user: targetUser,
						adminId: DEMO_ADMIN_ID,
					}),
				);

				await calendarItemRepo.save(
					calendarItemRepo.create({
						title: `متابعة أسبوعية - ${targetUser.name}`,
						typeKey: 'checkin',
						typeId: checkinType.id,
						type: checkinType,
						startDate: toDateOnly(daysFromNow(2 + i)),
						startTime: '20:00',
						recurrence: CalendarRecurrence.WEEKLY,
						recurrenceInterval: 1,
						recurrenceDays: [5],
						userId: targetUser.id,
						user: targetUser,
						adminId: DEMO_ADMIN_ID,
					}),
				);
			}

			// =====================================================
			// MONEY
			// =====================================================
			const mainWallet = await walletRepo.save(
				walletRepo.create({
					user: admin,
					userId: DEMO_ADMIN_ID,
					name: 'المحفظة الرئيسية',
					type: WalletAccountType.CASH,
					currency: MoneyCurrency.EGP,
					openingBalance: '12000.00',
					isDefault: true,
					notes: 'محفظة المعاينة الرئيسية',
				}),
			);

			const bankWallet = await walletRepo.save(
				walletRepo.create({
					user: admin,
					userId: DEMO_ADMIN_ID,
					name: 'الحساب البنكي',
					type: WalletAccountType.BANK,
					currency: MoneyCurrency.EGP,
					openingBalance: '35000.00',
					isDefault: false,
					notes: 'حساب بنكي للمعاينة',
				}),
			);

			const incomeSeeds = [
				{
					source: 'مدفوعات اشتراكات العملاء',
					amount: '4500.00',
					date: toDateOnly(daysAgo(2)),
					account: mainWallet,
				},
				{
					source: 'ترقية باقة مميزة',
					amount: '2200.00',
					date: toDateOnly(daysAgo(5)),
					account: bankWallet,
				},
				{
					source: 'استشارة أونلاين',
					amount: '1200.00',
					date: toDateOnly(daysAgo(8)),
					account: mainWallet,
				},
			];

			for (const seed of incomeSeeds) {
				await incomeRepo.save(
					incomeRepo.create({
						user: admin,
						userId: DEMO_ADMIN_ID,
						account: seed.account,
						accountId: seed.account.id,
						source: seed.source,
						notes: 'دخل تجريبي للوحة المالية',
						amount: seed.amount,
						date: seed.date,
						recurring: false,
						recurrenceType: RecurrenceType.MONTHLY,
						recurrenceEvery: 1,
						isActive: true,
					}),
				);
			}

			const expenseSeeds = [
				{
					description: 'إيجار الجيم',
					category: 'تشغيل',
					amount: '8000.00',
					date: toDateOnly(daysAgo(3)),
					account: bankWallet,
				},
				{
					description: 'إعلانات تسويقية',
					category: 'تسويق',
					amount: '2500.00',
					date: toDateOnly(daysAgo(6)),
					account: mainWallet,
				},
				{
					description: 'مخزون مكملات',
					category: 'مخزون',
					amount: '1800.00',
					date: toDateOnly(daysAgo(10)),
					account: mainWallet,
				},
			];

			for (const seed of expenseSeeds) {
				await expenseRepo.save(
					expenseRepo.create({
						user: admin,
						userId: DEMO_ADMIN_ID,
						account: seed.account,
						accountId: seed.account.id,
						description: seed.description,
						category: seed.category,
						notes: 'مصروف تجريبي للوحة المالية',
						amount: seed.amount,
						date: seed.date,
						recurring: false,
						recurrenceType: RecurrenceType.MONTHLY,
						recurrenceEvery: 1,
						isActive: true,
					}),
				);
			}

			const commitmentSeeds = [
				{
					name: 'إيجار المكتب',
					amount: '8500.00',
					dueDate: toDateOnly(daysFromNow(3)),
					status: CommitmentStatus.PENDING,
					type: CommitmentType.FIXED,
				},
				{
					name: 'اشتراك كانفا',
					amount: '650.00',
					dueDate: toDateOnly(daysFromNow(6)),
					status: CommitmentStatus.PAID,
					type: CommitmentType.SUBSCRIPTION,
				},
			];

			for (const seed of commitmentSeeds) {
				await commitmentRepo.save(
					commitmentRepo.create({
						user: admin,
						userId: DEMO_ADMIN_ID,
						account: bankWallet,
						accountId: bankWallet.id,
						name: seed.name,
						type: seed.type,
						amount: seed.amount,
						dueDate: seed.dueDate,
						status: seed.status,
						recurring: true,
						recurrenceType: RecurrenceType.MONTHLY,
						recurrenceEvery: 1,
						notes: 'التزام مالي تجريبي',
					}),
				);
			}

			const financeNotificationsSeed = [
				{
					type: FinanceNotificationType.WARN,
					text: 'إيجار المكتب مستحق خلال 3 أيام',
					timeLabel: 'بعد 3 أيام',
				},
				{
					type: FinanceNotificationType.OK,
					text: 'تم استلام دفعة اشتراك جديدة بنجاح',
					timeLabel: 'اليوم',
				},
			];

			for (const seed of financeNotificationsSeed) {
				await financeNotificationRepo.save(
					financeNotificationRepo.create({
						user: admin,
						userId: DEMO_ADMIN_ID,
						type: seed.type,
						text: seed.text,
						timeLabel: seed.timeLabel,
						isRead: seed.type === FinanceNotificationType.OK,
						meta: { preview: true },
					}),
				);
			}

			// =====================================================
			// WEEKLY REPORTS
			// =====================================================
			for (let i = 0; i < createdClients.length; i++) {
				const client = createdClients[i];
				const coach = createdCoaches.find((c) => c.id === client.coachId) || createdCoaches[0];

				for (let w = 0; w < 4; w++) {
					const weekOf = toDateOnly(daysAgo(w * 7 + 2));

					await weeklyReportRepo.save(
						weeklyReportRepo.create({
							user: client,
							userId: client.id,
							coachId: coach.id,
							adminId: DEMO_ADMIN_ID,
							weekOf,
							diet: {
								hungry: w % 2 === 0 ? 'no' : 'yes',
								mentalComfort: 'yes',
								wantSpecific: w % 2 === 0 ? 'لا توجد رغبات قوية في الحلويات' : 'كان هناك رغبة بسيطة في الحلويات مرة واحدة',
								foodTooMuch: 'no',
								dietDeviation: {
									hasDeviation: w === 2 ? 'yes' : 'no',
									times: w === 2 ? '1' : null,
									details: w === 2 ? 'وجبة عائلية خارج الخطة' : null,
								},
							},
							training: {
								intensityOk: 'yes',
								daysDeviation: {
									hasDeviation: w === 1 ? 'yes' : 'no',
									count: w === 1 ? '1' : null,
									reason: w === 1 ? 'ضغط في العمل' : null,
								},
								shapeChange: 'yes',
								fitnessChange: 'yes',
								sleep: {
									enough: w % 2 === 0 ? 'yes' : 'no',
									hours: w % 2 === 0 ? '7.5' : '6',
								},
								programNotes: `مستوى ${client.name} يتحسن بشكل جيد والالتزام ممتاز خلال الأسبوع.`,
								cardioAdherence: 75 + w * 5,
							},
							measurements: {
								date: weekOf,
								weight: 82 - i - w * 0.4,
								waist: 90 - w * 0.5,
								chest: 104 - w * 0.1,
								hips: 100 - w * 0.2,
								arms: 37 + w * 0.1,
								thighs: 58 - w * 0.1,
							},
							photos: {
								front: { url: 'https://example.com/demo/front-photo.jpg' },
								back: { url: 'https://example.com/demo/back-photo.jpg' },
								left: { url: 'https://example.com/demo/left-photo.jpg' },
								right: { url: 'https://example.com/demo/right-photo.jpg' },
								extras: [],
							},
							isRead: w !== 0,
							coachFeedback:
								w === 0
									? 'أسبوع ممتاز جدًا، استمر بنفس الالتزام وركز على الزيادة التدريجية.'
									: 'هناك تقدم جيد، فقط نحتاج تحسين النوم وتوقيت الوجبات.',
							reviewedAt: daysAgo(w * 7),
							reviewedBy: coach,
							reviewedById: coach.id,
						}),
					);
				}
			}

			// =====================================================
			// FORMS + SUBMISSIONS
			// =====================================================
			const intakeForm = await formRepo.save(
				formRepo.create({
					title: 'نموذج المعاينة - استبيان عميل جديد',
					adminId: DEMO_ADMIN_ID,
				}),
			);

			await formFieldRepo.save([
				formFieldRepo.create({
					label: 'الاسم الكامل',
					key: 'full_name',
					placeholder: 'اكتب الاسم الكامل',
					type: FieldType.TEXT,
					required: true,
					options: null,
					order: 1,
					form: intakeForm,
				}),
				formFieldRepo.create({
					label: 'الهدف',
					key: 'goal',
					placeholder: 'اختر الهدف',
					type: FieldType.SELECT,
					required: true,
					options: ['خسارة وزن', 'زيادة عضلية', 'ثبات الوزن'],
					order: 2,
					form: intakeForm,
				}),
				formFieldRepo.create({
					label: 'مستوى النشاط',
					key: 'activity',
					placeholder: 'اختر مستوى النشاط',
					type: FieldType.RADIO,
					required: true,
					options: ['منخفض', 'متوسط', 'مرتفع'],
					order: 3,
					form: intakeForm,
				}),
				formFieldRepo.create({
					label: 'ملاحظات إضافية',
					key: 'notes',
					placeholder: 'أي تفاصيل إضافية',
					type: FieldType.TEXTAREA,
					required: false,
					options: null,
					order: 4,
					form: intakeForm,
				}),
			]);

			const consultationForm = await formRepo.save(
				formRepo.create({
					title: 'نموذج المعاينة - طلب استشارة',
					adminId: DEMO_ADMIN_ID,
				}),
			);

			await formFieldRepo.save([
				formFieldRepo.create({
					label: 'الاسم',
					key: 'name',
					placeholder: 'اكتب الاسم',
					type: FieldType.TEXT,
					required: true,
					options: null,
					order: 1,
					form: consultationForm,
				}),
				formFieldRepo.create({
					label: 'رقم الهاتف',
					key: 'phone',
					placeholder: 'اكتب رقم الهاتف',
					type: FieldType.PHONE,
					required: true,
					options: null,
					order: 2,
					form: consultationForm,
				}),
				formFieldRepo.create({
					label: 'نوع الخدمة المطلوبة',
					key: 'service',
					placeholder: 'اختر الخدمة',
					type: FieldType.SELECT,
					required: true,
					options: ['متابعة تدريب', 'متابعة تغذية', 'باقة شاملة'],
					order: 3,
					form: consultationForm,
				}),
			]);

			await formSubmissionRepo.save([
				formSubmissionRepo.create({
					form: intakeForm,
					email: 'lead1.demo@example.com',
					phone: '01055550001',
					ipAddress: '127.0.0.1',
					answers: {
						full_name: 'محمد سامح',
						goal: 'خسارة وزن',
						activity: 'متوسط',
						notes: 'يريد خطة مرنة تناسب مواعيد العمل.',
					},
					assignedTo: createdCoaches[0],
					assignedToId: createdCoaches[0].id,
					assignedAt: daysAgo(1),
					reviewed: true,
				}),
				formSubmissionRepo.create({
					form: intakeForm,
					email: 'lead2.demo@example.com',
					phone: '01055550002',
					ipAddress: '127.0.0.1',
					answers: {
						full_name: 'نور خالد',
						goal: 'زيادة عضلية',
						activity: 'مرتفع',
						notes: 'مهتمة بمتابعة أسبوعية مع تقارير.',
					},
					assignedTo: createdCoaches[1],
					assignedToId: createdCoaches[1].id,
					assignedAt: daysAgo(2),
					reviewed: true,
				}),
				formSubmissionRepo.create({
					form: consultationForm,
					email: 'lead3.demo@example.com',
					phone: '01055550003',
					ipAddress: '127.0.0.1',
					answers: {
						name: 'أحمد ربيع',
						phone: '01055550003',
						service: 'باقة شاملة',
					},
					assignedTo: createdCoaches[0],
					assignedToId: createdCoaches[0].id,
					assignedAt: null,
					reviewed: false,
				}),
			]);

			// =====================================================
			// TODOS
			// =====================================================
			const salesFolder = await todoFolderRepo.save(
				todoFolderRepo.create({
					name: 'المبيعات',
					color: 'var(--color-primary-600)',
					icon: 'Folder',
					isSystem: false,
					adminId: DEMO_ADMIN_ID,
				}),
			);

			const operationsFolder = await todoFolderRepo.save(
				todoFolderRepo.create({
					name: 'التشغيل',
					color: 'var(--color-primary-600)',
					icon: 'Folder',
					isSystem: false,
					adminId: DEMO_ADMIN_ID,
				}),
			);

			const task1 = await todoTaskRepo.save(
				todoTaskRepo.create({
					title: 'متابعة العملاء المحتملين الجدد',
					notes: 'الاتصال بالعملاء الذين قدموا النموذج هذا الأسبوع وإرسال تفاصيل الباقات.',
					completed: false,
					status: TodoStatus.IN_PROGRESS,
					priority: TodoPriority.HIGH,
					dueDate: toDateOnly(daysFromNow(1)),
					dueTime: '18:00',
					repeat: TodoRepeat.NONE,
					customRepeatDays: null,
					tags: ['مبيعات', 'متابعة'],
					isStarred: true,
					attachments: [],
					adminId: DEMO_ADMIN_ID,
					folder: salesFolder,
					folderId: salesFolder.id,
					orderIndex: 0,
				}),
			);

			await todoSubtaskRepo.save([
				todoSubtaskRepo.create({
					task: task1,
					taskId: task1.id,
					title: 'التواصل مع محمد سامح',
					completed: true,
					orderIndex: 0,
				}),
				todoSubtaskRepo.create({
					task: task1,
					taskId: task1.id,
					title: 'إرسال الأسعار إلى نور خالد',
					completed: false,
					orderIndex: 1,
				}),
				todoSubtaskRepo.create({
					task: task1,
					taskId: task1.id,
					title: 'تحديد موعد مكالمة لأحمد ربيع',
					completed: false,
					orderIndex: 2,
				}),
			]);

			const task2 = await todoTaskRepo.save(
				todoTaskRepo.create({
					title: 'مراجعة التقارير الأسبوعية',
					notes: 'التأكد من قراءة التقارير وإرسال ملاحظات مختصرة للمدربين.',
					completed: false,
					status: TodoStatus.TODO,
					priority: TodoPriority.MEDIUM,
					dueDate: toDateOnly(daysFromNow(2)),
					dueTime: '20:00',
					repeat: TodoRepeat.WEEKLY,
					customRepeatDays: null,
					tags: ['تقارير', 'تشغيل'],
					isStarred: false,
					attachments: [],
					adminId: DEMO_ADMIN_ID,
					folder: operationsFolder,
					folderId: operationsFolder.id,
					orderIndex: 1,
				}),
			);

			await todoSubtaskRepo.save([
				todoSubtaskRepo.create({
					task: task2,
					taskId: task2.id,
					title: 'مراجعة تقرير أحمد طارق',
					completed: false,
					orderIndex: 0,
				}),
				todoSubtaskRepo.create({
					task: task2,
					taskId: task2.id,
					title: 'مراجعة تقرير منى عادل',
					completed: false,
					orderIndex: 1,
				}),
			]);

			await todoTaskRepo.save(
				todoTaskRepo.create({
					title: 'تحديث لوحة الأسعار',
					notes: 'إضافة الباقة البلاتينية وتعديل مميزات باقة المتابعة الشهرية.',
					completed: true,
					status: TodoStatus.COMPLETED,
					priority: TodoPriority.LOW,
					dueDate: toDateOnly(daysAgo(1)),
					dueTime: '15:00',
					repeat: TodoRepeat.NONE,
					customRepeatDays: null,
					tags: ['أسعار'],
					isStarred: false,
					attachments: [],
					adminId: DEMO_ADMIN_ID,
					folder: salesFolder,
					folderId: salesFolder.id,
					orderIndex: 2,
				}),
			);

			// =====================================================
			// CHATS
			// =====================================================
			const conversation1 = await chatConversationRepo.save(
				chatConversationRepo.create({
					name: 'محادثة المعاينة - الإدارة والمدرب عمر',
					isGroup: false,
					avatar: null,
					createdBy: admin,
					createdById: DEMO_ADMIN_ID,
					lastMessageAt: new Date(),
				}),
			);

			await chatParticipantRepo.save([
				chatParticipantRepo.create({
					conversation: conversation1,
					user: admin,
					nickname: 'الإدارة',
					isAdmin: true,
					lastReadAt: new Date(),
					isActive: true,
				}),
				chatParticipantRepo.create({
					conversation: conversation1,
					user: createdCoaches[0],
					nickname: 'الكابتن عمر',
					isAdmin: false,
					lastReadAt: new Date(),
					isActive: true,
				}),
			]);

			const msg1 = await chatMessageRepo.save(
				chatMessageRepo.create({
					conversation: conversation1,
					sender: createdCoaches[0],
					content: 'تمت مراجعة تقارير العملاء لهذا الأسبوع وهناك تحسن واضح في الالتزام.',
					messageType: 'text',
					attachments: [],
					isEdited: false,
					isDeleted: false,
					replyTo: null,
					replyToId: null,
					reactions: { '👍': [DEMO_ADMIN_ID] },
					readBy: new Date(),
				}),
			);

			await chatMessageRepo.save([
				chatMessageRepo.create({
					conversation: conversation1,
					sender: admin,
					content: 'ممتاز، أرسل لي ملخصًا سريعًا للحالات التي تحتاج متابعة إضافية.',
					messageType: 'text',
					attachments: [],
					isEdited: false,
					isDeleted: false,
					replyTo: msg1,
					replyToId: msg1.id,
					reactions: null,
					readBy: new Date(),
				}),
				chatMessageRepo.create({
					conversation: conversation1,
					sender: createdCoaches[0],
					content: 'حاضر، سأرسل لك اليوم الحالات التي تحتاج تعديل في الخطة الغذائية.',
					messageType: 'text',
					attachments: [],
					isEdited: false,
					isDeleted: false,
					replyTo: null,
					replyToId: null,
					reactions: { '🔥': [DEMO_ADMIN_ID] },
					readBy: new Date(),
				}),
			]);

			const conversation2 = await chatConversationRepo.save(
				chatConversationRepo.create({
					name: 'محادثة المعاينة - متابعة أحمد طارق',
					isGroup: false,
					avatar: null,
					createdBy: admin,
					createdById: DEMO_ADMIN_ID,
					lastMessageAt: new Date(),
				}),
			);

			await chatParticipantRepo.save([
				chatParticipantRepo.create({
					conversation: conversation2,
					user: createdCoaches[0],
					nickname: 'الكابتن عمر',
					isAdmin: true,
					lastReadAt: new Date(),
					isActive: true,
				}),
				chatParticipantRepo.create({
					conversation: conversation2,
					user: createdClients[0],
					nickname: createdClients[0].name,
					isAdmin: false,
					lastReadAt: new Date(),
					isActive: true,
				}),
			]);

			await chatMessageRepo.save([
				chatMessageRepo.create({
					conversation: conversation2,
					sender: createdClients[0],
					content: 'صباح الخير كابتن، التزمت بالخطة هذا الأسبوع بالكامل.',
					messageType: 'text',
					attachments: [],
					isEdited: false,
					isDeleted: false,
					replyTo: null,
					replyToId: null,
					reactions: null,
					readBy: new Date(),
				}),
				chatMessageRepo.create({
					conversation: conversation2,
					sender: createdCoaches[0],
					content: 'ممتاز جدًا يا أحمد، استمر على نفس المستوى وسنزيد شدة التمرين تدريجيًا.',
					messageType: 'text',
					attachments: [],
					isEdited: false,
					isDeleted: false,
					replyTo: null,
					replyToId: null,
					reactions: { '👏': [createdClients[0].id] },
					readBy: new Date(),
				}),
			]);

			// =====================================================
			// BILLING
			// =====================================================
			const monthlyPlan = await billingPlanRepo.save(
				billingPlanRepo.create({
					name: 'باقة المتابعة الشهرية',
					description: 'متابعة تدريب وتغذية مع تواصل أسبوعي',
					interval: BillingInterval.MONTHLY,
					intervalCount: 1,
					price: '799.00',
					currency: 'EGP',
					durationDays: 30,
					trialDays: 0,
					isPopular: true,
					status: BillingPlanStatus.ACTIVE,
					features: ['خطة تدريب', 'خطة غذائية', 'متابعة أسبوعية', 'دعم عبر المحادثة'],
					adminId: DEMO_ADMIN_ID,
				}),
			);

			const quarterlyPlan = await billingPlanRepo.save(
				billingPlanRepo.create({
					name: 'باقة التحول ربع السنوية',
					description: 'برنامج شامل لمدة 3 أشهر مع أولوية في المتابعة',
					interval: BillingInterval.QUARTERLY,
					intervalCount: 1,
					price: '1999.00',
					currency: 'EGP',
					durationDays: 90,
					trialDays: 0,
					isPopular: false,
					status: BillingPlanStatus.ACTIVE,
					features: ['أولوية دعم', 'تقارير متقدمة', 'مراجعة أسبوعية', 'متابعة مستمرة'],
					adminId: DEMO_ADMIN_ID,
				}),
			);

			const billingTargets = [
				{ user: createdClients[0], plan: monthlyPlan, status: SubscriptionStatus.ACTIVE, price: '799.00' },
				{ user: createdClients[1], plan: quarterlyPlan, status: SubscriptionStatus.ACTIVE, price: '1999.00' },
				{ user: createdClients[2], plan: monthlyPlan, status: SubscriptionStatus.PAST_DUE, price: '799.00' },
				{ user: createdClients[3], plan: monthlyPlan, status: SubscriptionStatus.TRIALING, price: '0.00' },
			];

			for (let i = 0; i < billingTargets.length; i++) {
				const target = billingTargets[i];

				const subscription = await subscriptionRepo.save(
					subscriptionRepo.create({
						user: target.user,
						userId: target.user.id,
						plan: target.plan,
						planId: target.plan.id,
						status: target.status,
						startDate: toDateOnly(daysAgo(20 + i * 3)),
						endDate: toDateOnly(daysFromNow(10 + i * 10)),
						renewAt: toDateOnly(daysFromNow(10 + i * 10)),
						autoRenew: true,
						canceledAt: null,
						cancelReason: null,
						externalSubscriptionId: `demo_sub_${i + 1}`,
						provider: 'manual',
						priceAtPurchase: target.price,
						currency: 'EGP',
						notes: 'اشتراك تجريبي للمعاينة',
					}),
				);

				const invoiceStatus =
					i === 2 ? InvoiceStatus.OPEN : i === 3 ? InvoiceStatus.DRAFT : InvoiceStatus.PAID;

				const total = i === 3 ? '0.00' : target.plan.price;

				const invoice = await invoiceRepo.save(
					invoiceRepo.create({
						user: target.user,
						userId: target.user.id,
						plan: target.plan,
						planId: target.plan.id,
						subscription,
						subscriptionId: subscription.id,
						invoiceNumber: `AR-DEMO-INV-${Date.now()}-${i + 1}`,
						status: invoiceStatus,
						subtotal: total,
						discount: '0.00',
						tax: '0.00',
						total,
						amountPaid: invoiceStatus === InvoiceStatus.PAID ? total : '0.00',
						amountDue: invoiceStatus === InvoiceStatus.PAID ? '0.00' : total,
						currency: 'EGP',
						issueDate: toDateOnly(daysAgo(10 + i)),
						dueDate: toDateOnly(daysFromNow(5 + i)),
						paidAt: invoiceStatus === InvoiceStatus.PAID ? toDateOnly(daysAgo(5 + i)) : null,
						description: `فاتورة ${target.plan.name}`,
						items: [
							{
								title: target.plan.name,
								description: 'اشتراك متابعة وتجهيز خطة',
								qty: 1,
								unitPrice: Number(total),
								total: Number(total),
							},
						],
						notes: 'فاتورة تجريبية للعرض',
					}),
				);

				if (invoiceStatus === InvoiceStatus.PAID) {
					await paymentRepo.save(
						paymentRepo.create({
							user: target.user,
							userId: target.user.id,
							invoice,
							invoiceId: invoice.id,
							paymentMethod: i % 2 === 0 ? PaymentMethodType.CARD : PaymentMethodType.CASH,
							status: PaymentStatus.SUCCEEDED,
							amount: total,
							currency: 'EGP',
							provider: i % 2 === 0 ? 'paymob' : 'manual',
							transactionId: `txn_ar_demo_${i + 1}`,
							referenceNumber: `ref_ar_demo_${i + 1}`,
							externalPaymentIntentId: null,
							paidAt: toDateOnly(daysAgo(4 + i)),
							failureReason: null,
							notes: 'عملية دفع تجريبية ناجحة',
							metadata: { preview: true },
						}),
					);
				} else if (invoiceStatus === InvoiceStatus.OPEN) {
					await paymentRepo.save(
						paymentRepo.create({
							user: target.user,
							userId: target.user.id,
							invoice,
							invoiceId: invoice.id,
							paymentMethod: PaymentMethodType.FAWRY,
							status: PaymentStatus.PENDING,
							amount: total,
							currency: 'EGP',
							provider: 'fawry',
							transactionId: null,
							referenceNumber: `pending_ar_demo_${i + 1}`,
							externalPaymentIntentId: null,
							paidAt: null,
							failureReason: null,
							notes: 'عملية دفع معلقة للمعاينة',
							metadata: { preview: true },
						}),
					);
				}
			}
		});

		console.log('✅ DemoAdminPreviewLiteSeeder finished successfully.');
	}
}

async function bootstrap() {
	await AppDataSource.initialize();

	try {
		const seeder = new DemoAdminPreviewLiteSeeder(AppDataSource);
		await seeder.run();
	} catch (error) {
		console.error('Seeder failed:', error);
	} finally {
		await AppDataSource.destroy();
	}
}

bootstrap();