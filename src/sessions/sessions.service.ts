// src/sessions/sessions.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkoutSession } from 'entities/global.entity';
import { CreateSessionDto } from './session.dto';
@Injectable()
export class SessionsService {
  constructor(@InjectRepository(WorkoutSession) private repo: Repository<WorkoutSession>) {}

  my(userId: string) {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' as any } });
  }

  async create(userId: string, dto: CreateSessionDto) {
    const s = this.repo.create({ ...dto, userId, planId: dto.planId ?? null });
    return this.repo.save(s);
  }
}
