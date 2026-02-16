// src/todo/todo.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TodoService } from './todo.service';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  private getAdminId(req: any): string {
    const adminId = req.user?.adminId ?? req.user?.id;
    if (!adminId) throw new Error('Missing adminId on request user');
    return adminId;
  }

  /* =========================
   * Folders
   * ========================= */
  @Get('todo/folders') // legacy (your frontend uses this)
  listFoldersLegacy(@Req() req: any) {
    return this.todoService.listFolders(this.getAdminId(req));
  }

  @Get('todo-folders') // also support this
  listFolders(@Req() req: any) {
    return this.todoService.listFolders(this.getAdminId(req));
  }

  @Post('todo-folders')
  createFolder(@Req() req: any, @Body() body: any) {
    return this.todoService.createFolder(this.getAdminId(req), body);
  }

  @Patch('todo-folders/:id')
  updateFolder(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.todoService.updateFolder(this.getAdminId(req), id, body);
  }

  @Delete('todo-folders/:id')
  deleteFolder(@Req() req: any, @Param('id') id: string) {
    return this.todoService.deleteFolder(this.getAdminId(req), id);
  }

  /* =========================
   * Tasks list / CRUD
   * ========================= */
  @Get('todos')
  listTasks(@Req() req: any, @Query() query: any) {
    return this.todoService.listTasks(this.getAdminId(req), query);
  }

  @Post('todos')
  createTask(@Req() req: any, @Body() body: any) {
    return this.todoService.createTask(this.getAdminId(req), body);
  }

  @Get('todos/:id')
  getTask(@Req() req: any, @Param('id') id: string) {
    return this.todoService.getTask(this.getAdminId(req), id);
  }

  @Patch('todos/:id')
  updateTask(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.todoService.updateTask(this.getAdminId(req), id, body);
  }

  @Delete('todos/:id')
  deleteTask(@Req() req: any, @Param('id') id: string) {
    return this.todoService.deleteTask(this.getAdminId(req), id);
  }

  /* =========================
   * Subtasks (REAL endpoints)
   * ========================= */
  @Post('tasks/:taskId/subtasks')
  addSubtask(@Req() req: any, @Param('taskId') taskId: string, @Body() body: any) {
    return this.todoService.addSubtask(this.getAdminId(req), taskId, body);
  }

  @Patch('tasks/:taskId/subtasks/:subtaskId')
  updateSubtask(
    @Req() req: any,
    @Param('taskId') taskId: string,
    @Param('subtaskId') subtaskId: string,
    @Body() body: any,
  ) {
    return this.todoService.updateSubtask(this.getAdminId(req), taskId, subtaskId, body);
  }

  @Delete('tasks/:taskId/subtasks/:subtaskId')
  deleteSubtask(
    @Req() req: any,
    @Param('taskId') taskId: string,
    @Param('subtaskId') subtaskId: string,
  ) {
    return this.todoService.deleteSubtask(this.getAdminId(req), taskId, subtaskId);
  }

  @Post('tasks/:taskId/subtasks/:subtaskId/toggle')
  toggleSubtask(
    @Req() req: any,
    @Param('taskId') taskId: string,
    @Param('subtaskId') subtaskId: string,
  ) {
    return this.todoService.toggleSubtask(this.getAdminId(req), taskId, subtaskId);
  }

  @Post('tasks/subtasks/reorder')
  reorderSubtasks(@Req() req: any, @Body() body: any) {
    return this.todoService.reorderSubtasks(this.getAdminId(req), body);
  }

  /* =========================
   * Optional (kept)
   * ========================= */
  @Post('tasks/reorder')
  reorderTasks(@Req() req: any, @Body() body: any) {
    return this.todoService.reorderTasks(this.getAdminId(req), body);
  }

  @Post('tasks/:id/toggle-complete')
  toggleComplete(@Req() req: any, @Param('id') id: string) {
    return this.todoService.toggleComplete(this.getAdminId(req), id);
  }

  @Post('tasks/:id/toggle-star')
  toggleStar(@Req() req: any, @Param('id') id: string) {
    return this.todoService.toggleStar(this.getAdminId(req), id);
  }
}
