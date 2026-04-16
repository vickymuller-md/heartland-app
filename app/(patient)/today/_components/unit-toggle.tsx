"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "weightUnit";

interface UnitToggleProps {
  name?: string;
}

/**
 * Two-button toggle for weight unit (lbs/kg).
 * Reads initial value from localStorage (default: 'lbs').
 * On change: writes to localStorage and updates a hidden form input.
 */
export function UnitToggle({ name = "weightUnit" }: UnitToggleProps) {
  const [unit, setUnit] = useState<"lbs" | "kg">("lbs");
  const [mounted, setMounted] = useState(false);

  // Read from localStorage on mount (client-side only)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "kg" || stored === "lbs") {
      setUnit(stored);
    }
    setMounted(true);
  }, []);

  function handleChange(newUnit: "lbs" | "kg") {
    setUnit(newUnit);
    localStorage.setItem(STORAGE_KEY, newUnit);
  }

  // Avoid hydration mismatch
  if (!mounted) {
    return (
      <div className="flex gap-1">
        <input type="hidden" name={name} value="lbs" />
        <button
          type="button"
          className="min-h-[48px] px-4 py-2 rounded-lg text-base font-semibold bg-blue-600 text-white"
        >
          lbs
        </button>
        <button
          type="button"
          className="min-h-[48px] px-4 py-2 rounded-lg text-base font-semibold bg-gray-100 text-gray-700"
        >
          kg
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <input type="hidden" name={name} value={unit} />
      <button
        type="button"
        onClick={() => handleChange("lbs")}
        className={`min-h-[48px] px-4 py-2 rounded-lg text-base font-semibold transition-colors ${
          unit === "lbs"
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-700"
        }`}
      >
        lbs
      </button>
      <button
        type="button"
        onClick={() => handleChange("kg")}
        className={`min-h-[48px] px-4 py-2 rounded-lg text-base font-semibold transition-colors ${
          unit === "kg"
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-700"
        }`}
      >
        kg
      </button>
    </div>
  );
}
