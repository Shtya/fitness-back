import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { User, UserRole, UserStatus } from 'entities/global.entity';
import { RegisterDto, LoginDto, UpdateProfileDto, ResetPasswordDto, ForgotPasswordDto } from 'dto/auth.dto';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'common/nodemailer';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) public userRepo: Repository<User>,
    private jwt: JwtService,
    private cfg: ConfigService,
    public emailService: MailService,
  ) {}

  /* ===================== Core ===================== */

	 async getStats() {
    const [totalUsers, activeUsers, pendingUsers, suspendedUsers, admins, coaches, clients] = await Promise.all([
      this.userRepo.count(),
      this.userRepo.count({ where: { status: UserStatus.ACTIVE } }),
      this.userRepo.count({ where: { status: UserStatus.PENDING} }),
      this.userRepo.count({ where: { status: UserStatus.SUSPENDED } }),
      this.userRepo.count({ where: { role: UserRole.ADMIN } }),
      this.userRepo.count({ where: { role: UserRole.COACH } }),
      this.userRepo.count({ where: { role: UserRole.CLIENT } }),
    ]);

    // With/without plans — using activePlanId as a proxy
    const withPlans = await this.userRepo.count({ where: { activePlanId: Not(null) as any } });
    const withoutPlans = totalUsers - withPlans;

    return { totalUsers, activeUsers, pendingUsers, suspendedUsers, admins, coaches, clients, withPlans, withoutPlans };
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
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      points: u.points,
      defaultRestSeconds: u.defaultRestSeconds,
      activePlanId: u.activePlanId,
      lastLogin: u.lastLogin,
      coachId: (u as any).coachId ?? u.coach?.id ?? null, // ← ADD
      coachName: u.coach?.name ?? null, // ← ADD
      ...(tokens ?? {}),
      created_at: (u as any).created_at,
      updated_at: (u as any).updated_at,
    };
  }

  /* ===================== Endpoints ===================== */

  // ADD this method in AuthService
  async listUsersAdvanced(query: any) {
    const page = Number(query.page ?? 1);
    const limit = Math.min(Number(query.limit ?? 10), 100);
    const sortBy = query.sortBy ?? 'created_at';
    const sortOrder: 'ASC' | 'DESC' = (String(query.sortOrder || 'DESC').toUpperCase() as any) === 'ASC' ? 'ASC' : 'DESC';
    const search = (query.search || '').trim();
    const role = (query.role || '').toLowerCase();

    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.coach', 'coach') // ← join coach for name
      .orderBy(`user.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    if (search) {
      qb.andWhere('(user.email ILIKE :q OR user.name ILIKE :q OR user.phone ILIKE :q)', { q: `%${search}%` });
    }
    if (role && ['admin', 'coach', 'trainer', 'client'].includes(role)) {
      qb.andWhere('user.role = :role', { role });
    }

    const [users, total] = await qb.getManyAndCount();
    return {
      users: users.map(u => this.serialize(u)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adminCreateUser(body: any) {
    const { name, email, role, phone, gender, membership, coachId } = body || {};
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

  async login(dto: LoginDto) {
    console.log('user');
    const user = await this.userRepo.createQueryBuilder('user').addSelect('user.password').where('user.email = :email', { email: dto.email }).getOne();

    if (!user || !(await bcrypt.compare(dto.password, user.password))) throw new UnauthorizedException('Incorrect email or password');

    if (user.status !== UserStatus.ACTIVE) {
      // Block login for pending/suspended users
      throw new UnauthorizedException(user.status === UserStatus.PENDING ? 'Your account is pending approval.' : 'Your account is suspended.');
    }

    // Reward points on successful login
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
}
