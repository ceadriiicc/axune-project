/**
 * The only thing the relay is allowed to understand.
 *
 * ## The whole design in one paragraph
 *
 * A relay exists so a phone can reach a desktop that is not on its network. It
 * is a byte-forwarder and nothing else: it learns which two sockets belong
 * together and then copies frames between them without looking inside. The
 * encryption that makes that safe already exists - keys are agreed end to end
 * and the phone pins the desktop's public key from the QR code - so a relay
 * operator, including Cedric, forwards ciphertext it cannot read. That is a
 * property of the construction rather than a promise about conduct.
 *
 * ## Why the join messages are plaintext, deliberately
 *
 * Something has to be readable or the relay cannot tell which socket to pair
 * with which. These three messages are that minimum and are kept as small as
 * they can be: a public key, which is already public by definition - it travels
 * in a QR code shown on a screen - and nothing else. No tokens, no session
 * material, no project names, no addresses.
 *
 * After a pairing exists, **no frame is ever parsed again**. The relay does not
 * know when a run starts, what an agent read, or whether anyone is talking. It
 * sees two sockets and a byte count.
 *
 * ## What a relay operator can still learn
 *
 * Stated plainly, because "it cannot read your code" is often used to imply
 * more than it means. An operator sees: which desktop key is online, when, for
 * how long, which phones connect to it, and how many bytes flow. That is a
 * connection graph and an activity schedule. It is not nothing, and it is the
 * honest cost of not being on the same Wi-Fi.
 */

/** Bumped when these three messages change shape. Independent of the phone/desktop protocol. */
export const RELAY_PROTOCOL_VERSION = 1;

/**
 * Sent by a desktop to say "I am here, under this key".
 *
 * The key is the desktop's long-term X25519 public key, base64url, exactly as
 * it appears in the pairing QR. Using the same identity means a phone that has
 * paired already knows which key to ask for, with nothing new to store.
 */
export interface RelayRegister {
  type: 'register';
  protocolVersion: number;
  publicKey: string;
}

/** Sent by a phone to say "connect me to the desktop holding this key". */
export interface RelayConnect {
  type: 'connect';
  protocolVersion: number;
  publicKey: string;
}

/**
 * The relay's only reply, and the only message it ever originates.
 *
 * `ok` false carries a reason. A relay that refuses in silence would leave a
 * phone waiting for a desktop that is not there, which is the failure this
 * project has now met six times in other guises.
 */
export interface RelayStatus {
  type: 'relay_status';
  ok: boolean;
  reason?: 'unknown_desktop' | 'version_mismatch' | 'malformed' | 'busy';
  detail?: string;
}

export type RelayMessage = RelayRegister | RelayConnect | RelayStatus;

/**
 * Is this frame one of ours, or opaque payload to be forwarded untouched?
 *
 * Total, and biased towards "not mine". Anything unparseable, anything without
 * one of the three known types, is payload - because treating a sealed frame as
 * a control message is the one mistake that could make the relay act on user
 * data.
 */
export function parseRelayMessage(raw: string): RelayRegister | RelayConnect | null {
  if (raw.length > 4096) return null; // A join message is tiny; a sealed frame is not.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const type = record['type'];
  if (type !== 'register' && type !== 'connect' && type !== 'relay_status') return null;

  if (type === 'relay_status') return null; // Only the relay sends these; never accept one inbound.

  const publicKey = record['publicKey'];
  const protocolVersion = record['protocolVersion'];
  if (typeof publicKey !== 'string' || !publicKey) return null;
  // Base64url of a 32-byte key is 43 characters. Checked so a client cannot
  // register under a megabyte of junk and sit in the map.
  if (publicKey.length > 64 || !/^[A-Za-z0-9_-]+$/.test(publicKey)) return null;
  if (typeof protocolVersion !== 'number') return null;

  return { type, publicKey, protocolVersion } as RelayRegister | RelayConnect;
}
