import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { CoreEntity } from './core.entity';
import { User } from './global.entity';

@Entity('progress_photos')
export class ProgressPhoto extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'date' })
  takenAt: string; // YYYY-MM-DD

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  weight: number | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'jsonb', nullable: true })
  sides: {
    front?: string;
    back?: string;
    left?: string;
    right?: string;
  };
}

@Entity('body_measurements')
@Unique('uq_user_date', ['userId', 'date'])
export class BodyMeasurement extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'date' })
  date: string; // YYYY-MM-DD

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  weight: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  waist: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  chest: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  hips: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  arms: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  thighs: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  height: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  shoulderWidth: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  inseam: number | null;

  @Column({ type: 'varchar', length: 8, default: 'cm' })
  unit: string;

  @Column({ type: 'varchar', length: 32, default: 'manual' })
  source: string;

  @Column({ type: 'jsonb', nullable: true })
  confidence: Record<string, number | null> | null;
}