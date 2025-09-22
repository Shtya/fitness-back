

import { Controller, Post, Get, Put, Delete, Body, Res, Req, UseGuards, Query, Param, BadRequestException } from '@nestjs/common';
import { Response, Request } from 'express';

import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guard/jwt-auth.guard';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guard/roles.guard';
import { UserRole, UserStatus } from 'entities/global.entity';
import { RegisterDto, LoginDto, UpdateProfileDto, RefreshDto, PagedQueryDto, ResetPasswordDto, ForgotPasswordDto } from 'dto/auth.dto';
import { CRUD } from 'common/crud.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /* ---------------------- Email/Password Auth ---------------------- */

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res() res: Response) {
    const result = await this.authService.login(dto);
    return res.json(result);
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    if (!dto.refreshToken) throw new BadRequestException('Refresh token required');
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Res() res: Response) {
    // if you ever set httpOnly cookies, clear here — currently we just return tokens in JSON
    return res.json({ message: 'Logged out' });
  }

  /* ---------------------- Current User ---------------------- */

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    return this.authService.getCurrentUser(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.id, dto);
  }

  /* ---------------------- Admin-only helpers (optional) ---------------------- */

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async listUsers(@Query() query: any) {
		return CRUD.findAll(
					this.authService.userRepo,
					'user',
					query.search,
					query.page,
					query.limit,
					query.sortBy,
					query.sortOrder,
					[],
					['email' , "name" , "phone"],
					{},
				);
  }

  @Delete('user/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deleteUser(@Param('id') id: string) {
    return this.authService.deleteUser(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('protected')
  protected(@Req() req: any) {
    return { message: `Hello ${req.user.name}, you're authenticated.` };
  }

  /* NEW: Forgot/Reset */
  @Post('forgot-password') forgot(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }
  @Post('reset-password') reset(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /* Admin helpers */
  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  list(@Query() q: PagedQueryDto) {
    return this.authService.getAllUsers(q.page, q.limit);
  }

  @Delete('user/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.authService.deleteUser(id);
  }

  /* NEW: approve/suspend */
  @Put('status/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  setStatus(@Param('id') id: string, @Body('status') status: UserStatus) {
    if (!Object.values(UserStatus).includes(status)) throw new BadRequestException('Invalid status');
    return this.authService.setStatus(id, status);
  }
}
