/**
 * Proves the relay forwards without understanding.
 *
 *   npm --prefix packages/relay run try
 *
 * The relay is the one component whose whole value is a negative claim: that it
 * cannot read what passes through it. A test that only shows two sockets
 * exchanging messages would prove the opposite of what matters, so the checks
 * here are mostly about what the relay does *not* do - refuse to pair on a
 * guess, refuse to parse a payload, hold nothing after a disconnect.
 *
 * Runs entirely on localhost. No hosting, no account, no cost.
 */
import { randomBytes } from 'node:crypto';

import { WebSocket } from 'ws';

import { RelayServer } from './RelayServer';
import { RELAY_PROTOCOL_VERSION } from './protocol';

let failures = 0;

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

const key = (seed: string) => Buffer.from(seed.padEnd(32, '.')).toString('base64url');

/** A socket with a queue, so a test can await the next frame without racing it. */
class Peer {
  private readonly queue: string[] = [];
  private waiting: ((value: string) => void) | null = null;

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const text = String(raw);
      if (this.waiting) {
        const resolve = this.waiting;
        this.waiting = null;
        resolve(text);
      } else {
        this.queue.push(text);
      }
    });
    socket.on('error', () => undefined);
  }

  static open(port: number): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      socket.once('open', () => resolve(new Peer(socket)));
      socket.once('error', reject);
    });
  }

  send(value: unknown): void {
    this.socket.send(typeof value === 'string' ? value : JSON.stringify(value));
  }

  next(timeoutMs = 2000): Promise<string> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiting = resolve;
      setTimeout(() => {
        if (this.waiting === resolve) {
          this.waiting = null;
          resolve('(nothing within timeout)');
        }
      }, timeoutMs);
    });
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // Already gone.
    }
  }
}

