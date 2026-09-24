/**
 * Run a relay.
 *
 *   npm --prefix packages/relay run serve            # 127.0.0.1:8791
 *   PORT=8080 npm --prefix packages/relay run serve  # anywhere else
 *
 * Deliberately tiny and deliberately stateless. Everything it knows dies with
 * the process, which is the property that makes it safe to run somewhere you do
 * not fully control: a relay that stores nothing cannot leak what it stored.
 *
 * The status line prints how many desktops are online and how many bytes have
 * crossed. That is the entire operational picture, and it is all an operator
 * gets - there is no view of who, no view of what, and nothing on disk.
 */
import { RelayServer } from './RelayServer';

const port = Number(process.env['PORT'] ?? 8791);
const relay = new RelayServer();

const started = Date.now();

async function main(): Promise<void> {
  const bound = await relay.start(port);
  console.log(`axune relay listening on :${bound}`);
  console.log('forwards sealed frames; cannot read them; stores nothing.\n');

  // A heartbeat rather than a log of events: logging connections would build
  // exactly the record this design exists to avoid.
  setInterval(() => {
    const minutes = Math.floor((Date.now() - started) / 60000);
    console.log(
      `[${minutes}m] ${relay.onlineDesktops} desktop(s) online · ${(relay.bytesForwarded / 1024).toFixed(0)} KB forwarded`,
    );
  }, 60_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void relay.stop().then(() => process.exit(0));
  });
}

void main();
