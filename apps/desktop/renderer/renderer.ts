import type { ActivityEvent, AgentEvent, AgentStatus, PairingPayload } from '@axune/protocol';
import qrcode from 'qrcode-terminal';

/**
 * The window's behaviour.
 *
 * Renders agent output, which is untrusted text, so everything goes in through
 * textContent — never innerHTML. A repository can contain anything, and a
 * desktop window is the last place it should be able to run.
 */
declare global {
  interface Window {
    axune: {
      chooseProject: () => Promise<string | null>;
      newCode: () => Promise<PairingPayload | null>;
      openProject: () => Promise<unknown>;
      on: (channel: string, handler: (payload: any) => void) => void;
    };
  }
}

const $ = (id: string) => document.getElementById(id)!;

function setQr(payload: PairingPayload): void {
  qrcode.generate(JSON.stringify(payload), { small: true }, (art: string) => {
    $('qr').textContent = art;
  });
  const minutes = Math.max(0, Math.round((payload.expiresAt - Date.now()) / 60_000));
  $('expiry').textContent = `Expires in ${minutes} min · single use`;
}

function addLine(text: string): void {
  const feed = $('feed');
  const empty = feed.querySelector('.empty');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = 'line';

  const time = document.createElement('span');
  time.className = 'time';
  const now = new Date();
  time.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const body = document.createElement('span');
  body.className = 'txt';
  body.textContent = text;

  row.append(time, body);
  feed.prepend(row);

  while (feed.children.length > 40) feed.lastElementChild?.remove();
}

window.axune.on('ready', (data) => {
  $('address').textContent = data.address;
  $('project').textContent = data.project.name;
  $('branch').textContent = data.project.branch;

  const agents = $('agents');
  agents.textContent = '';
  for (const agent of data.agents as AgentStatus[]) {
    const row = document.createElement('div');
    row.className = 'agent';

    const dot = document.createElement('span');
    dot.className = agent.installed ? 'dot on' : 'dot';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = agent.agentId === 'claude-code' ? 'Claude Code' : agent.agentId;

    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = agent.installed ? `Ready · ${agent.version ?? ''}`.trim() : 'Not installed';

    row.append(dot, name, state);
    agents.append(row);
  }

  setQr(data.pairing);
});

window.axune.on('connection', (state: string) => {
  const connected = !/disconnected/i.test(state);
  $('link').className = connected ? 'dot on' : 'dot';
  $('linkText').textContent = connected ? 'phone connected' : 'no phone';
  addLine(state);
});

window.axune.on('activity', (event: ActivityEvent) => {
  addLine(event.detail ? `${event.summary} — ${event.detail}` : event.summary);
});

/** Mirror the run the phone is watching, so the desk shows the same thing. */
let streaming = '';
window.axune.on('agent-event', (event: AgentEvent) => {
  const stream = $('stream');

  if (event.type === 'run_started') {
    streaming = '';
    stream.hidden = false;
    addLine(`Run started: ${event.prompt.slice(0, 70)}`);
  } else if (event.type === 'message_delta') {
    streaming += event.text;
    stream.textContent = streaming;
    stream.scrollTop = stream.scrollHeight;
  } else if (event.type === 'tool_started') {
    addLine(`→ ${event.toolName}`);
  } else if (event.type === 'tool_finished' && !event.ok) {
    addLine(`← denied: ${event.output.slice(0, 60)}`);
  } else if (event.type === 'run_finished') {
    addLine(`Run ${event.outcome}`);
  } else if (event.type === 'error') {
    addLine(`Error: ${event.message}`);
  }
});

window.axune.on('error', (message: string) => addLine(`Error: ${message}`));

$('choose').addEventListener('click', () => void window.axune.chooseProject());
$('refresh').addEventListener('click', async () => {
  const payload = await window.axune.newCode();
  if (payload) setQr(payload);
});
$('project').addEventListener('dblclick', () => void window.axune.openProject());
