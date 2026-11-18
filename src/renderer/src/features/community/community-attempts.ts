/**
 * The composer's submission attempts: ONE KEY PER ATTEMPT for as long as that
 * attempt may still publish (review round 1, M1).
 *
 * WHY THIS EXISTS. The hub's Idempotency-Key contract: a REUSED key replays the
 * first attempt's stored outcome, a NEW key is a new post. The daemon's request
 * budget equals the moderation budget (30 s), and its own note says an answer
 * that outlasts it "is recoverable through the submission status read by its
 * Idempotency-Key". The first cut minted a fresh key on every Send/Retry, so a
 * verdict that landed just after a timeout, followed by Retry, published the
 * same text twice and counted it twice against the sender's limits. Three more
 * roads led to the same place: a status read that failed mid-follow-up, a 502
 * `community_unreachable`, and leaving the conversation while `checking`.
 *
 * THE RULES (the decisions are pure, in `community-model.ts`):
 * - An attempt is PENDING - key plus the exact bytes it carried - from the
 *   moment its key is minted until something settles it.
 * - A hub ANSWER settles it (published, refused, a limit, an outage, stale
 *   guidelines, too large): nothing more can come of that key, and reusing it
 *   would only replay the answer, so the next Send mints a new one.
 * - No answer (`attemptMayBeLive`: deadline, 502, an unreadable reply, a failed
 *   status read) leaves it pending.
 * - The next Send/Retry for that conversation, and returning to it, first asks
 *   `submission.status(pendingKey)` and acts on the answer
 *   (`recoveryAfterStatusRead`): follow a live check, show a stored outcome,
 *   resubmit under the SAME key when the hub never stored it, or - when the
 *   hub cannot be asked - send nothing at all.
 *
 * WHY A PLAIN CLASS, NOT HOOK STATE. The sequence of keys a composer sends is
 * the whole defect, and it is decided across awaits, timers and target
 * switches. Kept out of React, `scripts/community-attempts.test.mjs` drives
 * every road above against a scripted hub and asserts the exact keys sent; the
 * hook (`useCommunityComposer`) only binds it to the current conversation.
 *
 * PENDING ATTEMPTS ARE PER TARGET (community + conversation + thread) and live
 * as long as the controller does: the community home's lifetime, the same as
 * the memory-only drafts they guard.
 */
import {
	type CommunitySubmission,
	communityFailure,
	newCommunityIdempotencyKey,
} from "@shared/api/local-operator/community-api";
import {
	type CommunityDraftBytes,
	type ComposerPhase,
	type PendingAttempt,
	attemptMayBeLive,
	phaseAfterFailure,
	phaseAfterSubmission,
	recoveryAfterStatusRead,
	sameDraftBytes,
} from "./community-model";

/** Everything one conversation's composer binds; rebuilt by the hook per render. */
export type AttemptContext = {
	/** Community + conversation + thread: where a pending attempt is filed. */
	target: string;
	submit: (
		key: string,
		draft: CommunityDraftBytes,
	) => Promise<CommunitySubmission>;
	status: (key: string) => Promise<CommunitySubmission>;
	cancel: (key: string) => Promise<CommunitySubmission>;
	setPhase: (phase: ComposerPhase) => void;
	/** Published: clear THIS target's draft (the id, when the hub returned one). */
	onPublished: (messageId: string | null) => void;
	/** A post may have landed: re-read this conversation's history. */
	onHistoryChanged: () => void;
	/** The hub answered 409 `guidelines_changed` (the home goes read-only). */
	onGuidelinesChanged?: () => void;
};

export type AttemptClock = {
	wait: (ms: number) => Promise<void>;
	now: () => number;
};

const realClock: AttemptClock = {
	wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now(),
};

/** The status-read cadence while a verdict is still `checking`. */
export const FOLLOW_UP_INTERVAL_MS = 2000;

export class CommunityAttempts {
	/** The key whose answers the composer is showing; `null` when idle. */
	private current: string | null = null;
	private readonly pending = new Map<string, PendingAttempt>();
	private readonly clock: AttemptClock;
	private readonly mintKey: () => string;

	constructor(options: { clock?: AttemptClock; mintKey?: () => string } = {}) {
		this.clock = options.clock ?? realClock;
		this.mintKey = options.mintKey ?? newCommunityIdempotencyKey;
	}

	/** The attempt that may still publish in this target, if any. */
	pendingFor(target: string): PendingAttempt | undefined {
		return this.pending.get(target);
	}

	/**
	 * The composer now shows `ctx.target`: idle, or - when an attempt may still
	 * be in flight there - that attempt's status, read again by its key.
	 */
	enter(ctx: AttemptContext): Promise<void> {
		this.current = null;
		ctx.setPhase({ kind: "idle" });
		const prior = this.pending.get(ctx.target);
		return prior ? this.recover(ctx, prior, null) : Promise.resolve();
	}

	/** Send (or Retry) the box's draft. */
	send(ctx: AttemptContext, draft: CommunityDraftBytes): Promise<void> {
		const prior = this.pending.get(ctx.target);
		if (prior) return this.recover(ctx, prior, draft);
		return this.submit(ctx, this.mintKey(), draft);
	}

