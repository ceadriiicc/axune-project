import type { GitSnapshot } from '@axune/protocol';

/**
 * What actually deserves attention, in the order it would hurt.
 *
 * Every line is derived from the git snapshot the desktop already sends.
 * Returning null when the repository is quiet is the point: a card that always
 * has something urgent to report teaches people to ignore it, which is worse
 * than not having it.
 *
 * The demo's version of this card was two fixed sentences about a rebase and
 * two conflicts. They happened to match the fixture beneath them and would have
 * diverged the instant real data arrived.
 *
 * Returns a palette *key* rather than a colour so this stays free of React
 * Native and can be tested under Node.
 */
export interface NextAdvice {
  title: string;
  body: string;
  /** An Ionicons glyph name. */
  icon: string;
  /** A key of the palette, resolved by the screen. */
  tone: 'danger' | 'claudeStrong' | 'info';
}

export function nextAdvice(git: GitSnapshot | undefined): NextAdvice | null {
  if (!git) return null;

  // Ordered by what stops you working, not by what is most common.
  if (git.conflicts > 0) {
    return {
      title: 'Resolve the conflicts before your next write run.',
      body: `${git.conflicts} ${git.conflicts === 1 ? 'conflict is' : 'conflicts are'} waiting in this repository.`,
      icon: 'git-merge-outline',
      tone: 'danger',
    };
  }

  if (git.inProgress) {
    return {
      title: `A ${git.inProgress} is in progress.`,
      body: 'Finish or abort it before starting a write run.',
      icon: 'git-branch-outline',
      tone: 'danger',
    };
  }

  if (git.detachedHead) {
    // A write run here produces commits on no branch, which is the easiest way
    // to lose an agent's work without anything reporting an error.
    return {
      title: 'This repository is on a detached HEAD.',
      body: 'Work done here is not on any branch. Check out a branch before a write run.',
      icon: 'alert-circle-outline',
      tone: 'danger',
    };
  }

  if (git.behind && git.behind > 0) {
    return {
      title: 'Your branch is behind its upstream.',
      body: `${git.behind} ${git.behind === 1 ? 'commit' : 'commits'} arrived while you were away.`,
      icon: 'arrow-down-outline',
      tone: 'info',
    };
  }

  if (git.ahead && git.ahead > 0) {
    return {
      title: 'You have work that is not pushed.',
      body: `${git.ahead} ${git.ahead === 1 ? 'commit' : 'commits'} only exist on this machine.`,
      icon: 'cloud-upload-outline',
      tone: 'claudeStrong',
    };
  }

  return null;
}
