// src/coaching/coaching.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserCoach } from 'entities/global.entity';

@Injectable()
export class CoachingService {
  constructor(@InjectRepository(UserCoach) private userCoachRepo: Repository<UserCoach>) {}

  async coachAssignedToClient(coachId: string, clientId: string) {
    const link = await this.userCoachRepo.findOne({ where: { coachId, clientId } });
    return !!link;
  }
}
