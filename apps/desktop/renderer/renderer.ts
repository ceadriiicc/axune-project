import type { ActivityEvent, AgentEvent, AgentStatus, PairingPayload } from '@axune/protocol';
import qrcode from 'qrcode-terminal';

/** All IPC content, including agent output, is untrusted text. Never parse it as HTML. */
interface ReadyPayload {
  project: { name: string; path: string; branch: string };
  agents: AgentStatus[];
  pairing: PairingPayload;
  address: string;
  /** The code the phone asks you to match after scanning. Optional so an older main process does not break the window. */
  fingerprint?: string;
}

interface RendererEvents {
  ready: ReadyPayload;
  'agent-event': AgentEvent;
  connection: string;
  activity: ActivityEvent;
  error: string;
}

declare global {
  interface Window {
    axune: {
      chooseProject: () => Promise<string | null>;
      newCode: () => Promise<PairingPayload | null>;
      openProject: () => Promise<unknown>;
      on: <K extends keyof RendererEvents>(channel: K, handler: (payload: RendererEvents[K]) => void) => void;
    };
  }
}

const $ = (id: string) => document.getElementById(id)!;
const button = (id: string) => $(id) as HTMLButtonElement;
const agentName = (id: string) => ({ 'claude-code': 'Claude Code', codex: 'Codex', 'gemini-cli': 'Gemini CLI' })[id] ?? id;
let pairingExpiresAt: number | null = null;
let pairingUsed = false;

