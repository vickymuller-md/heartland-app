"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { UnitToggle } from "./unit-toggle";
import { SymptomForm } from "./symptom-form";
import { vitalsSchema } from "@/lib/vitals/schema";
import { enqueueVitals, enqueueSymptoms } from "@/lib/offline/queue";
import { flushQueue } from "@/lib/offline/sync";
import { createClient } from "@/lib/supabase/client";
import { useIsOnline } from "@/lib/offline/hooks";
import { evaluateRedFlags } from "@/lib/vitals/red-flags";
import type { RedFlag } from "@/lib/vitals/types";
import { RedFlagAlert } from "./red-flag-alert";

/**
 * Combined vitals + symptoms entry form -- offline-first.
 *
 * Phase 8 rewrites submission to use IndexedDB queue:
 * 1. Client-side Zod validation
 * 2. Write to IndexedDB via enqueueVitals/enqueueSymptoms
 * 3. If online, fire-and-forget flushQueue()
 * 4. Show success regardless of connectivity
 *
 * Elderly-optimized: 48px tap targets, 16px+ fonts, single-column layout.
 * Red flags evaluated server-side after sync (Phase 10 alert pipeline).
 */
export function VitalsEntryForm({ providerPhone }: { providerPhone?: string | null } = {}) {
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [immediateFlags, setImmediateFlags] = useState<RedFlag[]>([]);
  const isOnline = useIsOnline();
  const formRef = useRef<HTMLFormElement>(null);

  // Cache patient_id on mount — try getUser first, fallback to getSession
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setPatientId(user.id);
      } else {
        // Fallback: try session (less secure but works when getUser fails)
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user) setPatientId(session.user.id);
        });
      }
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitting(true);
      setErrors(null);
      setGeneralError(null);

      try {
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
          setSubmitting(false);
          return;
        }

        if (!patientId) {
          setGeneralError(
            "Unable to identify your account. Please sign out and sign back in."
          );
          setSubmitting(false);
          return;
        }

        const data = result.data;
        const recordedAt = new Date().toISOString();

        // Convert kg to lbs if needed
        const weightLbs =
          data.weightUnit === "kg"
            ? Math.round(data.weight * 2.20462 * 10) / 10
            : data.weight;

        // Build vitals payload
        const vitalsPayload = {
          patient_id: patientId,
          recorded_at: recordedAt,
          weight_lbs: weightLbs,
          sbp: data.sbp,
          dbp: data.dbp,
          heart_rate: data.heartRate,
          spo2: data.spo2 ?? null,
          source: "patient_app" as const,
        };

        // SAFE-01: Evaluate red flags client-side before enqueue
        // recentHistory is empty in offline path -- weight trend checks skip silently
        // but SBP, SpO2, dyspnea absolute threshold checks fire immediately
        const immediateRedFlags = evaluateRedFlags(
          { weight_lbs: weightLbs, sbp: data.sbp, spo2: data.spo2 ?? null },
          [],
          { dyspnea: data.dyspnea, edema: data.edema, orthopnea: data.orthopnea, fatigue: data.fatigue }
        );
        setImmediateFlags(immediateRedFlags);

        // Build symptoms payload
        const symptomsPayload = {
          patient_id: patientId,
          recorded_at: recordedAt,
          dyspnea: data.dyspnea,
          edema: data.edema,
          orthopnea: data.orthopnea,
          fatigue: data.fatigue,
          red_flag: immediateRedFlags.length > 0,
        };

        // Write to IndexedDB queue
        await enqueueVitals(vitalsPayload);
        await enqueueSymptoms(symptomsPayload);

        // If online, fire-and-forget sync (don't block UI)
        if (navigator.onLine) {
          flushQueue();
        }

        setSuccess(true);
      } catch {
        setGeneralError("Something went wrong saving your vitals. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [patientId]
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
          {!isOnline && immediateFlags.length === 0 && (
            <p className="text-sm text-gray-600 mt-2">
              Your vitals will be checked for any concerns once synced.
            </p>
          )}
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
