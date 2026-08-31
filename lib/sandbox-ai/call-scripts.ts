/**
 * Registry of the conversational call scripts the engine can run. Every
 * script's completion delegates to registered deterministic rules; adding a
 * script here requires its own rule-registry entry and clinical review of its
 * question wording (en + es) before release.
 */

import { DAILY_SCRIPT } from './daily-script';
import { TITRATION_SCRIPT } from './titration-script';
import type { CallScript, ScriptId } from './types';

export const CALL_SCRIPTS: Record<ScriptId, CallScript> = {
  daily_checkin: DAILY_SCRIPT,
  titration_followup: TITRATION_SCRIPT,
};

export function scriptFor(id: ScriptId): CallScript {
  return CALL_SCRIPTS[id];
}
