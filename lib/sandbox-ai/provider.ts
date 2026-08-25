/**
 * Sandbox AI-Assisted Check-In -- Anthropic Provider (server only)
 *
 * Single vendor touchpoint: swapping the LLM vendor (e.g. a BAA-covered
 * deployment in a future clinical phase) replaces this file only. Any API,
 * timeout, or schema failure returns null -- the caller degrades to the
 * deterministic fallback, never retries.
 */

import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { buildSimulatedCallUserMessage, buildTurnUserMessage, SIMULATED_CALL_PROMPT, SYSTEM_PROMPT } from './prompt';
import {
  CHECK_IN_TURN_TOOL_SCHEMA,
  SIMULATED_CALL_TOOL_SCHEMA,
  parseLlmTurn,
  parseSimulatedCall,
  sanitizeTranscriptText,
  type SimulatedCallParsed,
} from './schema';
import type { LlmTurn, ScriptQuestion } from './types';

const DEFAULT_MODEL = 'claude-sonnet-5';

function anthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 0,
    timeout: 15_000,
  });
}

export async function runLlmTurn(input: {
  currentQuestion: ScriptQuestion;
  nextQuestion: ScriptQuestion | null;
  reasksUsed: number;
  visitorReply: string;
}): Promise<LlmTurn | null> {
  try {
    const client = anthropicClient();
    const response = await client.messages.create({
      // `temperature` is intentionally omitted: deprecated for Claude 5 models.
      model: process.env.SANDBOX_AI_MODEL ?? DEFAULT_MODEL,
      max_tokens: 400,
      // Static system prompt is cache-marked: repeated turns bill ~10% of input.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [{
        name: 'check_in_turn',
        description: 'Report the structured result of one check-in turn: extracted data plus the paraphrased next question.',
        input_schema: CHECK_IN_TURN_TOOL_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'check_in_turn' },
      messages: [{ role: 'user', content: buildTurnUserMessage(input) }],
    });
    const toolUse = response.content.find(
      (block) => block.type === 'tool_use' && block.name === 'check_in_turn',
    );
    if (!toolUse || toolUse.type !== 'tool_use') return null;
    return parseLlmTurn(toolUse.input);
  } catch {
    return null;
  }
}

/** One-shot transcript generation for the provider-side outreach demonstration. */
export async function runSimulatedCall(scenario: {
  patientName: string;
  profile: string;
}): Promise<SimulatedCallParsed | null> {
  try {
    const client = anthropicClient();
    const response = await client.messages.create({
      model: process.env.SANDBOX_AI_MODEL ?? DEFAULT_MODEL,
      max_tokens: 1200,
      system: [{ type: 'text', text: SIMULATED_CALL_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [{
        name: 'simulated_call',
        description: 'Report one complete simulated outreach call: the transcript turns and the structured data the call established.',
        input_schema: SIMULATED_CALL_TOOL_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'simulated_call' },
      messages: [{ role: 'user', content: buildSimulatedCallUserMessage(scenario) }],
    });
    const toolUse = response.content.find(
      (block) => block.type === 'tool_use' && block.name === 'simulated_call',
    );
    if (!toolUse || toolUse.type !== 'tool_use') return null;
    const parsed = parseSimulatedCall(toolUse.input);
    if (!parsed) return null;
    const turns = parsed.turns
      .map((turn) => ({ speaker: turn.speaker, text: sanitizeTranscriptText(turn.text) }))
      .filter((turn) => turn.text.length > 0);
    return turns.length >= 6 ? { ...parsed, turns } : null;
  } catch {
    return null;
  }
}
