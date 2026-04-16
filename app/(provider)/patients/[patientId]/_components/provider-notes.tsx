'use client';

/**
 * ProviderNotes -- Notes list + add note form using addProviderNote server action
 *
 * Uses useActionState (React 19) with addProviderNote server action.
 * Hidden input for patientId. Existing notes in reverse chronological order.
 *
 * Requirement: DASH-09 (provider notes)
 */

import { useActionState, useEffect, useRef } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { FileText, Send } from 'lucide-react';
import { addProviderNote, type NoteActionState } from '@/lib/dashboard/actions';
import type { ProviderNote } from '@/lib/dashboard/types';
import { Button } from '@/components/ui/button';

interface ProviderNotesProps {
  patientId: string;
  notes: ProviderNote[];
}

export function ProviderNotes({ patientId, notes }: ProviderNotesProps) {
  const [state, formAction, isPending] = useActionState<
    NoteActionState | null,
    FormData
  >(addProviderNote, null);

  const formRef = useRef<HTMLFormElement>(null);

  // Clear form on success
  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state?.success]);

  return (
    <div className="space-y-6" data-testid="provider-notes">
      {/* Add note form */}
      <form ref={formRef} action={formAction} className="space-y-3">
        <input type="hidden" name="patientId" value={patientId} />
        <div>
          <label htmlFor="note-content" className="block text-sm font-medium text-gray-700 mb-1">
            Add a Note
          </label>
          <textarea
            id="note-content"
            name="content"
            rows={3}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Write a clinical note..."
            required
            maxLength={5000}
          />
          {state?.errors?.content && (
            <p className="mt-1 text-xs text-red-600">{state.errors.content[0]}</p>
          )}
          {state?.error && (
            <p className="mt-1 text-xs text-red-600">{state.error}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending} className="gap-1.5">
            <Send className="h-4 w-4" />
            {isPending ? 'Saving...' : 'Save Note'}
          </Button>
          {state?.success && (
            <p className="text-sm text-green-600">Note saved successfully</p>
          )}
        </div>
      </form>

      {/* Notes list */}
      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText className="h-10 w-10 text-gray-300 mb-3" />
          <p className="text-gray-600">No notes yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">
            Previous Notes ({notes.length})
          </h3>
          {notes.map((note) => {
            let relativeTime: string;
            try {
              relativeTime = formatDistanceToNow(parseISO(note.created_at), {
                addSuffix: true,
              });
            } catch {
              relativeTime = note.created_at;
            }

            return (
              <div
                key={note.id}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">
                    {note.provider_name}
                  </span>
                  <span className="text-xs text-gray-500">{relativeTime}</span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {note.content}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
