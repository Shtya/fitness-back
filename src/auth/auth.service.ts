import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In, IsNull } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { MealPlan, Notification, NotificationAudience, NotificationType, Plan, User, UserRole, UserStatus } from 'entities/global.entity';
import { RegisterDto, LoginDto, UpdateProfileDto, ResetPasswordDto, ForgotPasswordDto } from 'dto/auth.dto';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'common/nodemailer';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) public userRepo: Repository<User>,
    @InjectRepository(Plan) private readonly planRepo: Repository<Plan>,
    @InjectRepository(MealPlan) private readonly mealPlanRepo: Repository<MealPlan>,
    @InjectRepository(Notification) private readonly notifRepo: Repository<Notification>,
    private jwt: JwtService,
    private cfg: ConfigService,
    public emailService: MailService,
  ) {}

  /* ===================== Core ===================== */

  async getStats() {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      admins,
      coaches,
      clients,
      withPlans, // users having a workout/exercise plan
      withMealPlans, // users having a meal plan
    ] = await Promise.all([this.userRepo.count(), this.userRepo.count({ where: { status: UserStatus.ACTIVE } }), this.userRepo.count({ where: { status: UserStatus.SUSPENDED } }), this.userRepo.count({ where: { role: UserRole.ADMIN } }), this.userRepo.count({ where: { role: UserRole.COACH } }), this.userRepo.count({ where: { role: UserRole.CLIENT } }), this.userRepo.count({ where: { activePlanId: Not(IsNull()) } }), this.userRepo.count({ where: { activeMealPlanId: Not(IsNull()) } })]);

    const withoutPlans = totalUsers - withPlans;
    const withoutMealPlans = totalUsers - withMealPlans;

    return {
      totalUsers,
      activeUsers,
      suspendedUsers,
      admins,
      coaches,
      clients,
      withPlans,
      withoutPlans,
      withMealPlans,
      withoutMealPlans,
    };
  }

  private signAccess(id: string) {
    return this.jwt.sign({ id }, { secret: this.cfg.get<string>('JWT_SECRET')!, expiresIn: this.cfg.get<string>('JWT_EXPIRE') || '1d' });
  }
  private signRefresh(id: string) {
    return this.jwt.sign({ id }, { secret: this.cfg.get<string>('JWT_REFRESH') || this.cfg.get<string>('JWT_SECRET')!, expiresIn: this.cfg.get<string>('JWT_REFRESH_EXPIRE') || '7d' });
  }
  // inside AuthService
  private serialize(u: User, tokens?: { accessToken: string; refreshToken: string }) {
    return {
      ...u,
      ...(tokens ?? {}),
    };
  }

  /* ===================== Endpoints ===================== */
  // users.service.ts
  async listUsersAdvanced(query: any) {
    const page = Number(query.page ?? 1);
    const limit = Math.min(Number(query.limit ?? 10), 100);
    const sortBy = query.sortBy ?? 'created_at';
    const sortOrder: 'ASC' | 'DESC' = (String(query.sortOrder || 'DESC').toUpperCase() as any) === 'ASC' ? 'ASC' : 'DESC';
    const search = (query.search || '').trim();
    const role = (query.role || '').toLowerCase();

    const includePlans = String(query.includePlans || '').toLowerCase() === 'true'; // workout plan
    const includeMeals = String(query.includeMeals || '').toLowerCase() === 'true'; // meal plan

    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.coach', 'coach')
      .orderBy(`user.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    if (search) {
      qb.andWhere('(user.email ILIKE :q OR user.name ILIKE :q OR user.phone ILIKE :q)', { q: `%${search}%` });
    }
    const VALID_ROLES = ['admin', 'coach', 'trainer', 'client'] as const;

    if (role) {
      if (role === 'coach') {
        // coach filter should include admins too
        qb.andWhere('user.role IN (:...roles)', { roles: ['coach', 'admin'] });
      } else if (VALID_ROLES.includes(role as any)) {
        qb.andWhere('user.role = :role', { role });
      }
    }

    const [users, total] = await qb.getManyAndCount();

    // ===== batch load exercise plans by id
    let plansById: Record<string, Plan> = {};
    const planIds = users.map(u => u.activePlanId).filter((x): x is string => !!x);
    if (planIds.length) {
      const plans = await this.planRepo.find({
        where: { id: In(planIds) },
        relations: includePlans ? ['days', 'days.exercises'] : [], // full tree only if asked
      });
      plansById = Object.fromEntries(plans.map(p => [p.id, p]));
    }

    // ===== batch load meal plans by id
    let mealPlansById: Record<string, MealPlan> = {};
    const mealIds = users.map(u => u.activeMealPlanId).filter((x): x is string => !!x);
    if (mealIds.length) {
      const mps = await this.mealPlanRepo.find({
        where: { id: In(mealIds) },
        relations: includeMeals ? ['days', 'days.foods'] : [], // full tree only if asked
      });
      mealPlansById = Object.fromEntries(mps.map(p => [p.id, p]));
    }

    return {
      users: users.map(u => {
        const base = this.serialize(u); // your existing serializer
        const out: any = {
          ...base,
          activePlanId: u.activePlanId ?? null,
          activeMealPlanId: u.activeMealPlanId ?? null,
        };

        // --- attach workout plan (exercise)
        if (u.activePlanId && plansById[u.activePlanId]) {
          const p = plansById[u.activePlanId];
          out.activePlan = includePlans
            ? {
                id: p.id,
                name: p.name,
                isActive: p.isActive,
                days: (p.days || []).map(d => ({
                  id: d.id,
                  day: d.day, // enum DayOfWeek
                  name: d.name,
                  exercises: (d.exercises || [])
                    .sort((a, b) => a.orderIndex - b.orderIndex)
                    .map(e => ({
                      id: e.id,
                      name: e.name,
                      details: e.details,
                      category: e.category,
                      primaryMusclesWorked: e.primaryMusclesWorked,
                      secondaryMusclesWorked: e.secondaryMusclesWorked,
                      targetReps: e.targetReps,
                      targetSets: e.targetSets,
                      rest: e.rest,
                      tempo: e.tempo,
                      img: e.img,
                      video: e.video,
                      orderIndex: e.orderIndex,
                    })),
                })),
              }
            : { id: p.id, name: p.name, isActive: p.isActive }; // summary
        } else {
          out.activePlan = null;
        }

        // --- attach meal plan
        if (u.activeMealPlanId && mealPlansById[u.activeMealPlanId]) {
          const mp = mealPlansById[u.activeMealPlanId];
          out.activeMealPlan = includeMeals
            ? {
                id: mp.id,
                name: mp.name,
                isActive: mp.isActive,
                days: (mp.days || []).map(d => ({
                  id: d.id,
                  day: d.day,
                  name: d.name,
                  foods: (d.foods || [])
                    .sort((a, b) => a.orderIndex - b.orderIndex)
                    .map(f => ({
                      id: f.id,
                      name: f.name,
                      category: f.category,
                      calories: Number(f.calories),
                      protein: Number(f.protein),
                      carbs: Number(f.carbs),
                      fat: Number(f.fat),
                      unit: f.unit,
                      quantity: Number(f.quantity),
                      mealType: f.mealType,
                      orderIndex: f.orderIndex,
                    })),
                })),
              }
            : { id: mp.id, name: mp.name, isActive: mp.isActive }; // summary
        } else {
          out.activeMealPlan = null;
        }

        return out;
      }),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adminCreateUser(body: any) {
    const { name, email, role, phone, gender, membership, coachId, subscriptionStart, subscriptionEnd } = body || {};
    if (!name || !email) throw new BadRequestException('name and email are required');

    const exists = await this.userRepo.findOne({ where: { email } });
    if (exists) throw new ConflictException('Email already registered');

    const r = (role || 'client').toLowerCase();
    if (!['client', 'coach', 'trainer', 'admin'].includes(r)) {
      throw new BadRequestException('Invalid role');
    }

    // generate strong temp password
    const tempPass = body?.password || crypto.randomBytes(6).toString('base64url'); // ~8 chars, tweak length as you like
    const user = this.userRepo.create({
      name,
      email,
      phone: phone || null,
      membership: membership || null,
      gender: gender || null,
      password: await bcrypt.hash(tempPass, 12),
      role: r as any,
      status: UserStatus.ACTIVE, // Admin-created accounts start active
      subscriptionStart: subscriptionStart ?? new Date().toISOString().slice(0, 10),
      subscriptionEnd: subscriptionEnd ?? null,
      activePlanId: null,
      defaultRestSeconds: 90,
      lastLogin: null,
      resetPasswordToken: null,
      resetPasswordExpires: null,
    });

    if (coachId) {
      // Ensure coach exists & is coach/trainer/admin (up to you)
      const coach = await this.userRepo.findOne({ where: { id: coachId } });
      if (!coach) throw new NotFoundException('Coach not found');
      user.coach = coach;
      user.coachId = coach.id;
    }

    await this.userRepo.save(user);

    // (Optional) email temp password to user
    try {
      await this.emailService.sendWelcomeWithPassword(email, name, tempPass);
    } catch (e) {
      // ignore mail errors
    }

    return {
      message: 'User created by admin',
      tempPassword: tempPass,
      user: this.serialize(user),
    };
  }

  async assignCoach(userId: string, coachId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['coach'] });
    if (!user) throw new NotFoundException('User not found');

    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (!coach) throw new NotFoundException('Coach not found');

    // Allow admins/coaches to assign coaches to CLIENT or TRAINER (or even ADMIN if you want)
    if (![UserRole.CLIENT].includes(user.role)) {
      // you can relax this if needed
      // throw new BadRequestException('Only clients/trainers can be assigned to a coach');
    }

    user.coach = coach;
    user.coachId = coach.id;
    await this.userRepo.save(user);

    return { message: 'Coach assigned', user: this.serialize(user) };
  }

  // ADD in AuthService
  async listCoaches(includeTrainers = true) {
    const roles = includeTrainers ? [UserRole.COACH] : [UserRole.COACH];
    const list = await this.userRepo.find({
      where: roles.map(r => ({ role: r }) as any),
      order: { name: 'ASC' as any },
    });
    return list.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
  }

  async register(dto: RegisterDto) {
    const exists = await this.userRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');

    const user = this.userRepo.create({
      name: dto.name,
      email: dto.email,
      password: await bcrypt.hash(dto.password, 12),
      role: dto.role ?? UserRole.CLIENT,
      defaultRestSeconds: dto.defaultRestSeconds ?? 90,
      activePlanId: null,
      status: UserStatus.PENDING, // NEW: account starts pending
      points: 0,
      lastLogin: null,
      resetPasswordToken: null,
      resetPasswordExpires: null,
    });

    await this.userRepo.save(user);

    return { message: 'Registration successful. Awaiting approval.', user: this.serialize(user) };
  }

  private async notifyAdminsSubscriptionAttempt(email: string) {
    const notif = this.notifRepo.create({
      type: NotificationType.SUBSCRIPTION_EXPIRED_LOGIN, // or FORM_SUBMISSION
      title: 'Expired subscription login attempt',
      message: `User with email ${email} tried to log in but their subscription is expired.`,
      audience: NotificationAudience.ADMIN,
      isRead: false,
      data: { email },
    });

    await this.notifRepo.save(notif);
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.createQueryBuilder('user').addSelect('user.password').where('user.email = :email', { email: dto.email }).getOne();

    if (!user || !(await bcrypt.compare(dto.password, user.password))) throw new UnauthorizedException('Incorrect email or password');

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(user.status === UserStatus.PENDING ? 'Your account is pending approval.' : 'Your account is suspended.');
    }

    const today = new Date().toISOString().slice(0, 10);
    if (user.subscriptionStart && today < user.subscriptionStart) {
      throw new UnauthorizedException('Your subscription has not started yet.');
    }

    if (user.subscriptionEnd && today > user.subscriptionEnd) {
      user.status = UserStatus.SUSPENDED;
      this.userRepo.save(user);
      await this.notifyAdminsSubscriptionAttempt(user.email);
      throw new UnauthorizedException('Your subscription has expired.');
    }

    const reward = Number(this.cfg.get('LOGIN_REWARD_POINTS') ?? 1);
    user.points = (user.points || 0) + reward;
    user.lastLogin = new Date();
    await this.userRepo.save(user);

    const accessToken = this.signAccess(user.id);
    const refreshToken = this.signRefresh(user.id);
    return { accessToken, refreshToken, user: this.serialize(user) };
  }

  async refreshTokens(refreshToken: string) {
    let decoded: any;
    try {
      decoded = this.jwt.verify(refreshToken, {
        secret: this.cfg.get<string>('JWT_REFRESH') || this.cfg.get<string>('JWT_SECRET')!,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.userRepo.findOne({ where: { id: decoded.id } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Account is not active');

    const newAccess = this.signAccess(user.id);
    const newRefresh = this.signRefresh(user.id);
    return { message: 'Tokens refreshed', accessToken: newAccess, refreshToken: newRefresh };
  }

  async getCurrentUser(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return this.serialize(user);
  }

  // tweak updateProfile if you want to accept gender (and ignore coachId here)
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.defaultRestSeconds !== undefined) user.defaultRestSeconds = dto.defaultRestSeconds;
    if (dto.activePlanId !== undefined) user.activePlanId = dto.activePlanId;
    if ((dto as any).gender !== undefined) (user as any).gender = (dto as any).gender;
    await this.userRepo.save(user);
    return this.serialize(user);
  }

  async getAllUsers(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [users, total] = await this.userRepo.findAndCount({
      skip,
      take: limit,
      order: { created_at: 'DESC' as any },
      select: ['id', 'name', 'email', 'role', 'status', 'points', 'defaultRestSeconds', 'activePlanId'] as any,
    });
    return { users, total, page, totalPages: Math.ceil(total / limit) };
  }

  async deleteUser(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.userRepo.remove(user);
    return { message: 'User deleted' };
  }

  /* ------------ NEW: Admin can approve/suspend users ------------ */
  async setStatus(userId: string, status: UserStatus) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.status = status;
    await this.userRepo.save(user);
    return this.serialize(user);
  }

  /* ------------ NEW: Forgot / Reset password ------------ */

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) return { message: 'If the account exists, an OTP has been generated.' };

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordToken = otp;
    user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
    await this.userRepo.save(user);

    await this.emailService.sendPasswordResetOtp(user.email, user.name, otp);

    return { message: 'OTP generated. Please check your email.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) throw new BadRequestException('Invalid email or OTP');

    if (user.resetPasswordToken !== dto.otp || user.resetPasswordExpires < new Date()) throw new BadRequestException('Invalid or expired OTP');

    user.password = await bcrypt.hash(dto.newPassword, 12);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await this.userRepo.save(user);

    return { message: 'Password reset successfully' };
  }

  // Add these methods to AuthService

  async getUserById(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['coach'],
    });

    if (!user) throw new NotFoundException('User not found');

    return this.serialize(user);
  }

  // async updateUser(userId: string, dto: any) {
  //   const user = await this.userRepo.findOne({ where: { id: userId } });
  //   if (!user) throw new NotFoundException('User not found');

  //   // Update allowed fields
  //   if (dto.name !== undefined) user.name = dto.name;
  //   if (dto.email !== undefined) {
  //     // Check if email is already taken by another user
  //     const existing = await this.userRepo.findOne({
  //       where: { email: dto.email, id: Not(userId) },
  //     });
  //     if (existing) throw new ConflictException('Email already taken');
  //     user.email = dto.email;
  //   }
  //   if (dto.subscriptionStart !== undefined) user.subscriptionStart = dto.subscriptionStart;
  //   if (dto.subscriptionEnd !== undefined) user.subscriptionEnd = dto.subscriptionEnd;
  //   if (dto.phone !== undefined) user.phone = dto.phone;
  //   if (dto.gender !== undefined) user.gender = dto.gender;
  //   if (dto.membership !== undefined) user.membership = dto.membership;
  //   if (dto.defaultRestSeconds !== undefined) user.defaultRestSeconds = dto.defaultRestSeconds;

  //   // Only admins can update role and status
  //   if (dto.role !== undefined) user.role = dto.role;
  //   if (dto.status !== undefined) user.status = dto.status;

  //   // Coach assignment
  //   if (dto.coachId !== undefined) {
  //     if (dto.coachId === null) {
  //       user.coach = null;
  //       user.coachId = null;
  //     } else {
  //       const coach = await this.userRepo.findOne({
  //         where: { id: dto.coachId, role: In([UserRole.COACH, UserRole.ADMIN]) },
  //       });
  //       if (!coach) throw new NotFoundException('Coach not found');
  //       user.coach = coach;
  //       user.coachId = coach.id;
  //     }
  //   }

  //   await this.userRepo.save(user);
  //   return this.serialize(user);
  // }

  async updateUser(userId: string, dto: any, actor: { id: string; role: UserRole }) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // ----- ADMIN-ONLY fields -----
    const isAdmin = actor?.role === UserRole.ADMIN;
    if (!isAdmin) {
      // Strip admin-only props if a coach sent them
      delete (dto as any).role;
      delete (dto as any).status;
      delete (dto as any).email; // optional: prevent coaches from changing email; remove if you want to allow it
    }

    // ----- Email (unique, case-insensitive) -----
    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.userRepo.createQueryBuilder('u').where('LOWER(u.email) = :email', { email }).andWhere('u.id <> :id', { id: userId }).getOne();
      if (existing) throw new ConflictException('Email already taken');
      user.email = email;
    }

    // ----- Simple fields -----
    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.phone !== undefined) user.phone = dto.phone?.trim() || null;
    if (dto.gender !== undefined) user.gender = dto.gender ?? null;
    if (dto.membership !== undefined) user.membership = dto.membership ?? null;
    if (dto.defaultRestSeconds !== undefined) user.defaultRestSeconds = dto.defaultRestSeconds;

    // ----- Password (optional) -----
    if (dto.password) {
      const salt = await bcrypt.genSalt(12);
      user.password = await bcrypt.hash(dto.password, salt);
    }

    // ----- Role/Status (admin only) -----
    if (dto.role !== undefined) {
      if (!isAdmin) throw new ForbiddenException('Only admins can change role');
      user.role = dto.role;
    }
    if (dto.status !== undefined) {
      if (!isAdmin) throw new ForbiddenException('Only admins can change status');
      user.status = dto.status;
    }

    // ----- Coach assignment -----
    if (dto.coachId !== undefined) {
      if (dto.coachId === null) {
        user.coach = null;
        user.coachId = null;
      } else {
        if (dto.coachId === user.id) throw new BadRequestException('User cannot be their own coach');
        const coach = await this.userRepo.findOne({
          where: { id: dto.coachId, role: In([UserRole.COACH, UserRole.ADMIN]) },
        });
        if (!coach) throw new NotFoundException('Coach not found');
        user.coach = coach;
        user.coachId = coach.id;
      }
    }

    // ----- Dates (sanity) -----
    if (dto.subscriptionStart !== undefined) user.subscriptionStart = dto.subscriptionStart ?? null;
    if (dto.subscriptionEnd !== undefined) user.subscriptionEnd = dto.subscriptionEnd ?? null;

    if (user.subscriptionStart && user.subscriptionEnd) {
      const start = new Date(user.subscriptionStart);
      const end = new Date(user.subscriptionEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestException('Invalid subscription dates');
      }
      if (end < start) throw new BadRequestException('subscriptionEnd must be on/after subscriptionStart');
    }

    await this.userRepo.save(user);
    return this.serialize(user);
  }

  async getCoachesForSelect() {
    const coaches = await this.userRepo.find({
      where: {
        role: In([UserRole.COACH, UserRole.ADMIN]),
        status: UserStatus.ACTIVE,
      },
      select: ['id', 'name', 'email', 'role'],
      order: { name: 'ASC' },
    });

    return coaches.map(coach => ({
      id: coach.id,
      label: coach.name,
      email: coach.email,
      role: coach.role,
    }));
  }
}
