import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,
	Query,
	Request,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RecipesService } from './recipes.service';
import { recipeImageUploadOptions } from './recipe-upload.config';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';


@Controller('recipes')
export class RecipesController {
	constructor(private readonly svc: RecipesService) { }

	@Post()
	@UseInterceptors(FileInterceptor('image', recipeImageUploadOptions))
	create(
		@Body() body: any,
		@UploadedFile() file?: any,
	) {
		return this.svc.createFromFormData(body, file);
	}

	@Post('bulk')
	bulkCreate(@Body() dto: any) {
		return this.svc.bulkCreate(dto);
	}

	@Get()
	findAll(@Query() query: any) {
		return this.svc.findAll(query);
	}

	@Get('stats')
	getStats(@Query() query: any) {
		return this.svc.getStats(query);
	}

	@Get('filters/meta')
	getFilterMeta() {
		return this.svc.getFilterMeta();
	}


	// ─── Favorites ──────────────────────────────────────────────────────────────
	@UseGuards(JwtAuthGuard)
	@Get('user/favorites')
	getFavorites(
		@Request() req: any,
		@Query() query: any,
	) {
		const userId = req.user?.id ?? req.headers['x-user-id'];
		return this.svc.getUserFavorites(userId, query);
	}

	

	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.svc.findOne(id);
	}

	@Put(':id')
	@UseInterceptors(FileInterceptor('image', recipeImageUploadOptions))
	update(
		@Param('id') id: string,
		@Body() body: any,
		@UploadedFile() file?: any,
	) {
		return this.svc.updateFromFormData(id, body, file);
	}

	@Patch(':id')
	@UseInterceptors(FileInterceptor('image', recipeImageUploadOptions))
	patch(
		@Param('id') id: string,
		@Body() body: any,
		@UploadedFile() file?: any,
	) {
		return this.svc.updateFromFormData(id, body, file);
	}

	@Delete(':id')
	remove(@Param('id') id: string) {
		return this.svc.remove(id);
	}

	@Post(':id/upload-image')
	@UseInterceptors(FileInterceptor('file', recipeImageUploadOptions))
	uploadImage(@Param('id') id: string, @UploadedFile() file: any) {
		return this.svc.updateImage(id, `/uploads/recipes/${file.filename}`);
	}

	@Patch(':id/image')
	updateImageByUrl(
		@Param('id') id: string,
		@Body('image_url') imageUrl: string | null,
	) {
		return this.svc.updateImage(id, imageUrl);
	}

	@Delete(':id/image')
	deleteImage(@Param('id') id: string) {
		return this.svc.removeImage(id);
	}



	


	@UseGuards(JwtAuthGuard)
	@Post(':id/favorite')
	addFavorite(
		@Param('id') id: string,
		@Request() req: any,
	) {

		console.log(id, req.user);
		const userId = req.user?.id 
		return this.svc.addFavorite(userId, id);
	}
	@UseGuards(JwtAuthGuard)
	@Delete(':id/favorite')
	removeFavorite(
		@Param('id') id: string,
		@Request() req: any,
	) {
		const userId = req.user?.id ?? req.headers['x-user-id'];
		return this.svc.removeFavorite(userId, id);
	}
	
}