/**
 * Proves the Gemini adapter without Gemini.
 *
 *   npm --prefix apps/desktop run try:gemini
 *
 * Gemini CLI is not installed here, so the provider-specific claims in
 * `GeminiAdapter` are hypotheses. Everything that does NOT depend on the
 * provider can still be proven, and is: process lifecycle, stop, outcome from
 * exit code, session id capture, stderr as a failure channel, chunk-split
 * records, and - most importantly - that an unrecognised record becomes a
 * visible error instead of vanishing.
 *
 * It works by pointing AXUNE_GEMINI_BIN at a stub script that emits records we
 * control. That is the difference between an adapter that typechecks and one
 * that has been run. Writing a translator against an output format nobody has
 * seen and shipping it untested is how the last abstraction turned out to be
 * wrong.
 *
 * Costs nothing: no agent, no network, no usage.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GeminiAdapter } from '@axune/agent-core';
import type { AgentEvent } from '@axune/protocol';

const scratch = mkdtempSync(join(tmpdir(), 'axune-gemini-'));
let failures = 0;

/** Newlines built from codepoints, so no escape sequence appears in this file. */
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    const bad = detail.startsWith('FAIL');
    if (bad) failures += 1;
    console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(`  x ${name}\n      threw: ${String(error)}`);
  }
}

/**
 * A stub standing in for the CLI. Writes the given lines to stdout, optionally
 * writes to stderr, and exits with the given code.
 */
function stub(name: string, lines: string[], opts: { code?: number; stderr?: string } = {}): string {
  const path = join(scratch, `${name}.js`);
  const body = [
    'const lines = ' + JSON.stringify(lines) + ';',
    'for (const l of lines) process.stdout.write(l);',
    opts.stderr ? 'process.stderr.write(' + JSON.stringify(opts.stderr) + ');' : '',
    // Exit on the next tick so stdout is flushed first.
    'setTimeout(() => process.exit(' + (opts.code ?? 0) + '), 30);',
  ].join('\n');
  writeFileSync(path, body);
  // A .cmd shim, because the adapter spawns a binary rather than node.
  const shim = join(scratch, `${name}.cmd`);
  writeFileSync(shim, `@echo off\r\nnode "${path}" %*\r\n`);
  return shim;
}

const request = (over: Record<string, unknown> = {}) =>
  ({
    runId: 'r1',
    sessionId: 's1',
    mode: 'independent',
    prompt: 'what is this project?',
    cwd: process.cwd(),
    branch: 'main',
    readOnly: true,
    ...over,
  }) as never;

async function collect(bin: string, over: Record<string, unknown> = {}) {
  const events: AgentEvent[] = [];
  const adapter = new GeminiAdapter(bin);
  const handle = adapter.start(request(over), (e) => events.push(e));
  const result = await handle.done;
  return { events, result };
}

