"use client";

import { useState, useRef } from "react";
import { UnitToggle } from "./unit-toggle";
import { SymptomForm } from "./symptom-form";
import { vitalsSchema } from "@/lib/vitals/schema";
import { useVitalsSubmission } from "@/lib/vitals/use-submission";
import { PendingVitalsSubmissions } from '@/lib/vitals/pending-submissions';
import { VitalsSubmissionStatus } from "@/lib/vitals/submission-status";
import { useIsOnline } from "@/lib/offline/hooks";
import { RedFlagAlert } from "./red-flag-alert";

export function VitalsEntryForm({ providerPhone }: { providerPhone?: string | null } = {}) {
  const { state, ready, busy: submitting, submit, recover, startNew } = useVitalsSubmission();
  const [localErrors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [localError, setGeneralError] = useState<string | null>(null);
  const errors = localErrors ?? state.errors;
  const generalError = localError ?? state.error;
  const isOnline = useIsOnline();
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors(null);
    setGeneralError(null);
    if (!isOnline) {
      setGeneralError("You are offline. Reconnect before submitting; this clinical data has not been saved.");
      return;
    }
    const formData = new FormData(e.currentTarget);
    const parsed = vitalsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    await submit(formData);
  }

  if (state.saved) {
    return <><PendingVitalsSubmissions refreshKey={state.requestId} /><VitalsSubmissionStatus state={state} busy={submitting} onRetry={() => void recover()} onNew={() => {
      setErrors(null);
      setGeneralError(null);
      void startNew();
    }}>
      {!!state.redFlags?.length && <RedFlagAlert flags={state.redFlags} providerPhone={providerPhone} />}
    </VitalsSubmissionStatus></>;
  }

  return (<>
    <PendingVitalsSubmissions refreshKey={state.requestId} />
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-8">
      {/* General error */}
      {generalError && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
          <p role="alert" className="text-base text-red-700">{generalError}</p>
          <button type="button" disabled={submitting || !isOnline} onClick={() => { setGeneralError(null); void recover(); }} className="mt-2 min-h-[48px] underline">Check Saved Record</button>
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
        disabled={submitting || !ready}
        className="w-full min-h-[48px] text-lg font-semibold bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed py-3"
      >
        {submitting ? "Saving..." : "Submit Daily Check-in"}
      </button>
    </form>
  </>);
}
