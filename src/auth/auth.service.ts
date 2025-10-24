import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In, IsNull } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { MealPlan, Notification, NotificationAudience, NotificationType, ExercisePlan, User, UserRole, UserStatus, FoodSuggestion } from 'entities/global.entity';
import { RegisterDto, LoginDto, UpdateProfileDto, ResetPasswordDto, ForgotPasswordDto } from 'dto/auth.dto';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'common/nodemailer';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) public userRepo: Repository<User>,
    @InjectRepository(ExercisePlan) private readonly planRepo: Repository<ExercisePlan>,
    @InjectRepository(MealPlan) private readonly mealPlanRepo: Repository<MealPlan>,
    @InjectRepository(Notification) private readonly notifRepo: Repository<Notification>,
    @InjectRepository(FoodSuggestion) private readonly suggestionRepo: Repository<FoodSuggestion>,
    private jwt: JwtService,
    private cfg: ConfigService,
    public emailService: MailService,
  ) {}

  /* Utility to normalize pagination */
  private normPaged(q?: { page?: string | number; limit?: string | number }) {
    const page = Math.max(1, Number(q?.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q?.limit ?? 20)));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
  }

  private likeable(search?: string) {
    const s = (search ?? '').trim();
    return s ? `%${s}%` : null;
  }

  /** Enforce that the calling admin can only access their own hierarchy */
  private ensureSameAdminOrThrow(requestingAdminId: string, targetAdminId: string) {
    if (requestingAdminId !== targetAdminId) {
      throw new ForbiddenException('You can only access your own hierarchy');
    }
  }

  /** Return coaches created/owned by an admin (via adminId) */
  async getCoachesByAdmin(adminId: string, opts?: { page?: string | number; limit?: string | number; search?: string }) {
    // Optional: if you want to limit to the caller admin only, uncomment and pass req.user.id to this method.
    // this.ensureSameAdminOrThrow(requestingAdminId, adminId);

    const { page, limit, skip } = this.normPaged(opts);
    const qb = this.userRepo.createQueryBuilder('u').select(['u.id', 'u.name', 'u.email', 'u.phone', 'u.status', 'u.created_at']).where('u.role = :role', { role: UserRole.COACH }).andWhere('u.adminId = :adminId', { adminId }).orderBy('u.created_at', 'DESC').skip(skip).take(limit);

    const s = this.likeable(opts?.search);
    if (s) qb.andWhere('(u.email ILIKE :s OR u.name ILIKE :s OR u.phone ILIKE :s)', { s });

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  /** Return clients owned by an admin (via adminId) */
  async getClientsByAdmin(adminId: string, opts?: { page?: string | number; limit?: string | number; search?: string }) {
    const { page, limit, skip } = this.normPaged(opts);
    const qb = this.userRepo.createQueryBuilder('u').leftJoin('u.coach', 'coach').select(['u.id', 'u.name', 'u.email', 'u.phone', 'u.status', 'u.created_at', 'u.coachId', 'coach.id', 'coach.name']).where('u.role = :role', { role: UserRole.CLIENT }).andWhere('u.adminId = :adminId', { adminId }).orderBy('u.created_at', 'DESC').skip(skip).take(limit);

    const s = this.likeable(opts?.search);
    if (s) qb.andWhere('(u.email ILIKE :s OR u.name ILIKE :s OR u.phone ILIKE :s)', { s });

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        status: u.status,
        coach: u.coach ? { id: u.coach.id, name: (u.coach as any).name } : null,
        created_at: u.created_at,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Return clients assigned to a coach (via coachId) */
  async getClientsByCoach(coachId: string, opts?: { page?: string | number; limit?: string | number; search?: string }) {
    const { page, limit, skip } = this.normPaged(opts);
    const qb = this.userRepo.createQueryBuilder('u').select(['u.id', 'u.name', 'u.email', 'u.phone', 'u.status', 'u.created_at', 'u.adminId']).where('u.role = :role', { role: UserRole.CLIENT }).andWhere('u.coachId = :coachId', { coachId }).orderBy('u.created_at', 'DESC').skip(skip).take(limit);

    const s = this.likeable(opts?.search);
    if (s) qb.andWhere('(u.email ILIKE :s OR u.name ILIKE :s OR u.phone ILIKE :s)', { s });

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  /* ===================== Core ===================== */

  async getStats(adminId: string) {
    if (!adminId) {
      throw new BadRequestException('adminId is required');
    }

    const whereBase = { adminId };

    const [totalUsers, activeUsers, coaches, clients] = await Promise.all([
      this.userRepo.count({ where: whereBase }),
      this.userRepo.count({
        where: { ...whereBase, status: UserStatus.ACTIVE },
      }),
      this.userRepo.count({
        where: { ...whereBase, role: UserRole.COACH },
      }),
      this.userRepo.count({
        where: { ...whereBase, role: UserRole.CLIENT },
      }),
    ]);

    return {
      totalUsers,
      activeUsers,
      coaches,
      clients,
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

  // auth.service.ts
  async listUsersAdvanced(query: any, actor?: { id: string; role: UserRole }) {
    const page = Number(query.page ?? 1);
    const limit = Math.min(Number(query.limit ?? 10), 100);
    const sortBy = query.sortBy ?? 'created_at';
    const sortOrder: 'ASC' | 'DESC' = (String(query.sortOrder || 'DESC').toUpperCase() as any) === 'ASC' ? 'ASC' : 'DESC';
    const search = (query.search || '').trim();
    const role = (query.role || '').toLowerCase();
    const includePlans = String(query.includePlans || '').toLowerCase() === 'true';
    const includeMeals = String(query.includeMeals || '').toLowerCase() === 'true';
    const myOnly = ['1', 'true', true].includes((query.myOnly ?? '').toString().toLowerCase());

    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.coach', 'coach')
      .orderBy(`user.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    // ====== SCOPING (myOnly) ======
    if (actor) {
      if (actor.role === UserRole.ADMIN) {
        // Always restrict admin to their own hierarchy
        qb.andWhere('user.adminId = :adminId', { adminId: actor.id });

        // If no explicit role filter, only return client & coach
        const roleLower = role; // from query
        if (!roleLower) {
          qb.andWhere('user.role IN (:...roles)', { roles: [UserRole.CLIENT, UserRole.COACH] });
        } else {
          // If role is provided, allow only intersection with {client, coach}
          if (roleLower === 'client') {
            qb.andWhere('user.role = :rClient', { rClient: UserRole.CLIENT });
          } else if (roleLower === 'coach') {
            qb.andWhere('user.role = :rCoach', { rCoach: UserRole.COACH });
          } else {
            // Admin asked for something outside {client, coach} -> no results
            qb.andWhere('1=0');
          }
        }
      } else if (myOnly) {
        if (actor.role === UserRole.COACH) {
          // Coach sees only their clients
          qb.andWhere('user.role = :clientRole AND user.coachId = :coachId', {
            clientRole: UserRole.CLIENT,
            coachId: actor.id,
          });
        } else if (actor.role === UserRole.CLIENT) {
          // Client sees only their coach (0..1)
          const me = await this.userRepo.findOne({ where: { id: actor.id } });
          const coachId = me?.coachId ?? '00000000-0000-0000-0000-000000000000';
          qb.andWhere('user.id = :coachId', { coachId });
        }
      }
    }

    // ====== Search ======
    if (search) {
      qb.andWhere('(user.email ILIKE :q OR user.name ILIKE :q OR user.phone ILIKE :q)', { q: `%${search}%` });
    }

    // ====== Role filter (ONLY for non-admins and when not overridden above) ======
    if (!actor || actor.role !== UserRole.ADMIN) {
      const VALID_ROLES = ['admin', 'coach', 'trainer', 'client'] as const;
      if (role) {
        if (role === 'coach') {
          qb.andWhere('user.role IN (:...roles)', { roles: ['coach', 'admin'] });
        } else if (VALID_ROLES.includes(role as any)) {
          qb.andWhere('user.role = :role', { role });
        }
      }
    }

    const [users, total] = await qb.getManyAndCount();

    // ===== batch load exercise plans by id
    let plansById: Record<string, ExercisePlan> = {};
    const planIds = users.map(u => u.activeExercisePlanId).filter((x): x is string => !!x);
    if (planIds.length) {
      const plans = await this.planRepo.find({
        where: { id: In(planIds) },
        relations: includePlans ? ['days', 'days.exercises'] : [],
      });
      plansById = Object.fromEntries(plans.map(p => [p.id, p]));
    }

    // ===== batch load meal plans by id
    let mealPlansById: Record<string, MealPlan> = {};
    const mealIds = users.map(u => u.activeMealPlanId).filter((x): x is string => !!x);
    if (mealIds.length) {
      const mps = await this.mealPlanRepo.find({
        where: { id: In(mealIds) },
        relations: includeMeals ? ['days', 'days.foods'] : [],
      });
      mealPlansById = Object.fromEntries(mps.map(p => [p.id, p]));
    }

    return {
      users: users.map(u => {
        const base = this.serialize(u);
        const out: any = {
          ...base,
          activePlanId: u.activeExercisePlanId ?? null,
          activeMealPlanId: u.activeMealPlanId ?? null,
        };

        // workout plan attach
        if (u.activeExercisePlanId && plansById[u.activeExercisePlanId]) {
          const p: any = plansById[u.activeExercisePlanId];
          out.activePlan = includePlans
            ? {
                id: p.id,
                name: p.name,
                isActive: p.isActive,
                days: (p.days || []).map(d => ({
                  id: d.id,
                  day: d.day,
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
            : { id: p.id, name: p.name, isActive: p.isActive };
        } else {
          out.activePlan = null;
        }

        // meal plan attach
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
            : { id: mp.id, name: mp.name, isActive: mp.isActive };
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

  async listAdminsForSuper(query: any) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const skip = (page - 1) * limit;
    const search = (query.search || '').trim();
    const status = (query.status || '').trim(); // optional: pending/active/suspended

    const qb = this.userRepo.createQueryBuilder('u').select(['u.id', 'u.name', 'u.email', 'u.phone', 'u.status', 'u.created_at']).where('u.role = :role', { role: UserRole.ADMIN }).orderBy('u.created_at', 'DESC').skip(skip).take(limit);

    if (search) {
      qb.andWhere('(u.email ILIKE :s OR u.name ILIKE :s OR u.phone ILIKE :s)', { s: `%${search}%` });
    }
    if (status) {
      qb.andWhere('u.status = :status', { status });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  async adminCreateUser(body: any, userId) {
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
      activeExercisePlanId: null,
      defaultRestSeconds: 90,
      lastLogin: null,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      adminId: userId,
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
      activeExercisePlanId: null,
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
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['activeExercisePlan', 'activeMealPlan'] });
    if (!user) throw new UnauthorizedException('User not found');
    return this.serialize(user);
  }

  // tweak updateProfile if you want to accept gender (and ignore coachId here)
  // async updateProfile(userId: string, dto: UpdateProfileDto) {
  //   const user = await this.userRepo.findOne({ where: { id: userId } });
  //   if (!user) throw new NotFoundException('User not found');
  //   if (dto.name !== undefined) user.name = dto.name;
  //   if (dto.defaultRestSeconds !== undefined) user.defaultRestSeconds = dto.defaultRestSeconds;
  //   if (dto.activePlanId !== undefined) user.activeExercisePlanId = dto.activePlanId;
  //   if ((dto as any).gender !== undefined) (user as any).gender = (dto as any).gender;
  //   await this.userRepo.save(user);
  //   return this.serialize(user);
  // }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user: any = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const set = (key: keyof typeof user, v: any) => {
      if (typeof v !== 'undefined') user[key] = (v === '' ? null : v) as any;
    };

    set('name', dto.name);
    set('defaultRestSeconds', dto.defaultRestSeconds);
    set('activeExercisePlanId', dto.activePlanId);
    set('gender' as any, (dto as any).gender);

    // nutrition (kcal / g per day)
    set('caloriesTarget' as any, dto.caloriesTarget ?? null);
    set('proteinPerDay' as any, dto.proteinPerDay ?? null);
    set('carbsPerDay' as any, dto.carbsPerDay ?? null);
    set('fatsPerDay' as any, dto.fatsPerDay ?? null);

    // activity level (normalize to enum or null)
    if (typeof dto.activityLevel !== 'undefined') {
      const v = dto.activityLevel;
      user.activityLevel = v;
    }

    set('notes' as any, dto.notes ?? null);

    await this.userRepo.save(user);
    return this.serialize(user);
  }

  async getAllUsers(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [users, total] = await this.userRepo.findAndCount({
      skip,
      take: limit,
      order: { created_at: 'DESC' as any },
    });
    return { users, total, page, totalPages: Math.ceil(total / limit) };
  }

  async deleteUser(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.userRepo.remove(user);
    return { message: 'User deleted' };
  }

  async setStatus(userId: string, status: UserStatus) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.status = status;
    await this.userRepo.save(user);
    return this.serialize(user);
  }

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

  async getUserById(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['coach'],
    });

    if (!user) throw new NotFoundException('User not found');

    return this.serialize(user);
  }

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

  async getUserProfile(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['coach', 'activeExercisePlan', 'activeMealPlan'],
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      ...user,
      coach: user.coach ? { id: user.coach.id, name: user.coach.name } : null,
      activePlan: user.activeExercisePlan ? { id: user.activeExercisePlan.id, name: user.activeExercisePlan.name } : null,
      activeMealPlan: user.activeMealPlan ? { id: user.activeMealPlan.id, name: user.activeMealPlan.name } : null,
    };
  }

  async updateUserProfile(userId: string, dto: any) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Update allowed fields
    const allowedFields = ['name', 'phone', 'gender', 'membership', 'defaultRestSeconds'];
    allowedFields.forEach(field => {
      if (dto[field] !== undefined) user[field] = dto[field];
    });

    await this.userRepo.save(user);
    return this.serialize(user);
  }

  async changePassword(userId: string, dto: { currentPassword: string; newPassword: string }) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'password'],
    });

    if (!user) throw new NotFoundException('User not found');

    const isCurrentValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isCurrentValid) throw new BadRequestException('Current password is incorrect');

    user.password = await bcrypt.hash(dto.newPassword, 12);
    await this.userRepo.save(user);

    return { message: 'Password updated successfully' };
  }
}