	/**
	 * Best-effort cancel (RFC §5.5): if the hub already published, the reader
	 * sees it posted. The UI says "Cancelling" until the hub answers.
	 */
	async cancel(ctx: AttemptContext): Promise<void> {
		const key = this.current;
		if (!key) return;
		ctx.setPhase({ kind: "checking", key, cancelling: true });
		try {
			const outcome = await ctx.cancel(key);
			if (outcome.state !== "checking") this.forget(ctx.target, key);
			if (this.current !== key) return;
			this.settle(ctx, outcome);
			if (outcome.state === "checking") void this.follow(ctx, key);
		} catch (error) {
			if (!attemptMayBeLive(communityFailure(error)))
				this.forget(ctx.target, key);
			if (this.current !== key) return;
			this.fail(ctx, key, error);
		}
	}

	/**
	 * Hide the notice. A pending attempt is NOT forgotten: the notice going away
	 * does not make an in-flight post any less likely to land.
	 */
	dismiss(ctx: AttemptContext): void {
		this.current = null;
		ctx.setPhase({ kind: "idle" });
	}

	private async submit(
		ctx: AttemptContext,
		key: string,
		draft: CommunityDraftBytes,
	): Promise<void> {
		this.current = key;
		this.pending.set(ctx.target, { key, draft });
		ctx.setPhase({ kind: "checking", key, cancelling: false });
		try {
			const outcome = await ctx.submit(key, draft);
			// Settled even when the reader has moved on: a stored answer is final
			// for this key, so it must not be asked about again.
			if (outcome.state !== "checking") this.forget(ctx.target, key);
			if (this.current !== key) return;
			this.settle(ctx, outcome);
			if (outcome.state === "checking") void this.follow(ctx, key);
		} catch (error) {
			const failure = communityFailure(error);
			if (!attemptMayBeLive(failure)) this.forget(ctx.target, key);
			if (this.current !== key) return;
			this.fail(ctx, key, error);
		}
	}

	/**
	 * Ask the hub about a pending attempt, then act on the answer. `draft` is
	 * what the box holds now, or `null` for a resume (nothing is being sent).
	 */
	private async recover(
		ctx: AttemptContext,
		prior: PendingAttempt,
		draft: CommunityDraftBytes | null,
	): Promise<void> {
		const key = prior.key;
		this.current = key;
		ctx.setPhase({ kind: "checking", key, cancelling: false });
		const unchanged = draft === null || sameDraftBytes(prior.draft, draft);
		let read:
			| { outcome: CommunitySubmission }
			| { failure: ReturnType<typeof communityFailure> };
		try {
			read = { outcome: await ctx.status(key) };
		} catch (error) {
			read = { failure: communityFailure(error) };
		}
		if (this.current !== key) return;
		const next = recoveryAfterStatusRead(read, unchanged, this.clock.now());
		switch (next.kind) {
			case "follow":
				void this.follow(ctx, key);
				return;
			case "settle":
				if ("outcome" in read) {
					this.forget(ctx.target, key);
					this.settle(ctx, read.outcome);
				}
				return;
			case "hold":
				// Unknown either way: keep the attempt, send nothing.
				ctx.setPhase(next.phase);
				return;
			case "submit":
				if ("outcome" in read && read.outcome.state === "published")
					ctx.onHistoryChanged();
				if (draft === null) {
					// A resume with nothing to send. The attempt stays pending: a
					// request still on the wire may yet arrive, so the reader's next
					// Send of the same bytes must reuse this key.
					this.current = null;
					ctx.setPhase({ kind: "idle" });
					return;
				}
				this.forget(ctx.target, key);
				await this.submit(
					ctx,
					next.key === "same" ? key : this.mintKey(),
					draft,
				);
				return;
		}
	}

	/** Status reads every 2 s while the verdict is still `checking`. */
	private async follow(ctx: AttemptContext, key: string): Promise<void> {
		for (;;) {
			await this.clock.wait(FOLLOW_UP_INTERVAL_MS);
			if (this.current !== key) return;
			try {
				const outcome = await ctx.status(key);
				if (this.current !== key) return;
				if (outcome.state !== "checking") {
					this.forget(ctx.target, key);
					this.settle(ctx, outcome);
					return;
				}
			} catch (error) {
				if (this.current !== key) return;
				// A failed read is not an answer: the attempt stays pending, and
				// Retry asks about the same key again.
				this.fail(ctx, key, error);
				return;
			}
		}
	}

	private settle(ctx: AttemptContext, outcome: CommunitySubmission): void {
		const next = phaseAfterSubmission(outcome);
		ctx.setPhase(next.phase);
		if (next.clearDraft) {
			this.current = null;
			ctx.onPublished(outcome.message_id ?? null);
			ctx.onHistoryChanged();
		}
	}

	/** Show a failure; an attempt it may not have ended stays pending. */
	private fail(ctx: AttemptContext, key: string, error: unknown): void {
		const failure = communityFailure(error);
		if (!attemptMayBeLive(failure)) {
			this.forget(ctx.target, key);
			if (failure.kind === "guidelines_changed") ctx.onGuidelinesChanged?.();
		}
		ctx.setPhase(phaseAfterFailure(failure, this.clock.now()));
	}

	private forget(target: string, key: string): void {
		if (this.pending.get(target)?.key === key) this.pending.delete(target);
	}
}
