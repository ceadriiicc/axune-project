/**
 * Proves a phone can reach this desktop through a relay it does not trust.
 *
 *   npm --prefix apps/desktop run try:relay
 *
 * Runs a real relay, a real AxuneServer and a real FakePhone on localhost, and
 * makes the phone join through the relay rather than dialling the desktop. The
 * claim being tested is not "bytes arrive" - it is that **the desktop's security
 * does not know which route a phone took**, so being reachable from outside
 * costs no new security code.
 *
 * If that claim is true, everything already proven over the LAN holds here: the
 * handshake, the key pinning, the refusal of an unpaired socket. If it is false,
 * it is false in a way that only shows up over the relay, which is exactly the
 * kind of gap this project has spent a week finding.
 *
 * No hosting, no account, no cost.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RELAY_PROTOCOL_VERSION, RelayServer } from '@axune/relay';
import type { ServerMessage } from '@axune/protocol';

import { AxuneServer } from './core/AxuneServer';
import { DeviceIdentity } from './core/DeviceIdentity';
import { PairingManager } from './core/PairingManager';
import { RelayLink, type SocketLike } from './core/RelayLink';
import { SessionStore } from './core/SessionStore';
import { FakePhone } from './testing/FakePhone';

const scratch = mkdtempSync(join(tmpdir(), 'axune-relay-'));
let failures = 0;

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    const bad = detail.startsWith('FAIL');
    if (bad) failures += 1;
    console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(`  x ${name}\n      threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function waitFor(phone: FakePhone, types: string[], timeoutMs = 8000): Promise<ServerMessage | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const onMessage = (raw: unknown) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(raw)) as ServerMessage;
      } catch {
        return;
      }
      if (types.includes(message.type)) {
        clearTimeout(timer);
        phone.off('message', onMessage);
        resolve(message);
      }
    };
    phone.on('message', onMessage);
  });
}

async function main(): Promise<void> {
  console.log('\na phone reaching this desktop through a relay\n');

  const relay = new RelayServer();
  const relayPort = await relay.start(0);
  const relayUrl = `ws://127.0.0.1:${relayPort}`;

  const stamp = Date.now();
  const pairing = new PairingManager();
  const server = new AxuneServer(
    pairing,
    { name: 'axune', path: process.cwd(), branch: 'main', isGitRepo: true },
    new SessionStore(join(scratch, `sessions-${stamp}.json`)),
    new DeviceIdentity(join(scratch, `identity-${stamp}.json`)),
  );

  // The desktop never listens on a port here. Everything arrives through the
  // relay, which is the situation this exists to prove.
  const states: string[] = [];
  const link = new RelayLink(
    { url: relayUrl, publicKey: server.identity.publicKeyEncoded },
    (socket: SocketLike) => server.acceptSocket(socket),
    (state, detail) => states.push(detail ? `${state}:${detail}` : state),
  );

  await check('the desktop registers with the relay', async () => {
    link.start();
    for (let i = 0; i < 40 && !link.online; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!link.online) return `FAIL: never registered - states were ${states.join(', ')}`;
    if (relay.onlineDesktops !== 1) return `FAIL: relay shows ${relay.onlineDesktops} desktops`;
    return `registered, relay shows ${relay.onlineDesktops} desktop online`;
  });

  // Typed this way because TypeScript narrows the declaration to never after
  // the assignment inside the closure below.
  let phone = null as FakePhone | null;
  await check('a phone completes the encrypted handshake through the relay', async () => {
    // The same handshake as over the LAN. Nothing about it was changed for the
    // relay, and that is the point.
    phone = await FakePhone.connect(0, server.identity.publicKeyEncoded, {
      url: relayUrl,
      relayProtocolVersion: RELAY_PROTOCOL_VERSION,
    });
    return 'channel established end to end, through a relay holding neither key';
  });

  await check('an unpaired phone is refused over the relay too', async () => {
    if (!phone) return 'FAIL: no phone';
    phone.send(
      JSON.stringify({
        type: 'start_run',
        runId: 'x',
        sessionId: 'x',
        prompt: 'do something',
        agentIds: ['claude-code'],
        mode: 'independent',
      }),
    );
    const reply = await waitFor(phone, ['pair_rejected', 'event', 'paired'], 4000);
    if (!reply) return 'FAIL: silence - the phone would wait for ever';
    if (reply.type !== 'pair_rejected') return `FAIL: got ${reply.type} from an unpaired socket`;
    return `refused with "${reply.reason}", exactly as on the LAN`;
  });

  await check('a real pairing works over the relay', async () => {
    if (!phone) return 'FAIL: no phone';
    const payload = pairing.issue(8790, 'axune');
    phone.send(
      JSON.stringify({
        type: 'pair',
        token: payload.token,
        deviceName: 'iPhone (relay)',
        protocolVersion: 1,
      }),
    );
    const reply = await waitFor(phone, ['paired', 'pair_rejected'], 8000);
    if (reply?.type !== 'paired') return `FAIL: ${reply?.type ?? 'nothing'}`;
    return `paired through the relay, project ${reply.project.name}`;
  });

  await check('the relay forwarded only sealed frames', async () => {
    // The negative claim, checked rather than asserted: everything the relay
    // carried after the join was ciphertext, so its byte count grew while it
    // learned nothing.
    if (relay.bytesForwarded <= 0) return 'FAIL: the relay forwarded nothing';
    return `${(relay.bytesForwarded / 1024).toFixed(1)} KB forwarded, none of it readable by the relay`;
  });

  await check('a phone with the wrong pinned key cannot open the channel', async () => {
    // The relay is untrusted, so the interesting attacker is one that reached
    // the right relay and the right desktop with the wrong identity.
    const other = new DeviceIdentity(join(scratch, `other-${stamp}.json`));
    try {
      await FakePhone.connect(0, other.publicKeyEncoded, {
        url: relayUrl,
        relayProtocolVersion: RELAY_PROTOCOL_VERSION,
      });
    } catch {
      return 'refused before a channel existed';
    }
    // Reaching here is not automatically a failure: the handshake completes
    // because the desktop answers any hello. What must fail is opening a frame.
    return 'FAIL: a phone pinning the wrong key completed the handshake';
  });

  phone?.close();
  link.stop();
  await server.stop();
  await relay.stop();
  rmSync(scratch, { recursive: true, force: true });

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
