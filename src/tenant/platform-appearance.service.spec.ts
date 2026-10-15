import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformAppearanceService } from './platform-appearance.service';

/** Minimal stand-in for the four statements the service issues against platform_settings. */
function fakeDataSource() {
  const rows = new Map<string, unknown>();
  return {
    rows,
    query: jest.fn(async (sql: string, params: any[] = []) => {
      if (sql.startsWith('CREATE TABLE')) return [];
      if (sql.startsWith('SELECT')) return rows.has(params[0]) ? [{ value: rows.get(params[0]) }] : [];
      if (sql.startsWith('DELETE')) {
        rows.delete(params[0]);
        return [];
      }
      if (sql.trim().startsWith('INSERT')) {
        rows.set(params[0], JSON.parse(params[1]));
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

describe('PlatformAppearanceService gallery', () => {
  const actor = '11111111-1111-4111-8111-111111111111';

  it('keeps an uploaded image in the shared list and applies it', async () => {
    const service = new PlatformAppearanceService(fakeDataSource() as any);

    const result = await service.addGalleryImage(actor, '/uploads/branding/dash-bg-1.webp');

    expect(result.background).toEqual({ kind: 'image', value: '/uploads/branding/dash-bg-1.webp' });
    expect(result.gallery).toHaveLength(1);

    await service.setDashboardBackground(actor, { kind: 'preset', value: 'main-1' });
    const reread = await service.getDashboardAppearance();
    expect(reread.background).toEqual({ kind: 'preset', value: 'main-1' });
    expect(reread.gallery.map((item) => item.url)).toEqual(['/uploads/branding/dash-bg-1.webp']);
  });

  it('lets anyone pick a gallery image later but refuses unknown uploads', async () => {
    const service = new PlatformAppearanceService(fakeDataSource() as any);
    await service.addGalleryImage(actor, '/uploads/branding/dash-bg-1.webp');
    await service.setDashboardBackground(actor, { kind: 'default' });

    await expect(
      service.setDashboardBackground(actor, { kind: 'image', value: '/uploads/branding/dash-bg-1.webp' }),
    ).resolves.toMatchObject({ background: { kind: 'image' } });
    await expect(
      service.setDashboardBackground(actor, { kind: 'image', value: '/uploads/branding/other.webp' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deleting the active image removes it and falls back to the default', async () => {
    const service = new PlatformAppearanceService(fakeDataSource() as any);
    await service.addGalleryImage(actor, '/uploads/branding/dash-bg-1.webp');
    const { gallery } = await service.addGalleryImage(actor, '/uploads/branding/dash-bg-2.webp');

    const result = await service.removeGalleryImage(actor, gallery[1].id);

    expect(result.background).toBeNull();
    expect(result.gallery.map((item) => item.url)).toEqual(['/uploads/branding/dash-bg-1.webp']);
    await expect(service.removeGalleryImage(actor, gallery[1].id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('stores the system overlay separately from the background', async () => {
    const service = new PlatformAppearanceService(fakeDataSource() as any);

    await service.setDashboardOverlay(actor, { tone: 'dark', opacity: 35 });
    await service.setDashboardBackground(actor, { kind: 'preset', value: 'main-2' });

    await expect(service.getDashboardAppearance()).resolves.toMatchObject({
      background: { kind: 'preset', value: 'main-2' },
      overlay: { tone: 'dark', opacity: 35 },
    });
    await expect(service.setDashboardOverlay(actor, { tone: 'dark', opacity: 0 })).resolves.toMatchObject({
      overlay: null,
    });
  });

  it('gives a pre-gallery system image a stable id so it can be deleted', async () => {
    const data = fakeDataSource();
    data.rows.set('appearance.dashboard_background', {
      kind: 'image',
      value: '/uploads/branding/legacy.png',
    });
    const service = new PlatformAppearanceService(data as any);

    const first = await service.getDashboardAppearance();
    const second = await service.getDashboardAppearance();

    expect(first.gallery).toHaveLength(1);
    expect(second.gallery[0].id).toBe(first.gallery[0].id);
    await expect(service.removeGalleryImage(actor, first.gallery[0].id)).resolves.toMatchObject({
      background: null,
      gallery: [],
    });
  });
});
