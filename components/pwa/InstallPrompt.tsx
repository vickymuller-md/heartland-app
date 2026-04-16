"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Share, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "chrome" | "ios" | "generic" | null;

const DISMISS_KEY = "pwa-install-dismissed";

function detectPlatform(): Platform {
  if (typeof window === "undefined") return null;

  // Already installed as standalone -- don't show
  if (window.matchMedia("(display-mode: standalone)").matches) return null;

  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);

  if (isIOS && isSafari) return "ios";

  // Chrome/Edge/Chromium -- beforeinstallprompt will fire
  return "generic";
}

export function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>(null);
  const [dismissed, setDismissed] = useState(true);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Check if previously dismissed
    if (localStorage.getItem(DISMISS_KEY) === "true") return;

    // Check if already in standalone mode
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    setDismissed(false);
    const detected = detectPlatform();

    // For Chrome-family, wait for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setPlatform("chrome");
    };

    window.addEventListener("beforeinstallprompt", handler);

    // If not Chrome/Chromium, show platform-specific instructions immediately
    if (detected === "ios") {
      setPlatform("ios");
    } else if (detected === "generic") {
      // Will be overridden by beforeinstallprompt if available
      setPlatform("generic");
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt.current) return;
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    if (outcome === "accepted") {
      setDismissed(true);
    }
    deferredPrompt.current = null;
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }, []);

  if (dismissed || !platform) return null;

  return (
    <div
      className="mx-4 mb-3 rounded-lg border border-blue-200 bg-blue-50 p-4"
      role="complementary"
      aria-label="Install app"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          {platform === "chrome" && (
            <>
              <p className="text-sm font-medium text-blue-900">
                Install HEARTLAND App
              </p>
              <p className="mt-1 text-xs text-blue-700">
                Add to your home screen for quick access and offline support.
              </p>
              <button
                type="button"
                onClick={handleInstall}
                className="mt-3 inline-flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <Download className="h-4 w-4" />
                Install
              </button>
            </>
          )}

          {platform === "ios" && (
            <>
              <p className="text-sm font-medium text-blue-900">
                Install HEARTLAND App
              </p>
              <p className="mt-1 text-xs text-blue-700">
                Tap the{" "}
                <Share className="inline h-3.5 w-3.5 align-text-bottom" />{" "}
                <span className="font-medium">Share</span> button in Safari,
                then select{" "}
                <span className="font-medium">Add to Home Screen</span>.
              </p>
            </>
          )}

          {platform === "generic" && (
            <>
              <p className="text-sm font-medium text-blue-900">
                Install HEARTLAND App
              </p>
              <p className="mt-1 text-xs text-blue-700">
                Use your browser menu to install this app on your device for
                quick access and offline support.
              </p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-md text-blue-400 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Dismiss install prompt"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
