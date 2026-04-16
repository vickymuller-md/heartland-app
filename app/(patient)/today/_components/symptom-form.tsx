"use client";

import { SYMPTOM_SEVERITY } from "@/lib/vitals/constants";

/**
 * Symptom checklist embedded in the vitals form.
 * 4 symptoms with patient-friendly names:
 * - Shortness of Breath (dyspnea): severity 0-3
 * - Swelling (edema): severity 0-3
 * - Trouble Breathing Lying Down (orthopnea): yes/no
 * - Tiredness (fatigue): severity 0-3
 */

interface SymptomFormProps {
  errors?: Record<string, string[]>;
}

const SYMPTOM_ITEMS = [
  { name: "dyspnea", label: "Shortness of Breath", type: "severity" as const },
  { name: "edema", label: "Swelling", type: "severity" as const },
  {
    name: "orthopnea",
    label: "Trouble Breathing Lying Down",
    type: "boolean" as const,
  },
  { name: "fatigue", label: "Tiredness", type: "severity" as const },
] as const;

export function SymptomForm({ errors }: SymptomFormProps) {
  return (
    <div className="space-y-6">
      {SYMPTOM_ITEMS.map((symptom) => (
        <div key={symptom.name}>
          <label className="text-lg font-semibold text-gray-900 mb-3 block">
            {symptom.label}
          </label>

          {symptom.type === "severity" ? (
            <div className="space-y-2" role="radiogroup" aria-label={symptom.label}>
              {SYMPTOM_SEVERITY.map((level) => (
                <label
                  key={level.value}
                  className="flex items-center gap-3 min-h-[48px] px-4 py-3 border-2 rounded-lg text-lg cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 transition-colors"
                >
                  <input
                    type="radio"
                    name={symptom.name}
                    value={String(level.value)}
                    defaultChecked={level.value === 0}
                    className="h-5 w-5 text-blue-600 accent-blue-600"
                  />
                  <div>
                    <span className="font-medium">{level.label}</span>
                    <span className="text-gray-500 ml-2 text-base">
                      {level.description}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="flex gap-2" role="radiogroup" aria-label={symptom.label}>
              <label className="flex-1 flex items-center justify-center gap-2 min-h-[48px] px-4 py-3 border-2 rounded-lg text-lg cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name={symptom.name}
                  value="false"
                  defaultChecked
                  className="h-5 w-5 text-blue-600 accent-blue-600"
                />
                <span className="font-medium">No</span>
              </label>
              <label className="flex-1 flex items-center justify-center gap-2 min-h-[48px] px-4 py-3 border-2 rounded-lg text-lg cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name={symptom.name}
                  value="true"
                  className="h-5 w-5 text-blue-600 accent-blue-600"
                />
                <span className="font-medium">Yes</span>
              </label>
            </div>
          )}

          {errors?.[symptom.name] && (
            <p className="text-base text-red-600 mt-1">
              {errors[symptom.name][0]}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
