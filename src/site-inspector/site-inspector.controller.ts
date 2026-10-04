import { Body, Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "../../entities/global.entity";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guard/jwt-auth.guard";
import { RolesGuard } from "../auth/guard/roles.guard";
import { AnalyzeSiteDto, SiteInsightsDto } from "./dto/site-inspector.dto";
import { SiteInspectorService } from "./site-inspector.service";

const ROLES = [
  UserRole.ADMIN,
  UserRole.COACH,
  UserRole.SUPER_ADMIN,
  UserRole.CLIENT,
] as const;

@Controller("site-inspector")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES)
export class SiteInspectorController {
  constructor(private readonly service: SiteInspectorService) {}

  @Post("analyze")
  @HttpCode(200)
  analyze(@Req() req: any, @Body() dto: AnalyzeSiteDto) {
    return this.service.analyze(req.user, dto);
  }

  @Post("insights")
  @HttpCode(200)
  insights(@Req() req: any, @Body() dto: SiteInsightsDto) {
    return this.service.insights(req.user, dto);
  }
}
