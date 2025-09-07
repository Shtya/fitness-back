import { JwtAuthGuard } from './../auth/guard/jwt-auth.guard';
import { Controller, Post, UseGuards, UploadedFile, UploadedFiles, UseInterceptors, Req, Body, Delete, Param, Get, Patch, NotFoundException, Query } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { multerOptions } from 'common/multer.config';
import { CreateAssetDto, UpdateAssetDto } from 'dto/assets.dto';
import { AssetService } from './asset.service';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  // ✅ Single asset upload
  @Post()
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async upload(@UploadedFile() file: any, @Body() dto: CreateAssetDto, @Req() req: any) {
    return this.assetService.Create(dto, file, req.user);
  }

  @Post('bulk')
  @UseInterceptors(FilesInterceptor('files', 20, multerOptions))
  async uploadMultiple(@UploadedFiles() files: any[], @Body() dto: CreateAssetDto, @Req() req: any) {
    if (!files?.length) throw new NotFoundException('No files uploaded');

    const assets = await Promise.all(files.map(file => this.assetService.Create(dto, file, req.user)));

    return {
      message: 'Assets uploaded successfully',
      assets,
    };
  }

  @Get()
  async getUserAssets(@Req() req: any, @Query() query) {
    const { page, limit, search, sortBy, category, type, sortOrder } = query;
    // return this.assetService.findAll(
    //   'files',
    //   search,
    //   page,
    //   limit,
    //   sortBy,
    //   sortOrder,
    //   [],
    //   ['user'], // relations
    //   ['name'],
    //   { user: { id: req.user.id }, category, type },
    // );
  }

  @Get(':id')
  async getAsset(@Param('id') id: string) {
    return this.assetService.findOne(id);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async updateAsset(@Param('id') id: string, @UploadedFile() file: any, @Body() dto: UpdateAssetDto) {
    return this.assetService.update(id, dto, file);
  }

  @Delete(':id')
  async deleteAsset(@Param('id') id: string) {
    return this.assetService.delete(id);
  }
}
