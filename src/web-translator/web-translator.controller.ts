import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guard/jwt-auth.guard";
import { RolesGuard } from "../auth/guard/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../entities/global.entity";
import {
  ExchangePairingDto,
  LookupDto,
  SaveWordDto,
  UpdateSettingsDto,
} from "./dto/web-translator.dto";
import { WebTranslatorService } from "./web-translator.service";

const ROLES = [
  UserRole.ADMIN,
  UserRole.COACH,
  UserRole.SUPER_ADMIN,
  UserRole.CLIENT,
] as const;

@Controller("web-translator")
export class WebTranslatorController {
  constructor(private readonly service: WebTranslatorService) {}

  @Post("auth/exchange")
  exchange(@Body() dto: ExchangePairingDto, @Ip() ip: string) {
    return this.service.exchangePairing(dto, ip);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  me(@Req() req: any) {
    return this.service.me(req.user);
  }

  @Post("lookup")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  lookup(@Req() req: any, @Body() dto: LookupDto) {
    return this.service.lookup(req.user, dto);
  }

  @Get("words")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  listWords(
    @Req() req: any,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.service.listWords(
      req.user,
      q,
      Number(page || 1),
      Number(limit || 30),
    );
  }

  @Get("words/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  getWord(@Req() req: any, @Param("id") id: string) {
    return this.service.getWord(req.user, id);
  }

  @Post("words")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  saveWord(@Req() req: any, @Body() dto: SaveWordDto) {
    return this.service.saveWord(req.user, dto);
  }

  @Delete("words/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  deleteWord(@Req() req: any, @Param("id") id: string) {
    return this.service.deleteWord(req.user, id);
  }

  @Get("recent")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  recent(@Req() req: any, @Query("limit") limit?: string) {
    return this.service.recent(req.user, Number(limit || 20));
  }

  @Get("settings")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  settings(@Req() req: any) {
    return this.service.getSettings(req.user);
  }

  @Put("settings")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  updateSettings(@Req() req: any, @Body() dto: UpdateSettingsDto) {
    return this.service.updateSettings(req.user, dto);
  }

  @Post("auth/pairing")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  pairing(@Req() req: any) {
    return this.service.createPairing(req.user);
  }
}
