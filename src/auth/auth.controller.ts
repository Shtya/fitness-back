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
    return this.authService.updateProfile(req.user.id, dto);
  }

  /* ---------------------- Admin-only helpers ---------------------- */

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async listUsers(@Query() query: any) {
    // supports: ?page, ?limit, ?sortBy, ?sortOrder, ?search, ?role
    return this.authService.listUsersAdvanced(query);
  }

  @Delete('user/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deleteUser(@Param('id') id: string) {
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

  /* ---------------------- Coach / Trainer utilities ---------------------- */

  // Admin creates any user (client/coach/trainer) with auto-password, can also assign their coach right away
  @Post('admin/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createUserByAdmin(@Body() body: any) {
    return this.authService.adminCreateUser(body);
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


 
 
  /* -------- New: Stats -------- */
  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.COACH)
  stats() {
    return this.authService.getStats();
  }
 
}
