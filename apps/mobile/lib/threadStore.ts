import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { phoneRandom } from './random';
import { type PersistedWorkspace, revive, shrink, type WorkspaceToSave } from './threadShrink';
import { decodeKey, encodeKey, newVaultKey, open, seal } from './threadVault';

/**
 * Where the phone keeps its conversations.
 *
 * Until now a thread lived only in React state, so force-quitting the app
 * threw away every archived conversation — including the ones deliberately set
 * aside rather than discarded. That made "starting a new conversation archives
 * the old one" a promise the app could not keep past a single launch.
 *
 * The transcript itself is deliberately NOT in the Keychain, which is for
 * credentials and caps items at a couple of kilobytes; conversation text is far
 * larger. `expo-file-system` ships inside `expo` itself on SDK 57, so this needs
 * no new native build.
 *
 * **The file is encrypted, because `Paths.document` is backed up.** iOS includes
 * that directory in iCloud and iTunes backups, and transcripts quote the
 * repository, so plaintext here meant source code leaving the phone through a
 * path nobody chose. `Paths.cache` is not backed up but is documented as
 * deletable under storage pressure, which would reintroduce exactly the loss
 * this file exists to prevent. So the ciphertext stays where it survives and the
 * key goes in the Keychain device-only, which is itself excluded from backups.
 * See [[threadVault]] for what that does and does not protect.
 *
 * Everything here fails quietly. Losing history is a disappointment; crashing
 * on launch because a JSON file went bad is a broken app.
 */
const FILE = 'threads.v2.enc';

/**
 * The plaintext file this replaces.
 *
 * Kept readable so an upgrade does not silently discard the conversations
 * already on the phone, and deleted the moment an encrypted file exists to
 * replace it - leaving it behind would defeat the whole change, since it is the
 * plaintext copy that the backup picks up.
 */
const LEGACY_FILE = 'threads.v1.json';

const KEY_ENTRY = 'axune.threads.key';

export type { PersistedWorkspace };

function target(): File {
  return new File(new Directory(Paths.document), FILE);
}

function legacyTarget(): File {
  return new File(new Directory(Paths.document), LEGACY_FILE);
}

/**
 * The key for the thread file, minted once and kept device-only.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is doing the real work: it is what keeps the
 * key out of the backup, which is what makes encrypting the file worth
 * anything. The same accessibility is already used for the pairing record.
 *
 * A key that cannot be read back is replaced rather than repaired. That loses
 * the history, which is the right trade against a launch that fails.
 */
async function vaultKey(): Promise<Uint8Array | null> {
  try {
    const existing = decodeKey(await SecureStore.getItemAsync(KEY_ENTRY));
    if (existing) return existing;

    const minted = newVaultKey(phoneRandom);
    await SecureStore.setItemAsync(KEY_ENTRY, encodeKey(minted), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return minted;
  } catch {
    // No Keychain access means no safe place for the key, and writing the
    // transcript unencrypted instead would quietly undo the point of this file.
    return null;
  }
}

export async function loadWorkspace(): Promise<PersistedWorkspace | null> {
  try {
    const key = await vaultKey();
    if (key) {
      const file = target();
      if (file.exists) {
        const plaintext = open(await file.text(), key);
        // A null here is a damaged envelope or a key that no longer matches.
        // Falling through to the legacy file is right: it may still be there.
        if (plaintext) return revive(JSON.parse(plaintext));
      }
    }

    // Upgrade path. The plaintext copy is not deleted here - only once an
    // encrypted file has been written successfully, so a crash between the two
    // loses nothing.
    const legacy = legacyTarget();
    if (legacy.exists) return revive(JSON.parse(await legacy.text()));

    return null;
  } catch {
    // Unreadable, unparseable, or a filesystem that said no. Starting with no
    // history is always safe; throwing during launch is not.
    return null;
  }
}

export async function saveWorkspace(
  state: WorkspaceToSave,
): Promise<void> {
  try {
    const key = await vaultKey();
    // Without a key there is nowhere safe to put this. Keeping the previous
    // file is better than replacing it with plaintext.
    if (!key) return;

    const file = target();
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    file.write(seal(JSON.stringify(shrink(state)), key, phoneRandom));

    // Only now, with the encrypted copy definitely on disk.
    const legacy = legacyTarget();
    if (legacy.exists) legacy.delete();
  } catch {
    // Out of space, a sandbox refusal, or a shape that would not serialise.
    // What the user is looking at lives in memory and is unaffected.
  }
}

/**
 * Forget every stored conversation.
 *
 * Called when the phone forgets its desktop. Transcripts quote the repository,
 * so leaving them on the device after a deliberate disconnect would be the
 * wrong default.
 *
 * The key goes too. Without it the ciphertext is unreadable even if a copy
 * survives somewhere this cannot reach - an old backup, most obviously.
 */
export async function clearWorkspace(): Promise<void> {
  try {
    const file = target();
    if (file.exists) file.delete();
    const legacy = legacyTarget();
    if (legacy.exists) legacy.delete();
  } catch {
    // Nothing useful to do; the next save overwrites it anyway.
  }

  try {
    await SecureStore.deleteItemAsync(KEY_ENTRY);
  } catch {
    // A key with nothing left to open is harmless.
  }
}
