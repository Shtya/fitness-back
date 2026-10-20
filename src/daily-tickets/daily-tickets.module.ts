import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyTicket } from 'entities/daily-ticket.entity';
import { DailyTicketsController } from './daily-tickets.controller';
import { DailyTicketsService } from './daily-tickets.service';

@Module({
	imports: [TypeOrmModule.forFeature([DailyTicket])],
	controllers: [DailyTicketsController],
	providers: [DailyTicketsService],
})
export class DailyTicketsModule {}
