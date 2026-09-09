/**
 * Attacks the secure channel.
 *
 *   npm --prefix packages/secure-channel run try
 *
 * A round-trip test proves almost nothing about encryption: the failure modes
 * that matter are all cases where something *should* have been rejected and was
 * not. So these checks are mostly attempts to break it - tamper with the
 * ciphertext, replay a message, reflect one back, substitute a key, forge a
 * counter - and each passes only if the channel refuses.
 *
 * Costs nothing to run.
 */
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  fingerprint,
  fromBase64Url,
  generateIdentity,
  SecureChannel,
  toBase64Url,
  type Envelope,
  type RandomBytes,
} from './index';

/** Node's CSPRNG. The phone will supply its own; that is the point of injecting it. */
const random: RandomBytes = (length) => webcrypto.getRandomValues(new Uint8Array(length));

let failures = 0;

function check(name: string, run: () => string): void {
  try {
    const detail = run();
    const bad = detail.startsWith('FAIL');
    if (bad) failures += 1;
    console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(`  x ${name}\n      threw unexpectedly: ${String(error)}`);
  }
}

/** Did this throw? Used where refusing is the correct behaviour. */
function refused(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A paired desktop and phone sharing a salt, as they would after a QR scan. */
function pair(salt = 'pairing-token-abc') {
  const desktop = generateIdentity(random);
  const phone = generateIdentity(random);
  return {
    desktop,
    phone,
    desktopChannel: new SecureChannel('desktop', desktop.privateKey, phone.publicKey, salt, random),
    phoneChannel: new SecureChannel('phone', phone.privateKey, desktop.publicKey, salt, random),
  };
}

console.log('\nsecure channel, under attack\n');

check('a message survives the round trip in both directions', () => {
  const { desktopChannel, phoneChannel } = pair();
  const toPhone = 'the agent read README.md';
  const toDesktop = JSON.stringify({ type: 'start_run', prompt: 'what is this?' });

  if (phoneChannel.open(desktopChannel.seal(toPhone)) !== toPhone) return 'FAIL: desktop to phone';
  if (desktopChannel.open(phoneChannel.seal(toDesktop)) !== toDesktop) return 'FAIL: phone to desktop';
  return 'both directions, and neither side needed the other to share a private key';
});

check('nothing readable appears on the wire', () => {
  const { desktopChannel } = pair();
  const secret = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI';
  const envelope = desktopChannel.seal(secret);
  const wire = JSON.stringify(envelope);
  if (wire.includes('AWS') || wire.includes('wJalr')) return 'FAIL: plaintext visible on the wire';
  if (wire.includes(secret)) return 'FAIL: the secret is right there';
  return `${secret.length} chars became ${envelope.c.length} of ciphertext with nothing recognisable`;
});

check('a tampered ciphertext is refused, not silently altered', () => {
  const { desktopChannel, phoneChannel } = pair();
  const envelope = desktopChannel.seal('transfer 100 to alice');

  // Flip one bit in the middle of the ciphertext.
  const bytes = fromBase64Url(envelope.c);
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  const tampered: Envelope = { ...envelope, c: toBase64Url(bytes) };

  const message = refused(() => phoneChannel.open(tampered));
  return message ? `refused: ${message.slice(0, 60)}` : 'FAIL: accepted a modified message';
});

check('a tampered counter is refused, because it is authenticated', () => {
  const { desktopChannel, phoneChannel } = pair();
  const first = desktopChannel.seal('one');
  const second = desktopChannel.seal('two');
  phoneChannel.open(first);

  // Re-label the second message as a much later one. If the counter were not
  // authenticated this would pass and quietly desynchronise the replay window.
  const message = refused(() => phoneChannel.open({ ...second, n: 500 }));
  return message ? `refused: ${message.slice(0, 60)}` : 'FAIL: accepted a re-labelled counter';
});

check('a replayed message is refused', () => {
  const { desktopChannel, phoneChannel } = pair();
  const envelope = desktopChannel.seal('run the deploy');
  phoneChannel.open(envelope);

  const message = refused(() => phoneChannel.open(envelope));
  if (!message) return 'FAIL: the same message was accepted twice';
  if (!/replay/i.test(message)) return `FAIL: refused for the wrong reason: ${message}`;
  return `refused: ${message.slice(0, 70)}`;
});

check('a message reflected back at its sender is refused', () => {
  const { desktopChannel } = pair();
  // Capture what the desktop sent and feed it back to the desktop. With one
  // shared key this would decrypt happily; separate per-direction keys make it
  // impossible rather than merely detectable.
  const envelope = desktopChannel.seal('stop the run');
  const message = refused(() => desktopChannel.open(envelope));
  return message ? `refused: ${message.slice(0, 60)}` : 'FAIL: a reflected message decrypted';
});

check('a machine in the middle with its own key cannot read anything', () => {
  const salt = 'pairing-token-abc';
  const desktop = generateIdentity(random);
  const phone = generateIdentity(random);
  const attacker = generateIdentity(random);

  const real = new SecureChannel('desktop', desktop.privateKey, phone.publicKey, salt, random);
  // The attacker sits on the socket and substitutes its own key. It cannot also
  // substitute the key on the desktop's screen, which is where the phone got it.
  const impostor = new SecureChannel('phone', attacker.privateKey, desktop.publicKey, salt, random);

  const message = refused(() => impostor.open(real.seal('the whole repository')));
  return message ? `refused: ${message.slice(0, 60)}` : 'FAIL: an attacker key decrypted traffic';
});

check('a different pairing token yields different keys', () => {
  const desktop = generateIdentity(random);
  const phone = generateIdentity(random);
  const first = new SecureChannel('desktop', desktop.privateKey, phone.publicKey, 'token-one', random);
  const second = new SecureChannel('phone', phone.privateKey, desktop.publicKey, 'token-two', random);

  // Same two identities, different session. Traffic from one session must not
  // decrypt in another, so a captured session cannot be replayed into a later one.
  const message = refused(() => second.open(first.seal('same keys, different session')));
  return message
    ? `refused: sessions are isolated by the pairing token`
    : 'FAIL: a captured session decrypted in a later one';
});

check('nonces do not repeat', () => {
  const { desktopChannel } = pair();
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i += 1) seen.add(desktopChannel.seal(`message ${i}`).iv);
  return seen.size === 2000
    ? '2000 messages, 2000 distinct nonces'
    : `FAIL: only ${seen.size} distinct nonces in 2000 messages`;
});

