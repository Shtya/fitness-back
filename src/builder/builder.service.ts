import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuilderProject } from 'entities/builder.entity';

@Injectable()
export class BuilderService {
  constructor(
    @InjectRepository(BuilderProject)
    private readonly repo: Repository<BuilderProject>,
  ) {}

  async ensureProject(tenant: string) {
    let project = await this.repo.findOne({ where: { tenant } });

    if (!project) {
      project = this.repo.create({
        tenant,
        draftDoc: null,
        publishedDoc: null,
        settings: {
          domain: '',
          metaTitle: '',
          metaDescription: '',
        },
      });
      project = await this.repo.save(project);
    }

    return project;
  }

  async getProject(tenant: string) {
    const project = await this.ensureProject(tenant);

    return {
      tenant: project.tenant,
      draftDoc: project.draftDoc,
      publishedDoc: project.publishedDoc,
      settings: project.settings,
      updatedAt: project.updatedAt,
    };
  }

  async saveDraft(tenant: string, draftDoc: any) {
    const project = await this.ensureProject(tenant);
    project.draftDoc = draftDoc;
    await this.repo.save(project);
    return { ok: true };
  }

  async saveSettings(tenant: string, settings: any) {
    const project = await this.ensureProject(tenant);
    project.settings = { ...(project.settings || {}), ...(settings || {}) };
    await this.repo.save(project);
    return { ok: true };
  }

  async publish(tenant: string, draftDoc?: any, settings?: any) {
    const project = await this.ensureProject(tenant);
    project.publishedDoc = draftDoc || project.draftDoc;

    if (settings) {
      project.settings = { ...(project.settings || {}), ...settings };
    }

    await this.repo.save(project);
    return { ok: true };
  }

  // 🌍 Public page (by domain or tenant)
  async getSite(domainOrTenant: string, mode?: string) {
    let project =
      (await this.repo.findOne({ where: { tenant: domainOrTenant } })) ||
      (await this.repo
        .createQueryBuilder('p')
        .where(`p.settings->>'domain' = :domain`, { domain: domainOrTenant })
        .getOne());

    if (!project) {
      throw new NotFoundException('Site not found');
    }

    const doc = mode === 'preview' ? project.draftDoc : project.publishedDoc;

    return {
      found: !!doc,
      doc,
      settings: project.settings,
    };
  }
}
