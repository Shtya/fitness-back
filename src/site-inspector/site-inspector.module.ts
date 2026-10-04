import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AiFreeModule } from "../ai-free/ai-free.module";
import { AuthModule } from "../auth/auth.module";
import { SiteInspectorController } from "./site-inspector.controller";
import { SiteInspectorService } from "./site-inspector.service";

@Module({
  imports: [ConfigModule, AuthModule, AiFreeModule],
  controllers: [SiteInspectorController],
  providers: [SiteInspectorService],
})
export class SiteInspectorModule {}
