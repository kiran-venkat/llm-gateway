/**
 * Spike 03 — Raw provider response shapes
 *
 * Purpose: call OpenAI, Anthropic, and Gemini with the same prompt and log
 * the RAW response before any normalisation. This is the reference for writing
 * the adapter layer in Phase 2.
 *
 * Run:
 *   npx ts-node spikes/03-providers.ts
 *
 * Requires real API keys in .env:
 *   OPENAI_API_KEY=sk-...
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   GEMINI_API_KEY=AIza...
 */

// ---------------------------------------------------------------------------
// Bootstrap — load .env before any SDK import reads process.env
// ---------------------------------------------------------------------------
import { readFileSync } from 'fs';
import { join } from 'path';

function loadEnv(): void {
  try {
    const raw = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env not found — proceed with existing process.env
  }
}
loadEnv();

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PROMPT = [
  {
    role: 'user' as const,
    content: 'Reply with exactly three words: hello world test',
  },
];

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? '';

function banner(title: string): void {
  const line = '═'.repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}`);
}

function section(title: string): void {
  console.log(`\n  ── ${title} ${'─'.repeat(60 - title.length)}`);
}

// ---------------------------------------------------------------------------
// OPENAI
// ---------------------------------------------------------------------------
async function runOpenAI(): Promise<void> {
  banner('OPENAI  (gpt-4o-mini)');

  if (!OPENAI_KEY) {
    console.log('  ⚠  OPENAI_API_KEY not set — skipping');
    return;
  }

  const client = new OpenAI({ apiKey: OPENAI_KEY });

  // ── Non-streaming ─────────────────────────────────────────────────────────
  section('NON-STREAM — raw response object');
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: PROMPT,
    max_tokens: 20,
  });

  console.log('\n  Full response:');
  console.log(JSON.stringify(resp, null, 2));

  console.log('\n  ► WHERE IS THE TEXT?');
  console.log(
    '    resp.choices[0].message.content =',
    resp.choices[0].message.content,
  );

  console.log('\n  ► WHERE ARE THE TOKENS?');
  console.log('    resp.usage?.prompt_tokens     =', resp.usage?.prompt_tokens);
  console.log(
    '    resp.usage?.completion_tokens =',
    resp.usage?.completion_tokens,
  );
  console.log('    resp.usage?.total_tokens      =', resp.usage?.total_tokens);

  // ── Streaming ─────────────────────────────────────────────────────────────
  section('STREAM — first 3 chunks then break');
  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: PROMPT,
    max_tokens: 20,
    stream: true,
  });

  let chunkCount = 0;
  for await (const chunk of stream) {
    if (chunkCount < 3) {
      console.log(`\n  chunk[${chunkCount}] raw:`);
      console.log(JSON.stringify(chunk, null, 2));
      console.log('  ► delta text:', chunk.choices[0]?.delta?.content);
    }
    chunkCount++;
    if (chunkCount >= 3) {
      stream.controller.abort();
      break;
    }
  }

  // ── Error shape ───────────────────────────────────────────────────────────
  section('ERROR — bad model name');
  try {
    await client.chat.completions.create({
      model: 'gpt-does-not-exist',
      messages: PROMPT,
    });
  } catch (err: unknown) {
    console.log('\n  Error type:', (err as Error).constructor.name);
    console.log('  Full error:');
    console.log(
      JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2),
    );
    if (err instanceof OpenAI.APIError) {
      console.log('\n  ► Structured fields:');
      console.log('    err.status  =', err.status);
      console.log('    err.code    =', err.code);
      console.log('    err.message =', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// ANTHROPIC
// ---------------------------------------------------------------------------
async function runAnthropic(): Promise<void> {
  banner('ANTHROPIC  (claude-haiku-4-5-20251001)');

  if (!ANTHROPIC_KEY) {
    console.log('  ⚠  ANTHROPIC_API_KEY not set — skipping');
    return;
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  // ── Non-streaming ─────────────────────────────────────────────────────────
  section('NON-STREAM — raw response object');
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 20,
    messages: PROMPT,
  });

  console.log('\n  Full response:');
  console.log(JSON.stringify(resp, null, 2));

  console.log('\n  ► WHERE IS THE TEXT?');
  const firstBlock = resp.content[0];
  console.log('    resp.content[0].type         =', firstBlock.type);
  console.log(
    '    resp.content[0].text (if text)=',
    firstBlock.type === 'text' ? firstBlock.text : 'N/A',
  );

  console.log('\n  ► WHERE ARE THE TOKENS?');
  console.log('    resp.usage.input_tokens  =', resp.usage.input_tokens);
  console.log('    resp.usage.output_tokens =', resp.usage.output_tokens);

  console.log('\n  ► SYSTEM MESSAGE PLACEMENT:');
  console.log('    system is a TOP-LEVEL param, NOT in messages[]');
  console.log(
    '    e.g.  messages.create({ system: "You are...", messages: [...] })',
  );

  // ── Streaming ─────────────────────────────────────────────────────────────
  section('STREAM — first 5 events then break');
  const stream = client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 20,
    messages: PROMPT,
  });

  let eventCount = 0;
  for await (const event of stream) {
    if (eventCount < 5) {
      console.log(`\n  event[${eventCount}] raw:`);
      console.log(JSON.stringify(event, null, 2));
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        console.log('  ► delta text:', event.delta.text);
      }
    }
    eventCount++;
    if (eventCount >= 5) break;
  }
  stream.abort();

  // ── Error shape ───────────────────────────────────────────────────────────
  section('ERROR — bad model name');
  try {
    await client.messages.create({
      model: 'claude-does-not-exist',
      max_tokens: 20,
      messages: PROMPT,
    });
  } catch (err: unknown) {
    console.log('\n  Error type:', (err as Error).constructor.name);
    console.log('  Full error:');
    console.log(
      JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2),
    );
    if (err instanceof Anthropic.APIError) {
      console.log('\n  ► Structured fields:');
      console.log('    err.status  =', err.status);
      console.log('    err.error   =', JSON.stringify(err.error));
      console.log('    err.message =', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// GEMINI
// ---------------------------------------------------------------------------
async function runGemini(): Promise<void> {
  banner('GEMINI  (gemini-2.0-flash-001)');

  if (!GEMINI_KEY) {
    console.log('  ⚠  GEMINI_API_KEY not set — skipping');
    return;
  }

  const genai = new GoogleGenerativeAI(GEMINI_KEY);
  const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash-001' });

  // Gemini uses a different message shape — translate for comparison
  const geminiMessages = [
    {
      role: 'user' as const,
      parts: [{ text: 'Reply with exactly three words: hello world test' }],
    },
  ];

  // ── Non-streaming ─────────────────────────────────────────────────────────
  section('NON-STREAM — raw response object');
  const resp = await model.generateContent({ contents: geminiMessages });

  console.log('\n  Full response:');
  console.log(JSON.stringify(resp, null, 2));

  const candidate = resp.response.candidates?.[0];
  console.log('\n  ► WHERE IS THE TEXT?');
  console.log(
    '    resp.response.candidates[0].content.parts[0].text =',
    candidate?.content?.parts?.[0]?.text,
  );
  console.log('    (also available via helper: resp.response.text())');
  console.log('    resp.response.text() =', resp.response.text());

  console.log('\n  ► WHERE ARE THE TOKENS?');
  console.log(
    '    resp.response.usageMetadata?.promptTokenCount     =',
    resp.response.usageMetadata?.promptTokenCount,
  );
  console.log(
    '    resp.response.usageMetadata?.candidatesTokenCount =',
    resp.response.usageMetadata?.candidatesTokenCount,
  );
  console.log(
    '    resp.response.usageMetadata?.totalTokenCount      =',
    resp.response.usageMetadata?.totalTokenCount,
  );

  console.log('\n  ► ROLE DIFFERENCE:');
  console.log(
    "    Gemini uses role: 'model' where OpenAI uses role: 'assistant'",
  );
  console.log('    candidate.content.role =', candidate?.content?.role);

  // ── Streaming ─────────────────────────────────────────────────────────────
  section('STREAM — first 3 chunks then break');
  const streamResp = await model.generateContentStream({
    contents: geminiMessages,
  });

  let chunkCount = 0;
  for await (const chunk of streamResp.stream) {
    if (chunkCount < 3) {
      console.log(`\n  chunk[${chunkCount}] raw:`);
      console.log(JSON.stringify(chunk, null, 2));
      console.log(
        '  ► delta text:',
        chunk.candidates?.[0]?.content?.parts?.[0]?.text,
      );
    }
    chunkCount++;
    if (chunkCount >= 3) break;
  }

  // ── Error shape ───────────────────────────────────────────────────────────
  section('ERROR — bad model name');
  try {
    const badModel = genai.getGenerativeModel({
      model: 'gemini-does-not-exist',
    });
    await badModel.generateContent({ contents: geminiMessages });
  } catch (err: unknown) {
    console.log('\n  Error type:', (err as Error).constructor.name);
    console.log('  Full error:');
    console.log(
      JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2),
    );
    const e = err as Record<string, unknown>;
    console.log('\n  ► Structured fields:');
    console.log('    err.status  =', e['status']);
    console.log('    err.message =', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(
    '\n╔══════════════════════════════════════════════════════════════════════╗',
  );
  console.log(
    '║         SPIKE 03 — Raw provider response shapes                     ║',
  );
  console.log(
    '║         Prompt: "Reply with exactly three words: hello world test"   ║',
  );
  console.log(
    '╚══════════════════════════════════════════════════════════════════════╝',
  );

  await runOpenAI().catch((err: unknown) =>
    console.error('\n[OpenAI fatal]', (err as Error).message),
  );

  await runAnthropic().catch((err: unknown) =>
    console.error('\n[Anthropic fatal]', (err as Error).message),
  );

  await runGemini().catch((err: unknown) =>
    console.error('\n[Gemini fatal]', (err as Error).message),
  );

  console.log('\n\n═'.repeat(72));
  console.log(
    '  Done. Review the output above before writing Phase 2 adapters.',
  );
  console.log('═'.repeat(72) + '\n');
}

void main();
