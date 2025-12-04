// entities/weekly-report.entity.ts
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { CoreEntity } from './core.entity';
import { User } from './global.entity';

@Entity('weekly_reports')
export class WeeklyReport extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  coachId: string;

  @Column({ type: 'uuid', nullable: true })
  adminId: string;

  @Column({ type: 'date' })
  weekOf: string;

  // Diet Section
  @Column({ type: 'jsonb' })
  diet: {
    hungry: 'yes' | 'no';
    mentalComfort: 'yes' | 'no';
    wantSpecific: string;
    foodTooMuch: 'yes' | 'no';
    dietDeviation: {
      hasDeviation: 'yes' | 'no';
      times: string | null;
      details: string | null;
    };
  };

  // Training Section
  @Column({ type: 'jsonb' })
  training: {
    intensityOk: 'yes' | 'no';
    daysDeviation: {
      hasDeviation: 'yes' | 'no';
      count: string | null;
      reason: string | null;
    };
    shapeChange: 'yes' | 'no';
    fitnessChange: 'yes' | 'no';
    sleep: {
      enough: 'yes' | 'no';
      hours: string | null;
    };
    programNotes: string;
    cardioAdherence: number;
  };

  // Measurements
  @Column({ type: 'jsonb', nullable: true })
  measurements: {
    date: string;
    weight: number | null;
    waist: number | null;
    chest: number | null;
    hips: number | null;
    arms: number | null;
    thighs: number | null;
  } | null;

  // Photos
  @Column({ type: 'jsonb' })
  photos: {
    front: { url: string } | null;
    back: { url: string } | null;
    left: { url: string } | null;
    right: { url: string } | null;
    extras: any[];
  };

  // هل العميل قرأ ملاحظة الكوتش/الأدمن؟
  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @Column({ type: 'text', nullable: true })
  coachFeedback: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewedById' })
  reviewedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedById: string | null;
}
