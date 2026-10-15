import { BadRequestException } from '@nestjs/common';
import { normalizeDashboardBackground } from './dashboard-background';

describe('normalizeDashboardBackground', () => {
  it('treats "default" as clearing the system background', () => {
    expect(normalizeDashboardBackground({ kind: 'default' })).toBeNull();
  });

  it('accepts the built-in presets only', () => {
    expect(normalizeDashboardBackground({ kind: 'preset', value: 'main-2' })).toEqual({
      kind: 'preset',
      value: 'main-2',
    });
    expect(() => normalizeDashboardBackground({ kind: 'preset', value: 'main-9' })).toThrow(
      BadRequestException,
    );
  });

  it('stores gradient ids, never raw CSS', () => {
    expect(normalizeDashboardBackground({ kind: 'gradient', value: 'ocean-dawn' })).toEqual({
      kind: 'gradient',
      value: 'ocean-dawn',
    });
    expect(() =>
      normalizeDashboardBackground({ kind: 'gradient', value: 'linear-gradient(red, blue)' }),
    ).toThrow(BadRequestException);
  });

  it('only accepts images uploaded to the branding folder', () => {
    expect(
      normalizeDashboardBackground({ kind: 'image', value: '/uploads/branding/dash-bg-1-2.webp' }),
    ).toEqual({ kind: 'image', value: '/uploads/branding/dash-bg-1-2.webp' });
    for (const value of [
      'https://evil.example/x.png',
      '/uploads/branding/../secret.png',
      '/uploads/branding/a.png") ; background:url("x',
      'data:image/png;base64,AAAA',
    ]) {
      expect(() => normalizeDashboardBackground({ kind: 'image', value })).toThrow(
        BadRequestException,
      );
    }
  });

  it('rejects unknown kinds', () => {
    expect(() => normalizeDashboardBackground({ kind: 'video', value: 'x' })).toThrow(
      BadRequestException,
    );
  });
});
