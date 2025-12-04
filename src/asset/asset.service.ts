// src/asset/asset.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Asset } from 'entities/assets.entity';
import { Repository } from 'typeorm';
import { CreateAssetDto, UpdateAssetDto } from 'dto/assets.dto';
import * as fs from 'fs';
import { BaseService } from 'common/base.service';
import { User } from 'entities/global.entity';

@Injectable()
export class AssetService extends BaseService<Asset> {
  constructor(
    @InjectRepository(Asset) private assetRepo: Repository<Asset>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    super(assetRepo);
  }

  extractTypeFromMime(mime: string): string {
    if (!mime) return 'unknown';

    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';

    if (
      mime === 'application/pdf' ||
      mime === 'application/msword' ||
      mime.startsWith('application/vnd') || // Word, Excel, PPT
      mime === 'text/plain' ||
      mime.startsWith('application/x-') // e.g., x-compressed, x-zip-compressed
    )
      return 'document';

    if (mime === 'application/zip' || mime === 'application/x-7z-compressed' || mime === 'application/x-rar-compressed') return 'archive';

    if (mime.startsWith('application/json') || mime === 'application/xml' || mime.startsWith('text/')) return 'code';

    return 'binary';
  }

  async findUserById(userId: string): Promise<User | null> {
    if (!userId) return null;
    const user = await this.userRepo.findOne({ where: { id: userId } });
    return user || null;
  }

  async Create(dto: CreateAssetDto, file: any, user: User | null, ipAddress: string | null) {
    // ✅ enforce: must have either user or ipAddress
    if (!user && !ipAddress) {
      throw new BadRequestException('Missing userId or IP address. Cannot create asset.');
    }

    const inferredType = this.extractTypeFromMime(file.mimetype);

    const asset = this.assetRepo.create({
      filename: dto.filename ?? file.originalname,
      url: file.path,
      type: dto.type ?? inferredType,
      category: dto.category ?? inferredType,
      mimeType: file.mimetype,
      size: file.size,
      user: user || null,
      ipAddress: ipAddress || null,
    });

    return this.assetRepo.save(asset);
  }

  async update(id: string, dto: UpdateAssetDto, file?: any) {
    const asset = await this.assetRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');

    if (file) {
      try {
        fs.unlinkSync(asset.url);
      } catch (err: any) {
        console.warn('Old file not found in system:', err.message);
      }

      asset.url = file.path;
      asset.mimeType = file.mimetype;
      asset.size = file.size;
      asset.filename = file.originalname;
    }

    asset.category = dto.category ?? asset.category;
    asset.type = dto.type ?? asset.type;

    return this.assetRepo.save(asset);
  }

  async delete(id: string) {
    const asset = await this.assetRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');

    try {
      fs.unlinkSync(asset.url);
    } catch (err: any) {
      console.warn('File not found in system:', err.message);
    }

    return this.assetRepo.remove(asset);
  }

  async findAllByUser(userId: any) {
    return this.assetRepo.find({ where: { user: { id: userId } }, order: { created_at: 'DESC' } });
  }

  async findAllByIp(ipAddress: string) {
    return this.assetRepo.find({ where: { ipAddress }, order: { created_at: 'DESC' } });
  }

  async findOne(id: string) {
    const asset = await this.assetRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }
}
