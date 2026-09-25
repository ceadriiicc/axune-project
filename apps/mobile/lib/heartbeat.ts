/**
 * Whether the connection is still real, decided without a socket.
 *
 * ## Why this is not just a `setInterval` in the client
 *
 * A closed TCP socket reports itself. A *dead* one does not. A laptop that
 * sleeps, a Wi-Fi network that drops, a machine that moves subnet - none of
 * these produce a close event on the phone. The socket sits there looking open,
 * the UI says "connected", and the first anyone learns of it is a prompt that
 * goes nowhere.
 *
 * That is the same fault as a run that said "failed" with no reason, or a
 * thread list that could only be reached by archiving what you were reading: a
 * status claiming more than it has verified. It is also the hardest kind to
 * test, because reproducing it needs a network that lies. Kept here as a pure
 * decision over four numbers so the lying network is a test fixture instead.
 */

/** How often to ask, and the longest a line may be quiet before asking. */
export const IDLE_PING_MS = 15_000;

/**
 * How long a ping may go unanswered before the connection is treated as dead.
 *
 * Generous on purpose. Being wrong costs a reconnect nobody sees; being too
 * eager churns the socket on a merely busy network, which is worse because it
 * happens constantly and looks like instability.
 */
export const PONG_TIMEOUT_MS = 10_000;

export interface LinkState {
  now: number;
  /** When anything last arrived from the desktop. */
  lastMessageAt: number;
  /** When the outstanding ping was sent, or null if none is. */
  pingedAt: number | null;
  /** Whether there is a socket in the open state at all. */
  socketOpen: boolean;
}

export type HeartbeatAction =
  /** Say nothing. The line is busy, or a ping is still within its grace. */
  | 'wait'
  /** The line has been quiet. Ask. */
  | 'ping'
  /** A ping went unanswered past the deadline. Close and reconnect. */
  | 'declare-dead';

export function decideHeartbeat(state: LinkState): HeartbeatAction {
  // Nothing to declare dead: a socket that is already gone has been reported
  // by its own close handler, and saying so twice would reconnect twice.
  if (!state.socketOpen) return 'wait';

  if (state.pingedAt !== null) {
    return state.now - state.pingedAt >= PONG_TIMEOUT_MS ? 'declare-dead' : 'wait';
  }

  // Traffic is its own proof of life. A streaming run answers this question
  // several times a second, and pinging through it is wasted radio.
  return state.now - state.lastMessageAt >= IDLE_PING_MS ? 'ping' : 'wait';
}
