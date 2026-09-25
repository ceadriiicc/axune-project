/**
 * Attempts to make the connection lie about being alive.
 *
 *   npm --prefix apps/mobile run try:heartbeat
 *
 * A socket that is dead rather than closed produces no event at all, so the
 * only way to catch it is to ask and notice the silence. These are the ways
 * that goes wrong: asking so eagerly that a busy network looks broken, asking
 * during a run and wasting radio on a question already answered, or declaring a
 * socket dead twice and reconnecting twice.
 */
import { decideHeartbeat, IDLE_PING_MS, PONG_TIMEOUT_MS } from '../lib/heartbeat';

let failures = 0;

function check(name: string, run: () => string): void {
  try {
    const detail = run();
    const bad = detail.startsWith('FAIL');
    if (bad) failures += 1;
    console.log(`  ${bad ? 'x' : 'ok'} ${name}\n      ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(`  x ${name}\n      threw: ${String(error)}`);
  }
}

const NOW = 1_000_000;
const link = (over: Partial<Parameters<typeof decideHeartbeat>[0]> = {}) =>
  decideHeartbeat({ now: NOW, lastMessageAt: NOW, pingedAt: null, socketOpen: true, ...over });

console.log('\nthe connection cannot lie about being alive\n');

check('a streaming run is never interrupted to ask if it is alive', () => {
  // Events arriving several times a second already answer the question.
  if (link({ lastMessageAt: NOW - 200 }) !== 'wait') return 'FAIL: pinged a busy line';
  if (link({ lastMessageAt: NOW - (IDLE_PING_MS - 1) }) !== 'wait') {
    return 'FAIL: pinged before the line was idle';
  }
  return 'silent while traffic is flowing';
});

check('a quiet line gets asked', () => {
  if (link({ lastMessageAt: NOW - IDLE_PING_MS }) !== 'ping') return 'FAIL: stayed silent';
  return `asked after ${IDLE_PING_MS / 1000}s of quiet`;
});

check('it does not ask again while an answer is still owed', () => {
  // Otherwise a slow network collects a queue of pings and the timeout is
  // measured against the wrong one.
  const action = link({ lastMessageAt: NOW - 60_000, pingedAt: NOW - 1_000 });
  if (action !== 'wait') return `FAIL: ${action}`;
  return 'one outstanding ping at a time';
});

check('a slow answer is not mistaken for a dead line', () => {
  const action = link({ pingedAt: NOW - (PONG_TIMEOUT_MS - 1) });
  if (action !== 'wait') return `FAIL: gave up after ${PONG_TIMEOUT_MS - 1}ms`;
  return `waits the full ${PONG_TIMEOUT_MS / 1000}s before giving up`;
});

check('silence past the deadline is called what it is', () => {
  // The whole point. Without this the UI says "connected" until a prompt is
  // sent into a socket nobody is listening to.
  const action = link({ pingedAt: NOW - PONG_TIMEOUT_MS });
  if (action !== 'declare-dead') return `FAIL: ${action}`;
  return 'declared dead, which is what triggers the reconnect';
});

check('a socket already gone is not declared dead a second time', () => {
  // Its own close handler has reported it. Saying so again reconnects twice.
  const action = link({ socketOpen: false, pingedAt: NOW - 10 * PONG_TIMEOUT_MS });
  if (action !== 'wait') return `FAIL: ${action}`;
  return 'a closed socket is somebody else’s news';
});

check('a fresh connection is not immediately suspected', () => {
  // lastMessageAt is set when the heartbeat starts, so t=0 must be quiet.
  if (link() !== 'wait') return 'FAIL: suspected a connection that just opened';
  return 'silent at t=0';
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
