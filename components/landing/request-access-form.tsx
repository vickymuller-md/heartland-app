"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { submitAccessRequest, type RequestAccessInput } from "@/app/actions/request-access";

const US_STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"],
  ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"], ["DC", "District of Columbia"],
  ["PR", "Puerto Rico"],
].map(([code, name]) => ({ code, name }));

const ROLE_OPTIONS = [
  "MD / DO (Physician)",
  "NP (Nurse Practitioner)",
  "PA (Physician Assistant)",
  "PharmD (Pharmacist)",
  "RN (Registered Nurse)",
  "QI / Implementation",
  "Researcher / Academic",
  "Other",
];

type FieldErrors = Partial<Record<keyof RequestAccessInput, string>>;

export function RequestAccessForm() {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const input: RequestAccessInput = {
      full_name: (formData.get("full_name") as string) ?? "",
      email: (formData.get("email") as string) ?? "",
      npi: (formData.get("npi") as string) ?? "",
      state: (formData.get("state") as string) ?? "",
      facility: (formData.get("facility") as string) ?? "",
      role_claim: (formData.get("role_claim") as string) ?? "",
      message: (formData.get("message") as string) ?? "",
      website: (formData.get("website") as string) ?? "",
    };

    startTransition(async () => {
      const result = await submitAccessRequest(input);
      if (result.ok) {
        setSubmitted(true);
      } else {
        setErrors(result.errors ?? {});
        if (result.formError) setFormError(result.formError);
      }
    });
  }

  if (submitted) {
    return <SubmittedPanel />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <div className="absolute -left-[10000px] top-auto size-px overflow-hidden" aria-hidden="true">
        <label htmlFor="request-website">Website</label>
        <input id="request-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Field
          label="Full name"
          name="full_name"
          required
          autoComplete="name"
          error={errors.full_name}
        />
        <Field
          label="Professional email"
          name="email"
          type="email"
          required
          autoComplete="email"
          error={errors.email}
          hint="Institutional email preferred."
        />
        <Field
          label="NPI (optional)"
          name="npi"
          inputMode="numeric"
          pattern="\d{10}"
          error={errors.npi}
          hint="Ten digits. U.S. National Provider Identifier."
        />
        <SelectField
          label="U.S. state"
          name="state"
          error={errors.state}
          options={[{ value: "", label: "— select —" }].concat(
            US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` })),
          )}
        />
        <Field
          label="Facility / institution"
          name="facility"
          error={errors.facility}
          hint="Critical Access Hospital, FQHC, clinic, or university."
        />
        <SelectField
          label="Professional role"
          name="role_claim"
          error={errors.role_claim}
          options={[{ value: "", label: "— select —" }].concat(
            ROLE_OPTIONS.map((r) => ({ value: r, label: r })),
          )}
        />
      </div>

      <TextAreaField
        label="Context of intended use"
        name="message"
        error={errors.message}
        hint="Brief description of your rural HF patient population, implementation goals, or research interest. Max 1,200 characters."
      />

      {formError && (
        <p className="border border-alert/60 bg-alert/10 px-4 py-3 font-editorial text-[13px] text-alert">
          {formError}
        </p>
      )}

      <div className="flex flex-col items-start gap-6 border-t border-grid pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md font-editorial text-[12.5px] font-medium text-cool/80">
          Submissions are reviewed manually. No patient information is collected here.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="group inline-flex items-center gap-3 rounded-full bg-cool px-7 py-4 font-editorial text-[14.5px] font-medium text-terminal transition-colors hover:bg-alert hover:text-cool disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? "Submitting…" : "Submit request"}
          {!pending && (
            <span className="transition-transform group-hover:translate-x-1">→</span>
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  autoComplete,
  inputMode,
  pattern,
  hint,
  error,
}: {
  label: string;
  name: keyof RequestAccessInput;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  pattern?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between font-editorial text-[12.5px] font-medium text-cool/80">
        <span>
          {label}
          {required && <span className="ml-1 text-alert">*</span>}
        </span>
      </span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        pattern={pattern}
        aria-invalid={Boolean(error)}
        className="w-full rounded-lg border border-grid bg-terminal px-3.5 py-3 font-editorial text-[15px] text-cool outline-none transition-colors placeholder:text-stone/60 focus:border-cool focus:ring-2 focus:ring-cool/10"
      />
      {error ? (
        <span className="block font-editorial text-[12px] text-alert">{error}</span>
      ) : hint ? (
        <span className="block font-editorial text-[12px] text-stone">{hint}</span>
      ) : null}
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  error,
}: {
  label: string;
  name: keyof RequestAccessInput;
  options: { value: string; label: string }[];
  error?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between font-editorial text-[12.5px] font-medium text-cool/80">
        <span>{label}</span>
      </span>
      <select
        name={name}
        aria-invalid={Boolean(error)}
        className="w-full rounded-lg border border-grid bg-terminal px-3.5 py-3 font-editorial text-[15px] text-cool outline-none transition-colors focus:border-cool focus:ring-2 focus:ring-cool/10"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <span className="block font-editorial text-[12px] text-alert">{error}</span>
      )}
    </label>
  );
}

function TextAreaField({
  label,
  name,
  hint,
  error,
}: {
  label: string;
  name: keyof RequestAccessInput;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between font-editorial text-[12.5px] font-medium text-cool/80">
        <span>{label}</span>
      </span>
      <textarea
        name={name}
        rows={5}
        maxLength={1200}
        aria-invalid={Boolean(error)}
        className="w-full resize-none rounded-lg border border-grid bg-terminal p-3.5 font-editorial text-[14.5px] leading-relaxed text-cool outline-none transition-colors placeholder:text-stone/60 focus:border-cool focus:ring-2 focus:ring-cool/10"
      />
      {error ? (
        <span className="block font-editorial text-[12px] text-alert">{error}</span>
      ) : hint ? (
        <span className="block font-editorial text-[12px] text-stone">{hint}</span>
      ) : null}
    </label>
  );
}

function SubmittedPanel() {
  return (
    <div className="rounded-2xl border border-grid bg-terminal p-10">
      <p className="inline-flex items-center gap-2 rounded-full border border-signal/40 bg-signal/10 px-3.5 py-1.5 font-editorial text-[12.5px] font-medium text-signal">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signal" />
        Request received
      </p>
      <h2 className="mt-5 text-[clamp(1.85rem,3.2vw,2.5rem)] font-editorial font-semibold leading-[1.1] tracking-[-0.015em] text-cool">
        Thanks — we&rsquo;ll be in touch{" "}
        <span className="font-display italic font-normal text-alert">soon</span>.
      </h2>
      <p className="mt-5 max-w-xl font-editorial text-[15px] leading-relaxed text-cool/80">
        Your request has been queued for manual review. Most approved
        requests receive an invitation code within seven business days.
        Implementation pilots or time-sensitive research engagements can be
        expedited — reply to the confirmation email with context.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-5">
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 font-editorial text-[14.5px] font-medium text-cool transition-colors hover:text-alert"
        >
          Return to home
          <span className="transition-transform group-hover:translate-x-1">→</span>
        </Link>
        <Link
          href="https://doi.org/10.5281/zenodo.19101219"
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-1.5 font-editorial text-[14.5px] font-medium text-cool transition-colors hover:text-alert"
        >
          Read the Zenodo deposit
          <span className="transition-transform group-hover:translate-x-1">↗</span>
        </Link>
      </div>
    </div>
  );
}
