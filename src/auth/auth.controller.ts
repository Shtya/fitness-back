// --- File: src/auth/auth.controller.ts ---
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
    const targetUserId = dto.id || req.user?.id;
    return this.authService.updateProfile(targetUserId, dto);
  }

  @Get('profile/:id')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Param('id') id: string) {
    return this.authService.getUserProfile(id);
  }

  @Put('profile/:id')
  @UseGuards(JwtAuthGuard)
  async updateProfiles(@Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.authService.updateUserProfile(id, dto);
  }

  @Put('profile/:id/password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@Param('id') id: string, @Body() dto: any) {
    return this.authService.changePassword(id, dto);
  }

  /* ---------------------- Admin-only helpers ---------------------- */

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async listUsers(@Query() query: any, @Req() req: any) {
    return this.authService.listUsersAdvanced(query, req.user);
  }

  @Delete('user/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deleteUser(@Param('id') id: string) {
    return this.authService.deleteUser(id);
  }

  /* ---------------------- Super Admin utilities ---------------------- */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('super-admin/admins')
  async listAdminsForSuper(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string, // optional filter
  ) {
    return this.authService.listAdminsForSuper({ page, limit, search, status });
  }

  /* NEW: approve/suspend */
  @Put('status/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  setStatus(@Param('id') id: string, @Body('status') status: UserStatus) {
    if (!Object.values(UserStatus).includes(status)) throw new BadRequestException('Invalid status');
    return this.authService.setStatus(id, status);
  }

  // Admin creates any user (client/coach/trainer) with auto-password, can also assign their coach right away
  @Post('admin/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createUserByAdmin(@Body() body: any, @Req() req: any) {
    return this.authService.adminCreateUser(body, req?.user.id);
  }

  // List coaches (and trainers if you want them to be selectable as “coach”)
  @Get('coaches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.COACH)
  listCoaches(@Query('includeTrainers') includeTrainers?: string) {
    return this.authService.listCoaches(includeTrainers === '1' || includeTrainers === 'true');
  }

  // Assign a coach to a user (client or trainer). Admin and Coach can do it.
  @Post('coach/assign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.COACH)
  assignCoach(@Body('userId') userId: string, @Body('coachId') coachId: string) {
    if (!userId || !coachId) throw new BadRequestException('userId and coachId are required');
    return this.authService.assignCoach(userId, coachId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/:adminId/coaches')
  async getCoachesByAdmin(@Param('adminId') adminId: string, @Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string) {
    return this.authService.getCoachesByAdmin(adminId, { page, limit, search });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/:adminId/clients')
  async getClientsByAdmin(@Param('adminId') adminId: string, @Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string) {
    return this.authService.getClientsByAdmin(adminId, { page, limit, search });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.COACH)
  @Get('coach/:coachId/clients')
  async getClientsByCoach(@Param('coachId') coachId: string, @Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string) {
    // Coaches can only see their own roster; admins can see any coach
    const actor = req.user as { id: string; role: UserRole };
    const allow = actor.role === UserRole.ADMIN || (actor.role === UserRole.COACH && actor.id === coachId);
    if (!allow) throw new BadRequestException('Not allowed');

    return this.authService.getClientsByCoach(coachId, { page, limit, search });
  }

  /* -------- New: Stats -------- */
  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.COACH)
  stats(@Req() req: any) {
    return this.authService.getStats(req?.user.id);
  }

  @Get('user/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getUserById(@Param('id') id: string) {
    return this.authService.getUserById(id);
  }

  @Put('user/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async updateUser(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.authService.updateUser(id, dto, req.user);
  }

  @Get('coaches/select')
  @UseGuards(JwtAuthGuard)
  async getCoachesForSelect() {
    return this.authService.getCoachesForSelect();
  }
}
