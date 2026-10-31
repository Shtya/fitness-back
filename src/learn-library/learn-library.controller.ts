import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { CreateCourseDto, CreateLectureDto, LearnQuery, LearnSearchQuery, ReorderDto, RoadmapJsonDto, RoadmapTopicsDto, UpdateCourseDto, UpdateLectureDto } from './learn-library.dto';
import { LearnLibraryService } from './learn-library.service';

/** The WhatsApp page's "Learn" tab: a personal library of courses and lectures. */
@Controller('learn')
@UseGuards(JwtAuthGuard)
export class LearnLibraryController {
	constructor(private readonly service: LearnLibraryService) {}

	private userId(req: any): string {
		const id = req.user?.id;
		if (!id) throw new UnauthorizedException();
		return String(id);
	}

	@Get('courses')
	listCourses(@Req() req: any, @Query() _query: LearnQuery) {
		return this.service.listCourses(this.userId(req));
	}

	@Post('courses')
	createCourse(@Req() req: any, @Body() body: CreateCourseDto) {
		return this.service.createCourse(this.userId(req), body);
	}

	@Put('courses/order')
	reorderCourses(@Req() req: any, @Body() body: ReorderDto) {
		return this.service.reorderCourses(this.userId(req), body.ids);
	}

	@Patch('courses/:id')
	updateCourse(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCourseDto) {
		return this.service.updateCourse(this.userId(req), id, body);
	}

	@Delete('courses/:id')
	removeCourse(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
		return this.service.removeCourse(this.userId(req), id);
	}

	@Get('courses/:id/lectures')
	listLectures(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Query() _query: LearnQuery) {
		return this.service.listLectures(this.userId(req), id);
	}

	@Post('courses/:id/lectures')
	createLecture(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateLectureDto) {
		return this.service.createLecture(this.userId(req), id, body);
	}

	@Put('courses/:id/lectures/order')
	reorderLectures(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReorderDto) {
		return this.service.reorderLectures(this.userId(req), id, body.ids);
	}

	@Get('lectures/:id')
	getLecture(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Query() _query: LearnQuery) {
		return this.service.getLecture(this.userId(req), id);
	}

	@Patch('lectures/:id')
	updateLecture(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateLectureDto) {
		return this.service.updateLecture(this.userId(req), id, body);
	}

	@Delete('lectures/:id')
	removeLecture(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
		return this.service.removeLecture(this.userId(req), id);
	}

	@Get('revision')
	revision(@Req() req: any, @Query() _query: LearnQuery) {
		return this.service.revision(this.userId(req));
	}

	@Get('search')
	search(@Req() req: any, @Query() query: LearnSearchQuery) {
		return this.service.search(this.userId(req), query.q);
	}

	@Get('roadmaps')
	listRoadmaps(@Req() req: any, @Query() _query: LearnQuery) {
		return this.service.listRoadmaps(this.userId(req));
	}

	@Post('roadmaps')
	createRoadmap(@Req() req: any, @Body() body: RoadmapJsonDto) {
		return this.service.createRoadmap(this.userId(req), body.json);
	}

	@Get('roadmaps/:id')
	getRoadmap(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Query() _query: LearnQuery) {
		return this.service.getRoadmap(this.userId(req), id);
	}

	@Put('roadmaps/:id')
	updateRoadmap(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: RoadmapJsonDto) {
		return this.service.updateRoadmap(this.userId(req), id, body.json);
	}

	@Post('roadmaps/:id/topics-index')
	importTopicsIndex(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: RoadmapJsonDto) {
		return this.service.importTopicsIndex(this.userId(req), id, body.json);
	}

	@Delete('roadmaps/:id')
	removeRoadmap(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
		return this.service.removeRoadmap(this.userId(req), id);
	}

	@Patch('roadmaps/:id/topics')
	setRoadmapTopics(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: RoadmapTopicsDto) {
		return this.service.setRoadmapTopics(this.userId(req), id, body.keys, body.done);
	}
}
