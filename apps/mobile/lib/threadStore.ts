import { Directory, File, Paths } from 'expo-file-system';

import { type PersistedWorkspace, revive, shrink } from './threadShrink';

/**
 * Where the phone keeps its conversations.
 *
 * Until now a thread lived only in React state, so force-quitting the app
 * threw away every archived conversation — including the ones deliberately set
 * aside rather than discarded. That made "starting a new conversation archives
 * the old one" a promise the app could not keep past a single launch.
 *
 * Deliberately NOT the Keychain, which is for credentials and caps items at a
 * couple of kilobytes; conversation text is far larger and not a secret in the
 * same sense as a session token. `expo-file-system` ships inside `expo` itself
 * on SDK 57, so this needs no new native build.
 *
 * Everything here fails quietly. Losing history is a disappointment; crashing
 * on launch because a JSON file went bad is a broken app.
 */
const FILE = 'threads.v1.json';

export type { PersistedWorkspace };

function target(): File {
  return new File(new Directory(Paths.document), FILE);
}

export async function loadWorkspace(): Promise<PersistedWorkspace | null> {
  try {
    const file = target();
    if (!file.exists) return null;
    return revive(JSON.parse(await file.text()));
  } catch {
    // Unreadable, unparseable, or a filesystem that said no. Starting with no
    // history is always safe; throwing during launch is not.
    return null;
  }
}

export async function saveWorkspace(
  state: Omit<PersistedWorkspace, 'savedAt'>,
): Promise<void> {
  try {
    const file = target();
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(shrink(state)));
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
 */
export async function clearWorkspace(): Promise<void> {
  try {
    const file = target();
    if (file.exists) file.delete();
  } catch {
    // Nothing useful to do; the next save overwrites it anyway.
  }
}