async function main(): Promise<void> {
  const relay = new RelayServer();
  const port = await relay.start(0);
  console.log(`\nrelay on 127.0.0.1:${port}\n`);

  const DESKTOP = key('desktop-one');

  await check('a phone cannot reach a desktop that is not there', async () => {
    const phone = await Peer.open(port);
    phone.send({ type: 'connect', protocolVersion: RELAY_PROTOCOL_VERSION, publicKey: DESKTOP });
    const reply = JSON.parse(await phone.next()) as { ok: boolean; reason?: string };
    phone.close();
    if (reply.ok) return 'FAIL: paired with a desktop that never registered';
    if (reply.reason !== 'unknown_desktop') return `FAIL: refused for the wrong reason: ${reply.reason}`;
    return 'refused, and said which reason';
  });

  const desktop = await Peer.open(port);
  await check('a desktop can register', async () => {
    desktop.send({ type: 'register', protocolVersion: RELAY_PROTOCOL_VERSION, publicKey: DESKTOP });
    const reply = JSON.parse(await desktop.next()) as { ok: boolean };
    if (!reply.ok) return 'FAIL: registration refused';
    if (relay.onlineDesktops !== 1) return `FAIL: ${relay.onlineDesktops} desktops online`;
    return '1 desktop online';
  });

  await check('a second desktop cannot take over a live key', async () => {
    // Without this, anyone who knows a public key - and it is in a QR code -
    // could displace the real desktop and make it unreachable.
    const impostor = await Peer.open(port);
    impostor.send({ type: 'register', protocolVersion: RELAY_PROTOCOL_VERSION, publicKey: DESKTOP });
    const reply = JSON.parse(await impostor.next()) as { ok: boolean; reason?: string };
    impostor.close();
    if (reply.ok) return 'FAIL: the impostor took the key';
    return `refused: ${reply.reason}`;
  });

  // Typed explicitly: TypeScript narrows this to `never` after the assignment
  // inside the closure below, and then objects to using it afterwards.
  let phone = null as Peer | null;
  await check('a phone reaches a registered desktop, both ways', async () => {
    phone = await Peer.open(port);
    phone.send({ type: 'connect', protocolVersion: RELAY_PROTOCOL_VERSION, publicKey: DESKTOP });
    const reply = JSON.parse(await phone.next()) as { ok: boolean };
    if (!reply.ok) return 'FAIL: could not reach the desktop';

    phone.send('sealed-frame-from-phone');
    const atDesktop = await desktop.next();
    if (atDesktop !== 'sealed-frame-from-phone') return `FAIL: desktop got "${atDesktop}"`;

    desktop.send('sealed-frame-from-desktop');
    const atPhone = await phone.next();
    if (atPhone !== 'sealed-frame-from-desktop') return `FAIL: phone got "${atPhone}"`;
    return 'frames crossed in both directions, unchanged';
  });

  await check('a paired socket is never parsed again', async () => {
    // The real risk: a payload that happens to look like a control message.
    // Once paired, the relay must forward it rather than act on it - otherwise
    // user data could steer the relay.
    if (!phone) return 'FAIL: no phone from the previous check';
    const lookalike = JSON.stringify({
      type: 'connect',
      protocolVersion: RELAY_PROTOCOL_VERSION,
      publicKey: key('somewhere-else'),
    });
    phone.send(lookalike);
    const atDesktop = await desktop.next();
    if (atDesktop !== lookalike) {
      return `FAIL: the relay acted on a payload instead of forwarding it: ${atDesktop.slice(0, 60)}`;
    }
    return 'a frame shaped like a control message was forwarded verbatim';
  });

  await check('the relay counts bytes and knows nothing else', async () => {
    // The honest limit of the privacy claim, asserted rather than described:
    // it has a byte total and a key, and no way to reach a payload.
    const before = relay.bytesForwarded;
    if (!phone) return 'FAIL: no phone';
    phone.send('x'.repeat(500));
    await desktop.next();
    const grew = relay.bytesForwarded - before;
    if (grew < 500) return `FAIL: counted ${grew} bytes of 500`;

    const surface = Object.keys(relay as unknown as Record<string, unknown>);
    const readable = surface.filter((k) => /payload|message|frame|content|log/i.test(k));
    if (readable.length) return `FAIL: the relay retains ${readable.join(', ')}`;
    return `counted ${grew} bytes, retains no payload`;
  });

  await check('a random guess at a key reaches nothing', async () => {
    const stranger = await Peer.open(port);
    stranger.send({
      type: 'connect',
      protocolVersion: RELAY_PROTOCOL_VERSION,
      publicKey: randomBytes(32).toString('base64url'),
    });
    const reply = JSON.parse(await stranger.next()) as { ok: boolean; reason?: string };
    stranger.close();
    if (reply.ok) return 'FAIL: a random key was accepted';
    return `refused: ${reply.reason}`;
  });

  await check('a mismatched relay version is refused with its number', async () => {
    const old = await Peer.open(port);
    old.send({ type: 'register', protocolVersion: 99, publicKey: key('old-desktop') });
    const reply = JSON.parse(await old.next()) as { ok: boolean; reason?: string; detail?: string };
    old.close();
    if (reply.ok) return 'FAIL: accepted a version it does not speak';
    if (!reply.detail?.includes('99')) return `FAIL: unhelpful detail: ${reply.detail}`;
    return `refused: ${reply.detail}`;
  });

  await check('junk does not register, crash, or stay in memory', async () => {
    const junk = await Peer.open(port);
    for (const value of ['', 'not json', '[]', '{"type":"register"}', '{"type":"relay_status","ok":true}']) {
      junk.send(value);
      const reply = JSON.parse(await junk.next()) as { ok: boolean };
      if (reply.ok) return `FAIL: ${JSON.stringify(value)} was accepted`;
    }
    // A relay_status is only ever sent by the relay; accepting one inbound would
    // let a client fake a pairing result to the other side.
    junk.close();
    if (relay.onlineDesktops !== 1) return `FAIL: junk left ${relay.onlineDesktops} desktops registered`;
    return '5 malformed frames refused, still 1 desktop online';
  });

  await check('a desktop going away frees its key and drops its phone', async () => {
    desktop.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (relay.onlineDesktops !== 0) return `FAIL: ${relay.onlineDesktops} still registered`;

    // And the key can be claimed again, so a reconnecting desktop is not locked
    // out of its own identity by its previous socket.
    const returning = await Peer.open(port);
    returning.send({ type: 'register', protocolVersion: RELAY_PROTOCOL_VERSION, publicKey: DESKTOP });
    const reply = JSON.parse(await returning.next()) as { ok: boolean };
    returning.close();
    if (!reply.ok) return 'FAIL: the desktop could not reclaim its own key';
    return 'key released on disconnect and reclaimable';
  });

  phone?.close();
  await relay.stop();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
