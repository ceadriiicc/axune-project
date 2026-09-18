import type { RandomBytes } from '@axune/secure-channel';
import { getRandomBytes } from 'expo-crypto';

/**
 * The phone's source of randomness.
 *
 * React Native has no `crypto.getRandomValues`: nothing in the installed tree
 * exposes one, which was checked rather than assumed. `expo-crypto` provides
 * `getRandomBytes(byteCount)`, backed by the platform CSPRNG, and its shape is
 * exactly the `RandomBytes` the secure channel takes.
 *
 * `Math.random` was never an option. It is not a CSPRNG, and using it for
 * nonces would be worse than shipping no encryption at all - the link would
 * look encrypted while being trivially breakable, which is the one outcome
 * worse than being visibly in the clear.
 */
export const phoneRandom: RandomBytes = (length) => {
  const bytes = getRandomBytes(length);
  // A short read would silently weaken every key and nonce derived from it.
  // Cheap to check, and the alternative is a failure nobody would ever see.
  if (bytes.length !== length) {
    throw new Error(`expected ${length} random bytes, got ${bytes.length}`);
  }
  return bytes;
};
