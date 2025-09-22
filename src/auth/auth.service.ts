import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { User, UserRole, UserStatus } from 'entities/global.entity';
import { RegisterDto, LoginDto, UpdateProfileDto, ResetPasswordDto, ForgotPasswordDto } from 'dto/auth.dto';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'common/nodemailer';
 
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) public userRepo: Repository<User>,
    private jwt: JwtService,
    private cfg: ConfigService,
    public emailService: MailService,
   ) {}

  /* ===================== Core ===================== */

  private signAccess(id: string) {
    return this.jwt.sign({ id }, { secret: this.cfg.get<string>('JWT_SECRET')!, expiresIn: this.cfg.get<string>('JWT_EXPIRE') || '1d' });
  }
  private signRefresh(id: string) {
    return this.jwt.sign({ id }, { secret: this.cfg.get<string>('JWT_REFRESH') || this.cfg.get<string>('JWT_SECRET')!, expiresIn: this.cfg.get<string>('JWT_REFRESH_EXPIRE') || '7d' });
  }
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
      ...(tokens ?? {}),
      created_at: (u as any).created_at,
      updated_at: (u as any).updated_at,
    };
  }

  /* ===================== Endpoints ===================== */

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
		console.log("user");
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

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.defaultRestSeconds !== undefined) user.defaultRestSeconds = dto.defaultRestSeconds;
    if (dto.activePlanId !== undefined) user.activePlanId = dto.activePlanId;
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
