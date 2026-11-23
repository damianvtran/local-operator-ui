import type { AnchorSample } from "./scroll-paging";
import { layoutTransactionDrift } from "./transcript-dom-window";

export type ScrollLayoutCoordinator = {
	/** Capture before mutating nodes/spacers. The pager's existing hold wins. */
	begin: () => void;
	/** Residual correction after browser anchoring, including net-zero extent changes. */
	commit: (retain?: boolean) => boolean;
	heldId: () => string | null;
	retarget: (from: string, to: string) => void;
	cancel: () => void;
	/**
	 * Forget the captured anchor without touching motion/navigation leases. A
	 * scroll-to-tail flight calls this (via the pager's `releaseHold`) because the
	 * reader has asked to leave the place the transaction is defending.
	 */
	drop: () => void;
	retainMotion: () => () => void;
	retainNavigation: () => () => void;
};

/**
 * A transaction seam on the pager's anchor and input clock, NOT another scroll
 * hook. Every correction delegates to its acknowledged writer. One transaction
 * can cover a batch of measurements and overlapping slot transitions; real input
 * invalidates the whole batch instead of being undone by a stale layout sample.
 */
export function createScrollLayoutCoordinator(options: {
	held: () => AnchorSample | null;
	sample: () => AnchorSample | null;
	measure: (id: string) => AnchorSample | null;
	inputRevision: () => number;
	following: () => boolean;
	write: (drift: number | "tail") => void;
	rebase?: () => void;
	onNavigation?: (active: boolean) => void;
	onMissingAnchor?: (id: string) => void;
	replaceHeld?: (sample: AnchorSample) => void;
	/**
	 * True while something else owns the offset (a scroll-to-tail flight). The
	 * flight rewrites `scrollTop` every frame, so any anchor captured or defended
	 * now is a position the reader is passing through: correcting toward it
	 * would pull them backward against their own request (PR #2068, R1-2).
	 */
	suspended?: () => boolean;
}): ScrollLayoutCoordinator {
	let motions = 0;
	let navigating = 0;
	let transaction: {
		sample: AnchorSample | null;
		input: number;
		tail: boolean;
	} | null = null;
	return {
		begin() {
			if (options.suspended?.()) return;
			if (transaction && transaction.input === options.inputRevision()) return;
			const tail = options.following();
			transaction = {
				sample: tail ? null : (options.held() ?? options.sample()),
				input: options.inputRevision(),
				tail,
			};
		},
		commit(retain = false) {
			if (navigating > 0) return true;
			const current = transaction;
			if (!current) return true;
			if (options.suspended?.()) {
				transaction = null;
				return true;
			}
			if (!retain && motions === 0) transaction = null;
			if (current.input !== options.inputRevision()) {
				transaction = null;
				return true;
			}
			if (current.tail) {
				if (options.following()) options.write("tail");
				return true;
			}
			/*
			 * A HELD (non-tail) transaction ends the moment the reader is at the
			 * tail, exactly as the pager's `correctAnchor` tail gate drops its sample.
			 * Without this a retained transaction (the entry slot's 240 ms height
			 * transition commits every frame) kept "restoring" a row the reader had
			 * left, writing them back off the tail right after a send's flight landed
			 * (PR #2068, R1-1). Nothing is written: following is not our offset to fix.
			 */
			if (options.following()) {
				transaction = null;
				return true;
			}
			const after = current.sample ? options.measure(current.sample.id) : null;
			const drift = layoutTransactionDrift(
				current.sample,
				after,
				current.input,
				options.inputRevision(),
			);
			if (drift === null) {
				if (current.sample) options.onMissingAnchor?.(current.sample.id);
				return current.sample === null;
			}
			if (Math.abs(drift) > 0.01) options.write(drift);
			return true;
		},
		retarget(from, to) {
			if (
				!transaction ||
				transaction.input !== options.inputRevision() ||
				transaction.sample?.id !== from ||
				from === to
			)
				return;
			const first = options.measure(to);
			// Consolidation deletes the old point. Preserve a visible first-slot
			// origin; if it was offscreen, use the reader's disappearing point for
			// the closest surviving header instead. Bounds may still clamp once.
			const replacement = {
				...(first ?? transaction.sample),
				id: to,
				viewportOffset:
					first && first.viewportOffset >= 0
						? first.viewportOffset
						: transaction.sample.viewportOffset,
			};
			transaction.sample = replacement;
			options.replaceHeld?.(replacement);
		},
		heldId() {
			if (transaction?.input === options.inputRevision() && transaction.tail)
				return null;
			// Scroll refresh may select another pager row without new input. Lease
			// the exact captured id commit() will measure, not that newer sample.
			return (
				(transaction?.input === options.inputRevision()
					? transaction.sample?.id
					: null) ??
				options.held()?.id ??
				null
			);
		},
		cancel() {
			transaction = null;
			motions = 0;
			navigating = 0;
			options.onNavigation?.(false);
		},
		drop() {
			transaction = null;
		},
		retainNavigation() {
			navigating += 1;
			options.onNavigation?.(true);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				navigating = Math.max(0, navigating - 1);
				if (navigating === 0) {
					transaction = null;
					options.onNavigation?.(false);
					options.rebase?.();
				}
			};
		},
		retainMotion() {
			motions += 1;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				motions = Math.max(0, motions - 1);
			};
		},
	};
}
