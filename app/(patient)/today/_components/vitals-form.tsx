"use client";

import { useState, useCallback, useRef } from "react";
import { UnitToggle } from "./unit-toggle";
import { SymptomForm } from "./symptom-form";
import { vitalsSchema } from "@/lib/vitals/schema";
import { submitVitals } from "@/lib/vitals/actions";
import { useIsOnline } from "@/lib/offline/hooks";
import type { RedFlag } from "@/lib/vitals/types";
import { RedFlagAlert } from "./red-flag-alert";

/**
 * Combined vitals + symptoms entry form.
 *
 * Clinical values stay in the form until the authenticated server action
 * confirms persistence. The app intentionally refuses offline submission.
 * 1. Client-side Zod validation
 * 2. Submit through the authenticated Server Action
 * 3. Show success only after the database confirms the write
 *
 * Elderly-optimized: 48px tap targets, 16px+ fonts, single-column layout.
 * Red flags are evaluated server-side with recent patient history.
 */
export function VitalsEntryForm({ providerPhone }: { providerPhone?: string | null } = {}) {
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [immediateFlags, setImmediateFlags] = useState<RedFlag[]>([]);
  const isOnline = useIsOnline();
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitting(true);
      setErrors(null);
      setGeneralError(null);

      try {
        if (!isOnline) {
          setGeneralError(
            "You are offline. Reconnect before submitting; this clinical data has not been saved."
          );
          return;
        }

        const formData = new FormData(e.currentTarget);
        const raw = Object.fromEntries(formData.entries());

        // Client-side Zod validation (same schema, run on client)
        const result = vitalsSchema.safeParse(raw);

        if (!result.success) {
          const fieldErrors: Record<string, string[]> = {};
          for (const issue of result.error.issues) {
            const key = issue.path[0] as string;
            if (!fieldErrors[key]) fieldErrors[key] = [];
            fieldErrors[key].push(issue.message);
          }
          setErrors(fieldErrors);
          return;
        }

        const response = await submitVitals(null, formData);
        if (response.errors) {
          setErrors(response.errors);
          return;
        }
        if (!response.success) {
          setGeneralError(
            response.error === "Not authenticated"
              ? "Your session expired. Sign in again before submitting."
              : "Something went wrong saving your check-in. Please try again."
          );
          return;
        }

        setImmediateFlags(response.redFlags ?? []);
        setSuccess(true);
      } catch {
        setGeneralError("Something went wrong saving your vitals. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [isOnline]
  );

  // Success state
  if (success) {
    return (
      <div className="space-y-4">
        {/* SAFE-01: Show red flag alerts immediately if any flags triggered */}
        {immediateFlags.length > 0 && (
          <RedFlagAlert flags={immediateFlags} providerPhone={providerPhone} />
        )}

        <div className="rounded-lg border-2 border-green-300 bg-green-50 p-6 text-center">
          <h2 className="text-xl font-bold text-green-800 mb-2">
            Check-in Complete
          </h2>
          <p className="text-base text-green-700">
            Your vitals and symptoms have been recorded. Keep up the good work!
          </p>
          <button
            type="button"
            onClick={() => {
              setSuccess(false);
              setImmediateFlags([]);
              setErrors(null);
              setGeneralError(null);
              formRef.current?.reset();
            }}
            className="mt-4 min-h-[48px] px-6 py-3 text-lg font-semibold bg-green-600 text-white rounded-lg"
          >
            Log Another Entry
          </button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-8">
      {/* General error */}
      {generalError && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
          <p className="text-base text-red-700">{generalError}</p>
        </div>
      )}

      {/* Section 1: Vitals */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Vitals</h2>

        <div className="space-y-4">
          {/* Weight */}
          <div>
            <label
              htmlFor="weight"
              className="text-lg font-semibold text-gray-900 mb-2 block"
            >
              Weight
            </label>
            <div className="flex gap-3 items-start">
              <input
                type="number"
                id="weight"
                name="weight"
                step="0.1"
                placeholder="e.g., 165"
                className="flex-1 min-h-[48px] text-lg px-4 py-3 border-2 rounded-lg"
              />
              <UnitToggle />
            </div>
            {errors?.weight && (
              <p className="text-base text-red-600 mt-1">
                {errors.weight[0]}
              </p>
            )}
          </div>

          {/* Systolic BP */}
          <div>
            <label
              htmlFor="sbp"
              className="text-lg font-semibold text-gray-900 mb-2 block"
            >
              Systolic Blood Pressure (top number)
            </label>
            <input
              type="number"
              id="sbp"
              name="sbp"
              placeholder="e.g., 120"
              className="w-full min-h-[48px] text-lg px-4 py-3 border-2 rounded-lg"
            />
            {errors?.sbp && (
              <p className="text-base text-red-600 mt-1">
                {errors.sbp[0]}
              </p>
            )}
          </div>

          {/* Diastolic BP */}
          <div>
            <label
              htmlFor="dbp"
              className="text-lg font-semibold text-gray-900 mb-2 block"
            >
              Diastolic Blood Pressure (bottom number)
            </label>
            <input
              type="number"
              id="dbp"
              name="dbp"
              placeholder="e.g., 80"
              className="w-full min-h-[48px] text-lg px-4 py-3 border-2 rounded-lg"
            />
            {errors?.dbp && (
              <p className="text-base text-red-600 mt-1">
                {errors.dbp[0]}
              </p>
            )}
          </div>

          {/* Heart Rate */}
          <div>
            <label
              htmlFor="heartRate"
              className="text-lg font-semibold text-gray-900 mb-2 block"
            >
              Heart Rate
            </label>
            <input
              type="number"
              id="heartRate"
              name="heartRate"
              placeholder="e.g., 72"
              className="w-full min-h-[48px] text-lg px-4 py-3 border-2 rounded-lg"
            />
            {errors?.heartRate && (
              <p className="text-base text-red-600 mt-1">
                {errors.heartRate[0]}
              </p>
            )}
          </div>

          {/* SpO2 (optional) */}
          <div>
            <label
              htmlFor="spo2"
              className="text-lg font-semibold text-gray-900 mb-2 block"
            >
              SpO2{" "}
              <span className="text-base font-normal text-gray-500">
                (optional -- if you have a pulse oximeter)
              </span>
            </label>
            <input
              type="number"
              id="spo2"
              name="spo2"
              placeholder="e.g., 97"
              className="w-full min-h-[48px] text-lg px-4 py-3 border-2 rounded-lg"
            />
            {errors?.spo2 && (
              <p className="text-base text-red-600 mt-1">
                {errors.spo2[0]}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Section 2: Symptoms */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          How Are You Feeling?
        </h2>
        <SymptomForm errors={errors ?? undefined} />
      </section>

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full min-h-[48px] text-lg font-semibold bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed py-3"
      >
        {submitting ? "Saving..." : "Submit Daily Check-in"}
      </button>
    </form>
  );
}
