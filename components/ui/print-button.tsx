'use client';

import { Printer } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PrintButtonProps {
  className?: string;
  label?: string;
}

/**
 * Reusable print button that triggers window.print().
 * Automatically hidden in print output via print:hidden class.
 *
 * Used by: risk calculator result, GDMT pathway, titration checklist,
 * tier selector result, patient daily diary.
 */
export function PrintButton({ className, label = 'Print' }: PrintButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn(
        'print:hidden inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted',
        className,
      )}
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
