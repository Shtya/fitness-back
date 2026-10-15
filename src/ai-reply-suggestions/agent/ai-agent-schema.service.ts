import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AI_AGENT_SCHEMA_STATEMENTS } from './ai-agent.schema';

/** Ensures the AI agent tables exist (production runs with synchronize off). */
@Injectable()
export class AiAgentSchemaService implements OnModuleInit {
	private readonly logger = new Logger(AiAgentSchemaService.name);
	private ready: Promise<void> | null = null;

	constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

	onModuleInit() {
		return this.ensure();
	}

	ensure() {
		if (!this.ready) {
			this.ready = (async () => {
				for (const statement of AI_AGENT_SCHEMA_STATEMENTS) {
					try {
						await this.dataSource.query(statement);
					} catch (error) {
						this.logger.error(
							`Could not ensure AI agent table: ${error instanceof Error ? error.message : error}`,
						);
					}
				}
			})();
		}
		return this.ready;
	}
}