function updateExpiry(): void {
  if (pairingExpiresAt === null) return;
  const remaining = Math.max(0, Math.ceil((pairingExpiresAt - Date.now()) / 1000));
  const unavailable = pairingUsed || remaining === 0;
  $('qr').hidden = unavailable;
  $('qrPlaceholder').hidden = !unavailable;
  $('expiry').classList.toggle('expired', unavailable);
  if (unavailable) {
    $('qrPlaceholder').textContent = pairingUsed ? 'Phone paired' : 'Code expired';
    $('expiry').textContent = 'Generate a new code to pair a phone.';
  } else {
    $('expiry').textContent = `Single use · expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  }
}

function setQr(payload: PairingPayload): void {
  pairingExpiresAt = null;
  $('qr').hidden = true;
  $('qrPlaceholder').hidden = false;
  $('qrPlaceholder').textContent = 'Pairing code unavailable';
  $('expiry').textContent = '';
  // The existing encoder returns half-block terminal art. Draw its exact cells
  // onto a canvas so scanning does not depend on font metrics or glyph seams.
  qrcode.generate(JSON.stringify(payload), { small: true }, (art: string) => {
    const rows = art.replace(/\n$/, '').split('\n');
    const canvas = $('qr') as HTMLCanvasElement;
    const scale = 4;
    const quiet = 4;
    // Remove the terminal border, including its black outer half-row.
    const modules = rows[0].length - 2;
    canvas.width = canvas.height = (modules + quiet * 2) * scale;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to draw the pairing code.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    for (let y = 0; y < modules; y++) {
      for (let x = 0; x < modules; x++) {
        const cell = rows[1 + Math.floor(y / 2)][x + 1];
        // In qrcode-terminal's small format, block glyphs represent WHITE.
        const dark = cell === ' ' || cell === (y % 2 === 0 ? '▄' : '▀');
        if (dark) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
  });
  pairingExpiresAt = payload.expiresAt;
  pairingUsed = false;
  updateExpiry();
}

window.setInterval(updateExpiry, 1000);

function addLine(text: string, at = Date.now(), isError = false): void {
  const feed = $('feed');
  feed.querySelector('.empty')?.remove();
  const row = document.createElement('div');
  row.className = isError ? 'line error' : 'line';
  row.dataset.at = String(at);
  const time = document.createElement('time');
  time.className = 'time';
  const date = new Date(at);
  time.dateTime = date.toISOString();
  time.title = date.toLocaleString();
  time.textContent = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const body = document.createElement('span');
  body.className = 'txt';
  body.textContent = text;
  row.append(time, body);
  // Late/replayed events belong at their event time, not their arrival time.
  // Equal timestamps retain arrival order; trim only after ordering.
  const older = Array.from(feed.children).find((child) => Number((child as HTMLElement).dataset.at) < at);
  feed.insertBefore(row, older ?? null);
  while (feed.children.length > 40) feed.lastElementChild?.remove();
}

function showError(message: string): void {
  $('errorNotice').hidden = false;
  $('errorText').textContent = message;
  addLine(message, Date.now(), true);
}

window.axune.on('ready', (data) => {
  $('address').textContent = data.address;
  $('project').textContent = data.project.name;
  $('path').textContent = data.project.path;
  $('branch').textContent = data.project.branch;
  $('branchMeta').hidden = !data.project.branch;
  // textContent, like everything else here. An em dash rather than an empty
  // space when absent, so a missing code reads as missing instead of as a
  // layout gap somebody scrolls past.
  $('fingerprint').textContent = data.fingerprint ?? '—';
  for (const id of ['choose', 'open', 'refresh']) button(id).disabled = false;
  const agents = $('agents');
  agents.replaceChildren();
  $('agentsBlocked').hidden = !data.agents.length || data.agents.some((agent) => agent.installed);
  for (const agent of data.agents) {
    const row = document.createElement('div');
    row.className = 'agent';
    row.dataset.agent = agent.agentId;
    const mark = document.createElement('span');
    mark.className = 'agent-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = agent.agentId === 'codex' ? 'Co' : agentName(agent.agentId).slice(0, 1);
    const info = document.createElement('div');
    info.className = 'agent-info';
    const name = document.createElement('div');
    name.className = 'agent-name';
    name.textContent = agentName(agent.agentId);
    info.append(name);
    if (agent.version) {
      const version = document.createElement('div');
      version.className = 'agent-version';
      version.textContent = agent.version;
      info.append(version);
    }
    const state = document.createElement('span');
    state.className = 'agent-state';
    if (!agent.installed) state.textContent = 'Not installed';
    else if (agent.authenticated === 'no') state.textContent = 'Sign-in needed';
    else if (agent.authenticated === 'yes') {
      state.textContent = 'Ready';
      state.classList.add('available');
    } else state.textContent = 'Installed · sign-in unknown';
    row.append(mark, info, state);
    if ((!agent.installed || agent.authenticated === 'no') && agent.detail) {
      const help = document.createElement('div');
      help.className = 'agent-help';
      const detail = document.createElement('p');
      detail.className = 'agent-detail';
      detail.textContent = agent.detail;
      // Extract only the command explicitly supplied by detection. If its
      // wording is different, preserve and copy the complete detail instead.
      const command = /Install it with:[ \t]*([^\r\n]+?)(?=[ \t]+\(Error:|[\r\n]|$)/.exec(agent.detail)?.[1];
      const copyText = command ?? agent.detail;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'agent-copy';
      copy.textContent = command ? 'Copy install command' : 'Copy details';
      copy.setAttribute('aria-label', `${copy.textContent} for ${agentName(agent.agentId)}`);
      const status = document.createElement('p');
      status.className = 'agent-copy-status';
      status.setAttribute('role', 'status');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(copyText);
          status.textContent = command ? 'Install command copied.' : 'Details copied.';
        } catch {
          status.textContent = 'Could not copy. Select and copy the text above.';
        }
      });
      help.append(detail, copy, status);
      row.append(help);
    }
    agents.append(row);
  }
  if (!data.agents.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No agents reported.';
    agents.append(empty);
  }
  try { setQr(data.pairing); } catch (error) { showError(String(error)); }
});

window.axune.on('connection', (state) => {
  const disconnected = /\bdisconnected\b/i.test(state);
  const connected = !disconnected && /\b(paired|connected|reconnected)\b/i.test(state);
  $('link').classList.toggle('on', connected);
  $('linkText').textContent = disconnected ? 'Phone disconnected' : connected ? 'Phone connected' : state;
  // Only a pairing event consumes the displayed single-use code. Reconnecting
  // an already trusted phone does not imply a newly generated code was used.
  if (/\bpaired$/i.test(state)) {
    pairingUsed = true;
    updateExpiry();
  }
  addLine(state);
});

window.axune.on('activity', (event) => {
  addLine(event.detail ? `${event.summary}\n${event.detail}` : event.summary, event.at);
});

interface RunOutput { element: HTMLDetailsElement; title: HTMLElement; body: HTMLElement; text: string }
const outputs = new Map<string, RunOutput>();

function outputFor(event: AgentEvent): RunOutput {
  const existing = outputs.get(event.runId);
  if (existing) return existing;
  const element = document.createElement('details');
  element.className = 'run';
  element.open = true;
  const title = document.createElement('summary');
  title.textContent = `${agentName(event.agentId)} · output`;
  const body = document.createElement('pre');
  body.className = 'stream';
  body.tabIndex = 0;
  body.setAttribute('aria-label', `${agentName(event.agentId)} output`);
  body.textContent = 'Waiting for output…';
  element.append(title, body);
  $('streams').prepend(element);
  const output = { element, title, body, text: '' };
  outputs.set(event.runId, output);
  // Keep a bounded recent view, with independent text buffers for parallel runs.
  while (outputs.size > 8) {
    const oldest = outputs.keys().next().value!;
    outputs.get(oldest)!.element.remove();
    outputs.delete(oldest);
  }
  return output;
}

window.axune.on('agent-event', (event) => {
  const name = agentName(event.agentId);
  if (event.type === 'run_started') {
    const output = outputFor(event);
    output.text = '';
    output.body.textContent = 'Waiting for output…';
    output.title.textContent = `${name} · running`;
    addLine(`${name}: ${event.prompt}`, event.ts);
  } else if (event.type === 'message_delta') {
    const output = outputFor(event);
    const follow = output.body.scrollHeight - output.body.scrollTop - output.body.clientHeight < 32;
    const combined = output.text + event.text;
    output.text = combined.length > 24_000 ? `Earlier output omitted.\n${combined.slice(-23_950)}` : combined;
    output.body.textContent = output.text;
    if (follow) output.body.scrollTop = output.body.scrollHeight;
  } else if (event.type === 'tool_started') {
    addLine(`${name}: ${event.toolName}`, event.ts);
  } else if (event.type === 'tool_finished' && !event.ok) {
    addLine(`${name}: tool failed\n${event.output}`, event.ts, true);
  } else if (event.type === 'run_finished') {
    const output = outputs.get(event.runId);
    if (output) {
      output.title.textContent = `${name} · ${event.outcome}`;
      if (!output.text) output.body.textContent = 'No text output received.';
    }
    addLine(`${name}: run ${event.outcome}`, event.ts, event.outcome === 'failed');
  } else if (event.type === 'error') {
    addLine(`${name}: ${event.message}`, event.ts, true);
  }
});

window.axune.on('error', showError);

async function perform(id: string, pending: string, action: () => Promise<void>): Promise<void> {
  const control = button(id);
  const label = control.textContent;
  control.disabled = true;
  control.textContent = pending;
  control.setAttribute('aria-busy', 'true');
  try { await action(); } catch (error) { showError(String(error)); }
  finally {
    control.disabled = false;
    control.textContent = label;
    control.removeAttribute('aria-busy');
  }
}

button('choose').addEventListener('click', () => void perform('choose', 'Choosing…', async () => {
  await window.axune.chooseProject();
}));
button('refresh').addEventListener('click', () => void perform('refresh', 'Generating…', async () => {
  const payload = await window.axune.newCode();
  if (!payload) throw new Error('Pairing is not available yet. Try again shortly.');
  setQr(payload);
}));
button('open').addEventListener('click', () => void perform('open', 'Opening…', async () => {
  const result = await window.axune.openProject();
  if (typeof result === 'string' && result) throw new Error(result);
}));
button('dismiss').addEventListener('click', () => { $('errorNotice').hidden = true; });
