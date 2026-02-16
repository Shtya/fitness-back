// src/todo/todo.entity.ts
import {
  Entity,
  Column,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
} from 'typeorm';
import { CoreEntity } from '../entities/global.entity';

export enum TodoRepeat {
  NONE = 'none',
  DAILY = 'daily',
  EVERY_2_DAYS = 'every-2-days',
  EVERY_3_DAYS = 'every-3-days',
  WEEKLY = 'weekly',
  BI_WEEKLY = 'bi-weekly',
  MONTHLY = 'monthly',
  CUSTOM = 'custom',
}

export enum TodoStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum TodoPriority {
  NONE = 'none',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export type TodoAttachment = {
  name: string;
  url: string;
  type: string;
  size?: number;
};

@Entity('todo_folders')
@Index(['adminId'])
export class TodoFolder extends CoreEntity {
  @Column({ type: 'varchar', length: 140 })
  name!: string;

  @Column({ type: 'varchar', length: 40, default: 'var(--color-primary-600)' })
  color!: string;

  @Column({ type: 'varchar', length: 60, default: 'Folder' })
  icon!: string;

  @Column({ type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ type: 'uuid', nullable: true })
  adminId?: string | null;

  @OneToMany(() => TodoTask, (t) => t.folder)
  tasks!: TodoTask[];
}

@Entity('todo_tasks')
@Index(['adminId'])
@Index(['adminId', 'folderId'])
@Index(['adminId', 'isStarred'])
@Index(['adminId', 'completed'])
export class TodoTask extends CoreEntity {
  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'boolean', default: false })
  completed!: boolean;

  @Column({ type: 'enum', enum: TodoStatus, default: TodoStatus.TODO })
  status!: TodoStatus;

  @Column({ type: 'enum', enum: TodoPriority, default: TodoPriority.NONE })
  priority!: TodoPriority;

  @Column({ type: 'date', nullable: true })
  dueDate?: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  dueTime?: string | null;

  @Column({ type: 'enum', enum: TodoRepeat, default: TodoRepeat.NONE })
  repeat!: TodoRepeat;

  @Column({ type: 'int', nullable: true })
  customRepeatDays?: number | null;

  @Column('text', { array: true, default: '{}' })
  tags!: string[];

  @Column({ type: 'boolean', default: false })
  isStarred!: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  attachments!: TodoAttachment[];

  @Column({ type: 'uuid', nullable: true })
  adminId?: string | null;

  @ManyToOne(() => TodoFolder, (f) => f.tasks, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'folderId' })
  folder?: TodoFolder | null;

  @Column({ type: 'uuid', nullable: true })
  folderId?: string | null;

  @Column({ type: 'int', default: 0 })
  orderIndex!: number;

  @OneToMany(() => TodoSubtask, (st) => st.task, { cascade: true })
  subtasks!: TodoSubtask[];
}

@Entity('todo_subtasks')
@Unique(['taskId', 'orderIndex'])
@Index(['taskId'])
export class TodoSubtask extends CoreEntity {
  @ManyToOne(() => TodoTask, (t) => t.subtasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task!: TodoTask;

  @Column({ type: 'uuid' })
  taskId!: string;

  @Column({ type: 'varchar', length: 240 })
  title!: string;

  @Column({ type: 'boolean', default: false })
  completed!: boolean;

  @Column({ type: 'int', default: 0 })
  orderIndex!: number;
}
