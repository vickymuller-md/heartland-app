import type { Metadata } from "next";
import { ReloadButton } from "./reload-button";

export const metadata: Metadata = {
  title: "Offline - HEARTLAND Protocol",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-center">
      <h1 className="text-2xl font-bold tracking-wide text-slate-900">
        HEARTLAND
      </h1>

      <div className="mt-8">
        <svg
          className="mx-auto h-16 w-16 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>

        <h2 className="mt-4 text-xl font-semibold text-gray-900">
          You&apos;re currently offline
        </h2>

        <p className="mt-2 max-w-sm text-base text-gray-600">
          New health entries cannot be saved while offline. Reconnect before
          submitting; if symptoms are urgent, use your emergency or care-team instructions.
        </p>
      </div>

      <ReloadButton />

      <footer className="mt-12 max-w-md border-t border-gray-200 pt-4">
        <p className="text-xs text-gray-400">
          Controlled evaluation only. No real PHI or unsupervised clinical use
          until organizational security, privacy, validation, and governance gates are approved.
        </p>
      </footer>
    </div>
  );
}
