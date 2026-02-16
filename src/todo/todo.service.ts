// src/todo/todo.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TodoFolder, TodoSubtask, TodoTask, TodoStatus } from 'entities/todo.entity';

@Injectable()
export class TodoService {
  constructor(
    @InjectRepository(TodoFolder) private readonly folderRepo: Repository<TodoFolder>,
    @InjectRepository(TodoTask) private readonly taskRepo: Repository<TodoTask>,
    @InjectRepository(TodoSubtask) private readonly subtaskRepo: Repository<TodoSubtask>,
  ) {}

  /* =========================
   * Folders
   * ========================= */
  async listFolders(adminId: string) {
    return this.folderRepo.find({
      where: { adminId },
      order: { created_at: 'ASC' },
    });
  }

  async createFolder(adminId: string, dto: any) {
    const folder = this.folderRepo.create({
      name: String(dto?.name ?? '').trim(),
      color: dto?.color ?? 'var(--color-primary-600)',
      icon: dto?.icon ?? 'Folder',
      isSystem: !!dto?.isSystem,
      adminId,
    });
    if (!folder.name) throw new BadRequestException('Folder name is required');
    return this.folderRepo.save(folder);
  }

  async updateFolder(adminId: string, id: string, dto: any) {
    const folder = await this.folderRepo.findOne({ where: { id, adminId } });
    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.isSystem) throw new BadRequestException('Cannot update system folder');
    Object.assign(folder, dto);
    return this.folderRepo.save(folder);
  }

  async deleteFolder(adminId: string, id: string) {
    const folder = await this.folderRepo.findOne({ where: { id, adminId } });
    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.isSystem) throw new BadRequestException('Cannot delete system folder');

    // move tasks to inbox = NULL
    await this.taskRepo.update({ adminId, folderId: id }, { folderId: null });

    await this.folderRepo.remove(folder);
    return { ok: true };
  }

  /* =========================
   * Tasks (list / CRUD)
   * ========================= */
  async listTasks(adminId: string, query: any) {
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.subtasks', 'st')
      .where('t.adminId = :adminId', { adminId });

    // IMPORTANT: default return ALL tasks
    // if you want server filtering later, add query.view etc.
    if (query?.folderId) {
      if (query.folderId === 'inbox') qb.andWhere('t.folderId IS NULL');
      else qb.andWhere('t.folderId = :folderId', { folderId: query.folderId });
    }
    if (query?.isStarred === 'true') qb.andWhere('t.isStarred = true');

    const includeCompleted = query?.includeCompleted === 'true' || query?.includeCompleted === true;
    if (!includeCompleted) qb.andWhere('t.completed = false');

    if (query?.priority) qb.andWhere('t.priority = :priority', { priority: query.priority });

    const sort = query?.sort ?? 'manual';
    if (sort === 'dueDate') {
      qb.orderBy('t.dueDate', 'ASC', 'NULLS LAST').addOrderBy('t.dueTime', 'ASC', 'NULLS LAST');
    } else if (sort === 'priority') {
      qb.addSelect(
        `
        CASE t.priority
          WHEN 'urgent' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END
      `,
        'priority_rank',
      );
      qb.orderBy('priority_rank', 'ASC').addOrderBy('t.orderIndex', 'ASC');
    } else if (sort === 'alphabetical') {
      qb.orderBy('t.title', 'ASC');
    } else {
      qb.orderBy('t.orderIndex', 'ASC').addOrderBy('t.created_at', 'ASC');
    }

    qb.addOrderBy('st.orderIndex', 'ASC');

    return qb.getMany();
  }

  async getTask(adminId: string, id: string) {
    const task = await this.taskRepo.findOne({
      where: { id, adminId },
      relations: { subtasks: true },
      order: { subtasks: { orderIndex: 'ASC' } },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private normalizeFolderId(input: any): string | null {
    const v = input == null ? null : String(input);
    if (!v || v === 'inbox' || v === 'today' || v === 'starred') return null;
    // only allow UUID folder IDs in DB (no auto-creating folders by name)
    if (!/^[0-9a-fA-F-]{36}$/.test(v)) throw new BadRequestException('folderId must be a UUID (or inbox)');
    return v;
  }

  async createTask(adminId: string, dto: any) {
    const title = String(dto?.title ?? '').trim();
    if (!title) throw new BadRequestException('title is required');

    const folderId = this.normalizeFolderId(dto?.folderId);

    const task = this.taskRepo.create({
      title,
      notes: dto?.notes ?? '',
      completed: !!dto?.completed,
      status: !!dto?.completed ? TodoStatus.COMPLETED : (dto?.status ?? TodoStatus.TODO),
      priority: dto?.priority ?? 'none',
      dueDate: dto?.dueDate ?? null,
      dueTime: dto?.dueTime ?? null,
      repeat: dto?.repeat ?? 'none',
      customRepeatDays: dto?.customRepeatDays ?? null,
      tags: Array.isArray(dto?.tags) ? dto.tags : [],
      isStarred: !!dto?.isStarred,
      attachments: Array.isArray(dto?.attachments) ? dto.attachments : [],
      folderId,
      adminId,
      orderIndex: typeof dto?.orderIndex === 'number' ? dto.orderIndex : 0,
    });

    return this.taskRepo.save(task);
  }

  async updateTask(adminId: string, id: string, dto: any) {
    const task = await this.taskRepo.findOne({ where: { id, adminId }, relations: { subtasks: true } });
    if (!task) throw new NotFoundException('Task not found');

    if (dto?.title !== undefined) {
      const title = String(dto.title ?? '').trim();
      if (!title) throw new BadRequestException('title cannot be empty');
      task.title = title;
    }

    if (dto?.folderId !== undefined) task.folderId = this.normalizeFolderId(dto.folderId);

    // simple scalar updates
    const fields = [
      'notes',
      'completed',
      'status',
      'priority',
      'dueDate',
      'dueTime',
      'repeat',
      'customRepeatDays',
      'tags',
      'isStarred',
      'attachments',
      'orderIndex',
    ];
    for (const f of fields) {
      if (dto?.[f] !== undefined) (task as any)[f] = dto[f];
    }

    // keep status in sync
    if (typeof dto?.completed === 'boolean') {
      task.status = dto.completed ? TodoStatus.COMPLETED : TodoStatus.TODO;
    }

    return this.taskRepo.save(task);
  }

  async deleteTask(adminId: string, id: string) {
    const task = await this.taskRepo.findOne({ where: { id, adminId } });
    if (!task) throw new NotFoundException('Task not found');
    await this.taskRepo.remove(task);
    return { ok: true };
  }

  /* =========================
   * Toggles
   * ========================= */
  async toggleComplete(adminId: string, id: string) {
    const task = await this.taskRepo.findOne({ where: { id, adminId } });
    if (!task) throw new NotFoundException('Task not found');

    task.completed = !task.completed;
    task.status = task.completed ? TodoStatus.COMPLETED : TodoStatus.TODO;
    return this.taskRepo.save(task);
  }

  async toggleStar(adminId: string, id: string) {
    const task = await this.taskRepo.findOne({ where: { id, adminId } });
    if (!task) throw new NotFoundException('Task not found');

    task.isStarred = !task.isStarred;
    return this.taskRepo.save(task);
  }

  /* =========================
   * Reorder tasks
   * ========================= */
  async reorderTasks(adminId: string, dto: any) {
    if (!dto?.items || !Array.isArray(dto.items)) throw new BadRequestException('items is required');

    const ids = dto.items.map((i: any) => i.id);
    const existing = await this.taskRepo.find({ where: { id: In(ids), adminId } });
    if (existing.length !== ids.length) throw new BadRequestException('Some tasks not found');

    await this.taskRepo.manager.transaction(async (trx) => {
      for (const item of dto.items) {
        await trx.update(TodoTask, { id: item.id, adminId }, { orderIndex: item.orderIndex });
      }
    });

    return { ok: true };
  }

  /* =========================
   * Subtasks
   * ========================= */
  async addSubtask(adminId: string, taskId: string, dto: any) {
    const task = await this.taskRepo.findOne({ where: { id: taskId, adminId } });
    if (!task) throw new NotFoundException('Task not found');

    const title = String(dto?.title ?? '').trim();
    if (!title) throw new BadRequestException('title is required');

    // FIX: pick next orderIndex to avoid unique constraint collisions
    const last = await this.subtaskRepo
      .createQueryBuilder('st')
      .select('MAX(st.orderIndex)', 'max')
      .where('st.taskId = :taskId', { taskId })
      .getRawOne();

    const nextIndex = (Number(last?.max ?? -1) || 0) + 1;

    const subtask = this.subtaskRepo.create({
      taskId,
      title,
      completed: !!dto?.completed,
      orderIndex: typeof dto?.orderIndex === 'number' ? dto.orderIndex : nextIndex,
    });

    return this.subtaskRepo.save(subtask);
  }

  async updateSubtask(adminId: string, taskId: string, subtaskId: string, dto: any) {
    const task = await this.taskRepo.findOne({ where: { id: taskId, adminId } });
    if (!task) throw new NotFoundException('Task not found');

    const subtask = await this.subtaskRepo.findOne({ where: { id: subtaskId, taskId } });
    if (!subtask) throw new NotFoundException('Subtask not found');

    if (dto?.title !== undefined) {
      const title = String(dto.title ?? '').trim();
      if (!title) throw new BadRequestException('title cannot be empty');
      subtask.title = title;
    }
    if (dto?.completed !== undefined) subtask.completed = !!dto.completed;
    if (dto?.orderIndex !== undefined) subtask.orderIndex = Number(dto.orderIndex);

    return this.subtaskRepo.save(subtask);
  }

  async deleteSubtask(adminId: string, taskId: string, subtaskId: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId, adminId } });
    if (!task) throw new NotFoundException('Task not found');

    const subtask = await this.subtaskRepo.findOne({ where: { id: subtaskId, taskId } });
    if (!subtask) throw new NotFoundException('Subtask not found');

    await this.subtaskRepo.remove(subtask);
    return { ok: true };
  }

  async toggleSubtask(adminId: string, taskId: string, subtaskId: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId, adminId } });
    if (!task) throw new NotFoundException('Task not found');

    const subtask = await this.subtaskRepo.findOne({ where: { id: subtaskId, taskId } });
    if (!subtask) throw new NotFoundException('Subtask not found');

    subtask.completed = !subtask.completed;
    return this.subtaskRepo.save(subtask);
  }

  async reorderSubtasks(adminId: string, dto: any) {
    if (!dto?.taskId) throw new BadRequestException('taskId is required');
    if (!Array.isArray(dto?.items)) throw new BadRequestException('items is required');

    const task = await this.taskRepo.findOne({ where: { id: dto.taskId, adminId } });
    if (!task) throw new NotFoundException('Task not found');

    const ids = dto.items.map((i: any) => i.id);
    const subs = await this.subtaskRepo.find({ where: { id: In(ids), taskId: dto.taskId } });
    if (subs.length !== ids.length) throw new BadRequestException('Some subtasks not found');

    await this.subtaskRepo.manager.transaction(async (trx) => {
      for (const item of dto.items) {
        await trx.update(TodoSubtask, { id: item.id, taskId: dto.taskId }, { orderIndex: item.orderIndex });
      }
    });

    return { ok: true };
  }
}
