// src/todo/todo.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TodoController } from './todo.controller';
import { TodoService } from './todo.service';
import { TodoFolder, TodoSubtask, TodoTask } from 'entities/todo.entity';

@Module({
	imports: [TypeOrmModule.forFeature([TodoFolder, TodoTask, TodoSubtask])],
	controllers: [TodoController],
	providers: [TodoService],
	exports: [TodoService],
})
export class TodoModule {}
