import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const serviceWorker = fs.readFileSync(
  path.resolve(__dirname, '../../app/sw.ts'),
  'utf-8',
);
const nextConfig = fs.readFileSync(
  path.resolve(__dirname, '../../next.config.ts'),
  'utf-8',
);

describe('PWA Cache Security', () => {
  it('does not import broad defaults or cache documents, RSC, Next data, or APIs', () => {
    expect(serviceWorker).not.toContain('defaultCache');
    expect(serviceWorker).not.toContain('new NetworkFirst');
    expect(serviceWorker).not.toContain('request.headers.get("RSC")');
    expect(serviceWorker).not.toContain('cacheName: "pages-rsc"');
  });

  it('runtime-caches only same-origin immutable assets and icons', () => {
    expect(serviceWorker).toContain('sameOrigin &&');
    expect(serviceWorker).toContain('pathname.startsWith("/_next/static/")');
    expect(serviceWorker).toContain('pathname.startsWith("/icons/")');
    expect(serviceWorker).toContain('cacheName: "static-assets"');
    expect(serviceWorker).toContain('cacheName: "static-js-css"');
  });

  it('deletes legacy caches capable of containing clinical responses', () => {
    for (const marker of [
      'pages-rsc-prefetch', 'pages-rsc', 'pages-html', 'next-data',
      'static-data-assets', 'apis', 'others',
    ]) {
      expect(serviceWorker).toContain(`"${marker}"`);
    }
    expect(serviceWorker).toContain('caches.delete(cacheName)');
  });

  it('disables navigation caching in the Serwist build configuration', () => {
    expect(nextConfig).toContain('cacheOnNavigation: false');
    expect(nextConfig).toContain('reloadOnOnline: false');
  });

  it('sets no-store for APIs and baseline browser security headers', () => {
    expect(nextConfig).toContain('private, no-store, max-age=0, must-revalidate');
    expect(nextConfig).toContain('Content-Security-Policy-Report-Only');
    expect(nextConfig).toContain('X-Content-Type-Options');
    expect(nextConfig).toContain('X-Frame-Options');
    expect(nextConfig).toContain('Strict-Transport-Security');
  });
});