async function main() {
  console.log('\ngemini adapter, driven against a stub\n');

  await check('a missing binary is reported as not installed, not as a crash', async () => {
    const detection = await new GeminiAdapter(join(scratch, 'definitely-not-here')).detect();
    if (detection.installed) return 'FAIL: claimed to be installed';
    if (detection.authenticated !== 'no') return `FAIL: authenticated=${detection.authenticated}`;
    return `installed=false, and it says why: "${detection.detail.slice(0, 60)}..."`;
  });

  await check('a version string is parsed when the binary answers', async () => {
    const bin = stub('version', [], {});
    // --version goes through the same shim, which prints nothing; the adapter
    // must still treat a zero exit as installed rather than requiring output.
    const detection = await new GeminiAdapter(bin).detect();
    return detection.installed
      ? `installed=true, version ${detection.version ?? '(none reported)'}`
      : `FAIL: ${detection.detail}`;
  });

  await check('text records become streamed message text', async () => {
    const bin = stub('text', [
      '{"type":"session","session_id":"sess-abc"}\n',
      '{"type":"content","text":"Axune is "}\n',
      '{"type":"content","text":"a phone-first agent runner."}\n',
    ]);
    const { events, result } = await collect(bin);
    const text = events.filter((e) => e.type === 'message_delta').map((e) => e.text).join('');
    if (text !== 'Axune is a phone-first agent runner.') return `FAIL: got "${text}"`;
    if (result.outcome !== 'completed') return `FAIL: outcome ${result.outcome}`;
    if (result.providerSessionId !== 'sess-abc') return `FAIL: session ${result.providerSessionId}`;
    return `text assembled, outcome completed, session id "${result.providerSessionId}" captured for resume`;
  });

  await check('a record split across chunks is not corrupted', async () => {
    // The JSON is deliberately cut mid-token, which is what a naive line
    // reader mangles under load.
    const bin = stub('split', [
      '{"type":"content","te',
      'xt":"half and "}\n{"type":"content","text":"half"}\n',
    ]);
    const { events } = await collect(bin);
    const text = events.filter((e) => e.type === 'message_delta').map((e) => e.text).join('');
    return text === 'half and half' ? 'reassembled across the chunk boundary' : `FAIL: "${text}"`;
  });

  await check('a final record with no trailing newline is not lost', async () => {
    const bin = stub('tail', ['{"type":"content","text":"last word"}']);
    const { events } = await collect(bin);
    const text = events.filter((e) => e.type === 'message_delta').map((e) => e.text).join('');
    return text === 'last word' ? 'flushed at exit' : `FAIL: "${text}"`;
  });

  await check('an unknown record becomes a visible error, never silence', async () => {
    const bin = stub('unknown', ['{"type":"telemetry_v2","weird":true}\n']);
    const { events } = await collect(bin);
    const errors = events.filter((e) => e.type === 'error');
    if (errors.length === 0) return 'FAIL: swallowed it - the phone would show a run that did nothing';
    if (!/telemetry_v2/.test(errors[0]!.message)) return `FAIL: unhelpful: ${errors[0]!.message}`;
    return `surfaced: "${errors[0]!.message.slice(0, 70)}..."`;
  });

  await check('tool calls pair up with their results', async () => {
    const bin = stub('tools', [
      '{"type":"tool_call","id":"t1","name":"read_file","args":{"path":"README.md"}}\n',
      '{"type":"tool_result","id":"t1","text":"# Axune"}\n',
    ]);
    const { events } = await collect(bin);
    const started = events.find((e) => e.type === 'tool_started');
    const finished = events.find((e) => e.type === 'tool_finished');
    if (!started || !finished) return 'FAIL: missing one half of the lifecycle';
    if (started.toolCallId !== finished.toolCallId) return 'FAIL: ids do not match';
    return `${started.toolName} started and finished under one id, ok=${finished.ok}`;
  });

  await check('a non-zero exit fails the run and reports stderr', async () => {
    const bin = stub('boom', ['{"type":"content","text":"partial"}\n'], {
      code: 2,
      stderr: 'gemini: quota exceeded',
    });
    const { events, result } = await collect(bin);
    if (result.outcome !== 'failed') return `FAIL: outcome ${result.outcome}`;
    const error = events.find((e) => e.type === 'error');
    if (!error || !/quota exceeded/.test(error.message)) {
      return `FAIL: stderr not surfaced - got "${error?.message ?? 'nothing'}"`;
    }
    return 'failed, with the stderr reason carried through';
  });

  await check('stop mid-run reports stopped, not failed', async () => {
    // Emits slowly so there is something to interrupt.
    const path = join(scratch, 'slow.js');
    writeFileSync(
      path,
      'process.stdout.write(\'{"type":"content","text":"working"}\\n\');\nsetTimeout(() => process.exit(0), 10000);',
    );
    writeFileSync(join(scratch, 'slow.cmd'), `@echo off\r\nnode "${path}" %*\r\n`);

    const adapter = new GeminiAdapter(join(scratch, 'slow.cmd'));
    const events: AgentEvent[] = [];
    const handle = adapter.start(request(), (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 700));
    await handle.stop();
    const result = await handle.done;
    if (result.outcome !== 'stopped') return `FAIL: outcome ${result.outcome}`;
    if (events.some((e) => e.type === 'error')) return 'FAIL: a deliberate stop reported an error';
    return 'stopped cleanly, and a stop is an outcome rather than an error';
  });

  await check('a write run is refused before anything is spawned', async () => {
    const bin = stub('nowrite', ['{"type":"content","text":"should never run"}\n']);
    const { events, result } = await collect(bin, { readOnly: false });
    if (result.outcome !== 'failed') return `FAIL: outcome ${result.outcome}`;
    if (events.some((e) => e.type === 'message_delta')) return 'FAIL: the process ran anyway';
    const error = events.find((e) => e.type === 'error');
    if (!error || !/read-only/i.test(error.message)) return `FAIL: unclear reason: ${error?.message}`;
    return 'refused, with a reason - unverified containment is not shipped as though it works';
  });

  await check('a prompt full of shell metacharacters cannot execute anything', async () => {
    // The breach attempt. On Windows a .cmd shim must be spawned through a
    // shell, and a shell concatenates arguments rather than escaping them - so
    // if the prompt were passed in argv, the second command here would run.
    const marker = join(scratch, 'INJECTED.txt');
    const hostile = [
      'tell me about the project" & echo pwned > "',
      marker,
      '" & rem ',
    ].join('');

    // A stub that echoes back whatever arrives on stdin, so the prompt can be
    // proven to have travelled by the intended route rather than merely to
    // have not exploded.
    const echoPath = join(scratch, 'echo.js');
    writeFileSync(
      echoPath,
      [
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (c) => { input += c; });",
        "process.stdin.on('end', () => {",
        '  const line = JSON.stringify({ type: "content", text: input.slice(0, 40) });',
        '  process.stdout.write(line + String.fromCharCode(10));',
        '  process.exit(0);',
        '});',
      ]
        .join(LF),
    );
    writeFileSync(join(scratch, 'echo.cmd'), ['@echo off', 'node "' + echoPath + '" %*', ''].join(CRLF));

    const { events } = await collect(join(scratch, 'echo.cmd'), { prompt: hostile });

    if (existsSync(marker)) return 'FAIL: the injected command ran - the prompt reached a shell';
    const text = events
      .filter((e) => e.type === 'message_delta')
      .map((e) => e.text)
      .join('');
    if (!text.includes('tell me about the project')) {
      return `FAIL: the prompt did not arrive on stdin - got "${text}"`;
    }
    return 'no command ran, and the prompt arrived intact on stdin';
  });

  rmSync(scratch, { recursive: true, force: true });
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
