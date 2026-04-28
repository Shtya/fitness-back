import { Entity, Column, Index } from 'typeorm';
import { CoreEntity } from './core.entity';

@Entity('report_configs')
export class ReportConfig extends CoreEntity {
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  coachId: string;

  @Column({ type: 'jsonb', default: '{}' })
  config: Record<string, any>;
}
