import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guard/jwt-auth.guard";
import { RolesGuard } from "../auth/guard/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../entities/global.entity";
import { AiFreeService } from "./ai-free.service";
import { AiFreeChatDto, AiFreeTitleDto } from "./dto/ai-free.dto";

@Controller("ai-free")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiFreeController {
  constructor(private readonly aiFree: AiFreeService) {}

  @Get("providers")
  @Roles(
    UserRole.ADMIN,
    UserRole.COACH,
    UserRole.SUPER_ADMIN,
    UserRole.CLIENT,
  )
  listProviders() {
    return this.aiFree.listProviders();
  }

  @Get("knowledge")
  @Roles(
    UserRole.ADMIN,
    UserRole.COACH,
    UserRole.SUPER_ADMIN,
    UserRole.CLIENT,
  )
  knowledge() {
    return this.aiFree.knowledgeStatus();
  }

  @Post("title")
  @Roles(
    UserRole.ADMIN,
    UserRole.COACH,
    UserRole.SUPER_ADMIN,
    UserRole.CLIENT,
  )
  title(@Req() req: any, @Body() body: AiFreeTitleDto) {
    return this.aiFree.generateTitle(req.user, body);
  }

  @Post("chat")
  @Roles(
    UserRole.ADMIN,
    UserRole.COACH,
    UserRole.SUPER_ADMIN,
    UserRole.CLIENT,
  )
  chat(@Req() req: any, @Body() body: AiFreeChatDto) {
    return this.aiFree.chat(req.user, body);
  }
}
