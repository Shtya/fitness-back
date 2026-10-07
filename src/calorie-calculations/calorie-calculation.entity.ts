import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('calorie_calculations')
export class CalorieCalculation {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ type: 'uuid' })
	ownerId: string;

	@Column({ type: 'varchar', length: 120 })
	name: string;

	@Column({ type: 'varchar', length: 16 })
	sex: string;

	@Column({ type: 'int' })
	age: number;

	@Column({ type: 'numeric' })
	height: string;

	@Column({ type: 'numeric' })
	weight: string;

	@Column({ type: 'numeric', nullable: true })
	bodyFat: string | null;

	@Column({ type: 'varchar', length: 16 })
	activity: string;

	@Column({ type: 'varchar', length: 8 })
	goal: string;

	@Column({ type: 'jsonb' })
	targets: Record<string, number | string>;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;
}
