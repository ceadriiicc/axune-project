/** Attack checks for the encrypted socket boundary; no agent is invoked. */
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import {
  fromBase64Url,
  generateIdentity,
  SecureChannel,
  toBase64Url,
} from "@axune/secure-channel";
import { PROTOCOL_VERSION } from "@axune/protocol";
import { AxuneServer } from "./core/AxuneServer";
import { PairingManager } from "./core/PairingManager";

const random = (n: number) => new Uint8Array(randomBytes(n));
const pairing = new PairingManager();
const server = new AxuneServer(pairing, {
  name: "test",
  path: process.cwd(),
  branch: "main",
  isGitRepo: false,
});
const port = await server.start(0);
const qr = pairing.issue(port, "test");
const phone = generateIdentity(random);
const raw: string[] = [];
const socket = await new Promise<WebSocket>((resolve, reject) => {
  const s = new WebSocket(`ws://127.0.0.1:${port}`);
  s.once("open", () => resolve(s));
  s.once("error", reject);
});
const clientNonce = toBase64Url(random(32));
socket.on("message", (data) => raw.push(String(data)));
socket.send(
  JSON.stringify({
    type: "secure_hello",
    protocolVersion: PROTOCOL_VERSION,
    phonePublicKey: toBase64Url(phone.publicKey),
    clientNonce,
  }),
);
await waitFor(raw, "secure_welcome");
const welcome = JSON.parse(raw[0]!) as { serverNonce: string };
const channel = new SecureChannel(
  "phone",
  phone.privateKey,
  fromBase64Url(qr.desktopPublicKey),
  `${qr.token}:${clientNonce}:${welcome.serverNonce}`,
  random,
);
const secretPrompt = "TOP_SECRET_PROMPT_9bdb1";
const first = channel.seal(
  JSON.stringify({
    type: "pair",
    token: qr.token,
    deviceName: "attack-test",
    protocolVersion: PROTOCOL_VERSION,
    lastSeenAt: 0,
  }),
);
socket.send(JSON.stringify({ type: "secure_envelope", ...first }));
await waitFor(raw, "secure_envelope");
await new Promise((resolve) => setTimeout(resolve, 100));
if (
  raw.some((frame) => frame.includes(qr.token) || frame.includes(secretPrompt))
)
  throw new Error("plaintext appeared in raw frame");
let paired: { sessionToken: string } | null = null;
for (const frame of raw) {
  if (JSON.parse(frame).type !== "secure_envelope") continue;
  const message = JSON.parse(channel.open(JSON.parse(frame))) as { type: string; sessionToken?: string };
  if (message.type === "paired" && message.sessionToken) paired = { sessionToken: message.sessionToken };
}
if (!paired) throw new Error("pairing did not return a session token");
socket.close();

// A new connection mixes both fresh nonces into the HKDF salt. An envelope
// captured on the first connection therefore cannot authenticate on the next.
const next = new SecureChannel(
  "desktop",
  pairing.identity.privateKey,
  phone.publicKey,
  `${paired.sessionToken}:fresh-client-nonce:fresh-server-nonce`,
  random,
);
let replayRejected = false;
try {
  next.open(first);
} catch {
  replayRejected = true;
}
await server.stop();
if (!replayRejected)
  throw new Error("cross-connection replay was not refused");
console.log(
  "ok: raw frames contain no credential/plaintext; cross-connection replay closed",
);

function waitFor(frames: string[], type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${type}`)),
      3000,
    );
    const check = () => {
      if (frames.some((frame) => JSON.parse(frame).type === type)) {
        clearTimeout(timer);
        resolve();
      } else setTimeout(check, 10);
    };
    check();
  });
}