check('out-of-order delivery is refused rather than reordered', () => {
  const { desktopChannel, phoneChannel } = pair();
  const first = desktopChannel.seal('first');
  const second = desktopChannel.seal('second');

  phoneChannel.open(second);
  // A transport that reorders would hand these over backwards. Refusing is the
  // right answer for a WebSocket, which guarantees order - out of order means
  // something is interfering.
  const message = refused(() => phoneChannel.open(first));
  return message ? 'refused, since a WebSocket never reorders on its own' : 'FAIL: accepted';
});

check('malformed input is refused with a reason, not a crash', () => {
  const { desktopChannel, phoneChannel } = pair();
  const good = desktopChannel.seal('fine');
  const cases: [string, Envelope][] = [
    ['bad base64', { ...good, c: 'not base64!!' }],
    ['short nonce', { ...good, iv: toBase64Url(new Uint8Array(8)) }],
    ['negative counter', { ...good, n: -1 }],
    ['fractional counter', { ...good, n: 1.5 }],
    ['empty ciphertext', { ...good, c: '' }],
  ];
  for (const [label, envelope] of cases) {
    if (!refused(() => phoneChannel.open(envelope))) return `FAIL: accepted ${label}`;
  }
  return `${cases.length} malformed envelopes refused, each with a message`;
});

check('base64url survives every byte value', () => {
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) all[i] = i;
  const back = fromBase64Url(toBase64Url(all));
  if (back.length !== 256) return `FAIL: ${back.length} bytes back from 256`;
  for (let i = 0; i < 256; i += 1) if (back[i] !== i) return `FAIL: byte ${i} became ${back[i]}`;

  // Lengths either side of the 3-byte grouping, where hand-rolled base64 breaks.
  for (const length of [0, 1, 2, 3, 4, 5, 23, 24, 31, 32]) {
    const bytes = random(length);
    const round = fromBase64Url(toBase64Url(bytes));
    if (round.length !== length) return `FAIL: length ${length} came back as ${round.length}`;
    for (let i = 0; i < length; i += 1) {
      if (round[i] !== bytes[i]) return `FAIL: mismatch at ${i} for length ${length}`;
    }
  }
  return 'all 256 byte values and ten awkward lengths round-trip exactly';
});

check('a fingerprint is stable, short, and differs between keys', () => {
  const a = generateIdentity(random);
  const b = generateIdentity(random);
  const first = fingerprint(a.publicKey);
  if (first !== fingerprint(a.publicKey)) return 'FAIL: not stable';
  if (first === fingerprint(b.publicKey)) return 'FAIL: two keys share a fingerprint';
  if (first.length > 14) return `FAIL: "${first}" is too long to read aloud`;
  return `"${first}" - readable, stable, and distinct`;
});

check('the library itself depends on nothing platform-specific', () => {
  // The whole point of hand-rolling base64 and injecting randomness was that
  // this code has to run inside React Native. A stray `node:` import or a
  // Buffer would typecheck here, pass every test above, and fail only on the
  // phone - so the guarantee is checked rather than trusted.
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const forbidden = [
    ['a node: import', /from 'node:/],
    ['Buffer', /Buffer/],
    ['a bare crypto global', /crypto\.(getRandomValues|randomBytes)/],
    ['btoa or atob', /(btoa|atob)\(/],
  ] as const;

  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) return `FAIL: index.ts uses ${label}, which the phone may not have`;
  }
  return 'no node imports, no Buffer, no platform encoders, no global randomness';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
