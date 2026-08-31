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
import {
  ASSIST_MAX_TOKENS,
  ASSIST_SYSTEM_PROMPTS,
  ASSIST_TOOL_SCHEMAS,
  buildAssistUserMessage,
  parseAssistOutput,
  sanitizeQaAnswer,
  type AssistRequest,
  type AssistResponse,
} from './assist';
import {
  COPILOT_PROMPT,
  COPILOT_TOOLS,
  buildCopilotUserMessage,
  executeCopilotTool,
  serializeCopilotToolResult,
  type CopilotResult,
  type CopilotTraceEntry,
  type CopilotWorkItem,
} from './copilot';
import { buildSimulatedCallUserMessage, buildTurnUserMessage, SIMULATED_CALL_PROMPT, SYSTEM_PROMPT } from './prompt';
import {
  SIMULATED_CALL_TOOL_SCHEMA,
  checkInToolSchemaFor,
  parseLlmTurn,
  parseSimulatedCall,
  sanitizeTranscriptText,
  type SimulatedCallParsed,
} from './schema';
import { scriptFor } from './call-scripts';
import type { CallLocale, LlmTurn, ScriptId, ScriptQuestion } from './types';

const DEFAULT_MODEL = 'claude-sonnet-5';

function anthropicClient(timeout = 15_000): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 0,
    timeout,
  });
}

export async function runLlmTurn(input: {
  scriptId: ScriptId;
  locale: CallLocale;
  currentQuestion: ScriptQuestion;
  nextQuestion: ScriptQuestion | null;
  reasksUsed: number;
  visitorReply: string;
}): Promise<LlmTurn | null> {
  try {
    const client = anthropicClient();
    const script = scriptFor(input.scriptId);
    const extractionKeys = [...new Set(script.order.flatMap((id) => script.questions[id]?.extractionKeys ?? []))];
    const response = await client.messages.create({
      // `temperature` is intentionally omitted: deprecated for Claude 5 models.
      model: process.env.SANDBOX_AI_MODEL ?? DEFAULT_MODEL,
      max_tokens: 400,
      // Static system prompt is cache-marked: repeated turns bill ~10% of input.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [{
        name: 'check_in_turn',
        description: 'Report the structured result of one check-in turn: extracted data plus the paraphrased next question.',
        input_schema: checkInToolSchemaFor(extractionKeys),
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

/** One assistive generation (explain/brief/polish/qa); null on any failure. */
export async function runAssist(request: AssistRequest): Promise<AssistResponse | null> {
  try {
    const client = anthropicClient();
    const tool = ASSIST_TOOL_SCHEMAS[request.kind];
    const response = await client.messages.create({
      model: process.env.SANDBOX_AI_MODEL ?? DEFAULT_MODEL,
      max_tokens: ASSIST_MAX_TOKENS[request.kind],
      // Static per-kind system prompt is cache-marked: protocol_qa embeds the
      // full clinical content, so repeated questions bill ~10% of input.
      system: [{ type: 'text', text: ASSIST_SYSTEM_PROMPTS[request.kind], cache_control: { type: 'ephemeral' } }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.input_schema as never }],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: buildAssistUserMessage(request) }],
    });
    const toolUse = response.content.find(
      (block) => block.type === 'tool_use' && block.name === tool.name,
    );
    if (!toolUse || toolUse.type !== 'tool_use') return null;
    return parseAssistOutput(request.kind, toolUse.input, request);
  } catch {
    return null;
  }
}

const COPILOT_MAX_ROUNDS = 6;
// The engine-tool set invites longer chains; a wall-clock guard keeps the
// whole loop inside the route budget even when individual rounds are slow.
const COPILOT_WALL_CLOCK_MS = 26_000;

/**
 * "Ask your queue" agent: a bounded tool-use loop over read-only deterministic
 * tools. The model may call tools for up to COPILOT_MAX_ROUNDS rounds; the
 * final text is sanitized before it reaches the client. Null on any failure
 * or when the round budget runs out without a final answer.
 */
export async function runCopilot(input: {
  question: string;
  snapshot: { workItems: CopilotWorkItem[] };
  dayIndex?: number;
}): Promise<CopilotResult | null> {
  try {
    // Multiple tool rounds share one request budget; keep headroom per call.
    const client = anthropicClient(25_000);
    const startedAt = Date.now();
    const toolTrace: CopilotTraceEntry[] = [];
    const toolContext = { workItems: input.snapshot.workItems, dayIndex: input.dayIndex ?? 0 };
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildCopilotUserMessage(input.question) },
    ];

    for (let round = 0; round < COPILOT_MAX_ROUNDS; round += 1) {
      if (round > 0 && Date.now() - startedAt > COPILOT_WALL_CLOCK_MS) return null;
      const response = await client.messages.create({
        model: process.env.SANDBOX_AI_MODEL ?? DEFAULT_MODEL,
        max_tokens: 700,
        system: [{ type: 'text', text: COPILOT_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: COPILOT_TOOLS as never,
        messages,
      });

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (toolUses.length === 0) {
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join(' ');
        const answer = sanitizeQaAnswer(text.slice(0, 1300));
        return answer ? { answer, toolTrace } : null;
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: toolUses.map((toolUse) => {
          const { result, trace } = executeCopilotTool(toolUse.name, toolUse.input, toolContext);
          toolTrace.push(trace);
          return {
            type: 'tool_result' as const,
            tool_use_id: toolUse.id,
            content: serializeCopilotToolResult(result),
          };
        }),
      });
    }
    return null;
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
    // Long one-shot generation: the first uncached run can exceed 15s.
    const client = anthropicClient(30_000);
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
