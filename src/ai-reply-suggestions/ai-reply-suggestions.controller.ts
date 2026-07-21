import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guard/jwt-auth.guard";
import { RolesGuard } from "../auth/guard/roles.guard";
import {
  GenerateAiReplySuggestionsDto,
  TestAiReplyProviderDto,
  UpdateAiReplySettingsDto,
} from "./dto/ai-reply-suggestions.dto";
import { AiReplySuggestionsService } from "./services/ai-reply-suggestions.service";

@Controller("whatsapp")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiReplySuggestionsController {
  constructor(private readonly suggestions: AiReplySuggestionsService) {}

  @Get("accounts/:accountId/ai/settings")
  getSettings(@Req() req: any, @Param("accountId") accountId: string) {
    return this.suggestions.getSettings(req.user, accountId);
  }

  @Put("accounts/:accountId/ai/settings")
  updateSettings(
    @Req() req: any,
    @Param("accountId") accountId: string,
    @Body() body: UpdateAiReplySettingsDto,
  ) {
    return this.suggestions.updateSettings(req.user, accountId, body);
  }

  @Post("ai/test")
  testProvider(@Req() req: any, @Body() body: TestAiReplyProviderDto) {
    return this.suggestions.testProvider(req.user, body);
  }

  @Post("conversations/:conversationId/ai-suggestions")
  generate(
    @Req() req: any,
    @Param("conversationId") conversationId: string,
    @Body() body: GenerateAiReplySuggestionsDto,
  ) {
    return this.suggestions.generate(req.user, conversationId, body);
  }
}
