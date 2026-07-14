import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  Serwist,
  CacheFirst,
  StaleWhileRevalidate,
  ExpirationPlugin,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const LEGACY_SENSITIVE_CACHE_MARKERS = [
  "pages-rsc-prefetch",
  "pages-rsc",
  "pages-html",
  "next-data",
  "static-data-assets",
  "apis",
  "others",
];

// Remove caches created by previous releases that could contain authenticated
// documents, RSC payloads, API responses, or other clinical application data.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) =>
            LEGACY_SENSITIVE_CACHE_MARKERS.some((marker) => cacheName.includes(marker)),
          )
          .map((cacheName) => caches.delete(cacheName)),
      ),
    ),
  );
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Only immutable, same-origin build assets and public app icons are cached.
    {
      matcher: ({ request, url: { pathname }, sameOrigin }) =>
        sameOrigin &&
        request.method === "GET" &&
        (request.destination === "image" || request.destination === "font") &&
        (pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/")),
      handler: new CacheFirst({
        cacheName: "static-assets",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    // Next.js static CSS/JS bundles contain code, never patient responses.
    {
      matcher: ({ request, url: { pathname }, sameOrigin }) =>
        sameOrigin &&
        request.method === "GET" &&
        pathname.startsWith("/_next/static/") &&
        (request.destination === "script" || request.destination === "style"),
      handler: new StaleWhileRevalidate({
        cacheName: "static-js-css",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          }),
        ],
      }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
