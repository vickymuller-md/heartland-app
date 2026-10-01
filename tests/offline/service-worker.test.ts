import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'node:vm';
import ts from 'typescript';
import { NetworkOnly as RuntimeNetworkOnly, type StrategyHandler } from 'serwist';

const serviceWorker = fs.readFileSync(
  path.resolve(__dirname, '../../app/sw.ts'),
  'utf-8',
);
const nextConfig = fs.readFileSync(
  path.resolve(__dirname, '../../next.config.ts'),
  'utf-8',
);

type MatchContext = {
  request: { method: string; mode: string; destination: string };
  url: URL;
  sameOrigin: boolean;
};
type WorkerOptions = {
  runtimeCaching: {
    matcher: (context: MatchContext) => boolean;
    handler: object;
  }[];
  fallbacks: { entries: { url: string; matcher: (context: MatchContext) => boolean }[] };
};

// Execute the actual worker's configuration rather than matching source strings.
// Strategy construction is isolated here; production-browser smoke verifies
// Serwist's network/fallback behavior with the real generated worker.
class NetworkOnly {}
class CacheFirst {}
class StaleWhileRevalidate {}
class ExpirationPlugin {}

function readWorkerOptions(): WorkerOptions {
  let options: WorkerOptions | undefined;
  const serwistModule = {
    NetworkOnly, CacheFirst, StaleWhileRevalidate, ExpirationPlugin,
    Serwist: class {
      constructor(value: WorkerOptions) { options = value; }
      addEventListeners() {}
    },
  };
  const code = ts.transpileModule(serviceWorker, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports: {},
    require: (name: string) => {
      if (name !== 'serwist') throw new Error(`Unexpected worker dependency: ${name}`);
      return serwistModule;
    },
    self: { __SW_MANIFEST: [], addEventListener() {} },
  });
  if (!options) throw new Error('Worker did not configure Serwist');
  return options;
}

const workerOptions = readWorkerOptions();
function context(pathname: string, overrides: Partial<MatchContext['request']> = {}, sameOrigin = true): MatchContext {
  return {
    request: { method: 'GET', mode: 'navigate', destination: 'document', ...overrides },
    url: new URL(pathname, sameOrigin ? 'https://app.example.test' : 'https://other.example.test'),
    sameOrigin,
  };
}

describe('PWA navigation routing', () => {
  it.each([200, 404, 500])('preserves HTTP %i responses in the installed NetworkOnly strategy', async (status) => {
    const response = new Response('Server response, not offline fallback', { status });
    const handler = { fetch: async () => response } as unknown as StrategyHandler;
    const result = await new RuntimeNetworkOnly()._handle(new Request('https://app.example.test/login'), handler);
    expect(result).toBe(response);
    expect(result.status).toBe(status);
  });

  it('surfaces network failures from the installed strategy for fallback handling', async () => {
    const handler = { fetch: async () => { throw new TypeError('Synthetic network failure'); } } as unknown as StrategyHandler;
    await expect(new RuntimeNetworkOnly()._handle(new Request('https://app.example.test/login'), handler)).rejects.toThrow();
  });

  it.each(['/login', '/patients/synthetic-test', '/dashboard', '/not-a-real-page', '/apiary']) (
    'routes %s documents through NetworkOnly, never a caching strategy', (pathname) => {
      const matches = workerOptions.runtimeCaching.filter(({ matcher }) => matcher(context(pathname)));
      expect(matches).toHaveLength(1);
      expect(matches[0].handler).toBeInstanceOf(NetworkOnly);
      const fallback = workerOptions.fallbacks.entries.find(({ matcher }) => matcher(context(pathname)));
      expect(fallback?.url).toBe('/~offline');
    },
  );

  it.each(['/api', '/api/', '/api/health', '/api/patients?x=1', '/_next', '/_next/', '/_next/data/build/page.json', '/_next/image?url=%2Ffigures%2Fcard.jpg']) (
    'never routes direct navigation to endpoint %s through an HTML fallback', (pathname) => {
      expect(workerOptions.runtimeCaching.filter(({ matcher }) => matcher(context(pathname)))).toEqual([]);
    },
  );

  it.each([
    { method: 'POST' },
    { method: 'HEAD' },
    { mode: 'cors', destination: '' },
    { mode: 'same-origin', destination: '' },
    { mode: 'navigate', destination: 'iframe' },
    { mode: 'cors', destination: 'document' },
  ])('does not intercept non-page requests %j', (request) => {
    expect(workerOptions.runtimeCaching.filter(({ matcher }) => matcher(context('/patients/synthetic-test', request)))).toEqual([]);
  });

  it('does not intercept cross-origin documents', () => {
    expect(workerOptions.runtimeCaching.filter(({ matcher }) => matcher(context('/login', {}, false)))).toEqual([]);
  });

  it('keeps immutable asset requests on their existing caching strategy', () => {
    const input = context('/_next/static/chunks/example.js', { mode: 'no-cors', destination: 'script' });
    const matches = workerOptions.runtimeCaching.filter(({ matcher }) => matcher(input));
    expect(matches).toHaveLength(1);
    expect(matches[0].handler).toBeInstanceOf(StaleWhileRevalidate);
  });
});

describe('PWA Cache Security', () => {
  it('precaches only invariant public documents, never the role-dependent home URL', () => {
    const source = ts.createSourceFile('next.config.ts', nextConfig, ts.ScriptTarget.Latest, true);
    const urls: string[] = [];
    let manifestFound = false;
    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'additionalPrecacheEntries') {
        manifestFound = true;
        expect(ts.isArrayLiteralExpression(node.initializer)).toBe(true);
        if (!ts.isArrayLiteralExpression(node.initializer)) return;
        for (const item of node.initializer.elements) {
          if (ts.isSpreadElement(item)) {
            expect(item.expression.getText(source)).toBe('pocketCardEntries');
            continue;
          }
          expect(ts.isObjectLiteralExpression(item)).toBe(true);
          if (!ts.isObjectLiteralExpression(item)) continue;
          const url = item.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(source) === 'url');
          expect(url && ts.isPropertyAssignment(url) && ts.isStringLiteral(url.initializer)).toBe(true);
          if (url && ts.isPropertyAssignment(url) && ts.isStringLiteral(url.initializer)) urls.push(url.initializer.text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(manifestFound).toBe(true);
    expect(urls.sort()).toEqual(['/downtime', '/~offline']);
  });

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
      'static-data-assets', 'static-audio-assets', 'apis', 'others',
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
    expect(nextConfig).toContain('{ key: "Content-Security-Policy"');
    expect(nextConfig).not.toContain('Content-Security-Policy-Report-Only');
    expect(nextConfig).toContain('X-Content-Type-Options');
    expect(nextConfig).toContain('X-Frame-Options');
    expect(nextConfig).toContain('Strict-Transport-Security');
  });
});
