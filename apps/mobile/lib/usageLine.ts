import { isIdleStart } from '@axune/protocol';
import type { RunUsage } from '@axune/protocol';

/**
 * What a turn cost, in words a person can act on.
 *
 * ## Why this is not a straight render of `RunUsage`
 *
 * The provider reports four token counts and a dollar figure. Shown raw they
 * are close to meaningless: nobody knows whether 43,000 tokens is a lot, and
 * "cache read" is jargon for the one fact that matters - that most of a turn
 * was not re-sent.
 *
 * Measured on this project, a conversation costs about $0.073 for its first
 * turn and $0.022 from the third on, because the repository the agent read is
 * reused rather than sent again. The whole point of showing anything is to make
 * that difference visible, so the split here is `reused` against `fresh`.
 *
 * ## The cold-start claim is held to two signals, not one
 *
 * Low reuse alone does not mean the cache went cold. A run that reads twenty
 * files legitimately sends a great deal of new material, and calling that a
 * cold start would be wrong in the direction that makes someone distrust the
 * number. So `idle` is only claimed when reuse was low *and* enough time passed
 * since the previous turn for the provider's cache to have expired. With one
 * signal the counts are still shown; only the explanation is withheld.
 *
 * Nothing here implies a share of a plan's limit. That is not knowable from
 * anything the provider reports, and inventing it would be worse than omitting
 * it - see `UsageLedger` on the desktop, which refuses the same thing.
 */
export interface UsageLine {
  /** Everything the turn carried: sent fresh plus reused. */
  tokens: number;
  /** Read back from the provider's cache, costing a fraction of fresh tokens. */
  reused: number;
  /** Sent and paid for at full rate this turn. */
  fresh: number;
  /**
   * Reuse was low and the gap since the previous turn was long enough to
   * explain it. Both, deliberately - see above.
   */
  idle: boolean;
  /**
   * What this would cost at published API rates. A subscription is not billed
   * per run, so every caller must render it as an approximation and never as a
   * charge that will appear on a statement.
   */
  costUsd: number | null;
  /** Ready to render: "43.2k tokens · 42 sent fresh · ~$0.02 of API equivalent". */
  text: string;
}


export function describeUsage(usage: RunUsage, msSincePreviousRun: number | null): UsageLine {
  const reused = usage.cacheReadTokens;
  const fresh = usage.inputTokens + usage.cacheCreationTokens;
  const tokens = reused + fresh + usage.outputTokens;

  return {
    tokens,
    reused,
    fresh,
    // The shared rule, not a second copy of it: the desktop counts these for a
    // day's total and a divergence here would show two different numbers for
    // the same runs with nothing to say which was right.
    idle: isIdleStart(usage, msSincePreviousRun),
    costUsd: usage.costUsd,
    text: [
      `${compact(tokens)} tokens`,
      // What was sent fresh, rather than what was reused. Both describe the
      // same split, but this is the number that actually moves - 5.4k on a
      // first turn against 42 on a fourth - so it is the one that shows a
      // follow-up costing almost nothing.
      reused > 0 ? `${compact(fresh)} sent fresh` : 'all sent fresh',
      approxCost(usage.costUsd),
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
  };
}

/** 43,115 reads as 43.1k. Exact below a thousand, where the digits still mean something. */
export function compact(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count < 1_000) return String(count);
  const thousands = count / 1_000;
  return thousands < 100 ? `${thousands.toFixed(1)}k` : `${Math.round(thousands)}k`;
}

/**
 * Cost as an approximation, never as a bill.
 *
 * Kept here rather than inline at each call site so that the leading "≈" cannot
 * be dropped by one of them. Axune handles no billing relationship and cannot
 * see a plan, so a bare dollar figure would assert something it does not know.
 */
export function approxCost(costUsd: number | null): string | null {
  if (costUsd === null) return null;
  const amount = costUsd < 0.01 ? '0.01' : costUsd.toFixed(2);
  // "of API equivalent" is load-bearing, not padding: a subscription is not
  // billed per run, and a bare dollar figure would assert a charge that will
  // never appear on a statement.
  return `≈$${amount} of API equivalent`;
}
