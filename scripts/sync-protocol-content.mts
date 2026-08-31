/**
 * Regenerates lib/sandbox-ai/protocol-content.generated.ts from
 * reference/clinical_content.md so the protocol reference assistant can embed
 * the published clinical content in its system prompt without runtime file
 * tracing. Run after any edit to the source markdown:
 *
 *   npm run sync:protocol
 *
 * A unit test asserts the generated module matches the source; CI fails on
 * drift.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'reference', 'clinical_content.md');
const TARGET = path.join(ROOT, 'lib', 'sandbox-ai', 'protocol-content.generated.ts');

const content = readFileSync(SOURCE, 'utf8');
const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

const banner = `/**
 * AUTO-GENERATED from reference/clinical_content.md — do not edit by hand.
 * Regenerate with: npm run sync:protocol
 */

export const PROTOCOL_CONTENT_HASH = '${hash}';

export const PROTOCOL_CONTENT = ${JSON.stringify(content)};
`;

writeFileSync(TARGET, banner);
console.log(`wrote ${path.relative(ROOT, TARGET)} (${content.length} chars, hash ${hash})`);
