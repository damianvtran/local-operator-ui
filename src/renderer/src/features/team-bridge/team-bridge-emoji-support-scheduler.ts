import {
	cachedEmojiSupport,
	canRenderEmoji,
} from "./team-bridge-emoji-support";

/** Bound both cheap-font and expensive-font machines. A single native canvas
 * call cannot be interrupted, but it must not be followed by 3,962 more in the
 * same task. These are work budgets, not a claim about click-to-paint latency. */
export const EMOJI_SUPPORT_BATCH_SIZE = 24;
export const EMOJI_SUPPORT_BUDGET_MS = 4;

/** The clock seam proves cancellation and work bounds without pretending a
 * jsdom commit is a rendered browser frame. Production always uses this tab. */
export type EmojiSupportClock = {
	requestFrame: (callback: () => void) => number;
	cancelFrame: (handle: number) => void;
	setTask: (callback: () => void) => number;
	cancelTask: (handle: number) => void;
	now: () => number;
};

const browserClock: EmojiSupportClock = {
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (handle) => cancelAnimationFrame(handle),
	setTask: (callback) => window.setTimeout(callback, 0),
	cancelTask: (handle) => window.clearTimeout(handle),
	now: () => performance.now(),
};

/** Warm ONLY font-support facts, never account preferences or message state.
 *
 * A React effect (and the first rAF) can run before paint. Give the tray a paint
 * opportunity between two frames, then do native glyph work in bounded tasks,
 * outside render. Keep this cancellable: closing, searching or changing account
 * must not leave a whole-corpus job running behind a discarded popover.
 *
 * Concurrent pickers share the existing per-font cache, not component state.
 * Recheck it at execution time so two queued jobs never probe the same glyph
 * twice. Notify even when another job supplied the answer: this caller's view
 * still needs to learn that its pending prefix is ready.
 */
export function scheduleEmojiSupport(
	emojis: readonly string[],
	onProgress: () => void,
	clock: EmojiSupportClock = browserClock,
): () => void {
	const pending = [...new Set(emojis)].filter(
		(emoji) => cachedEmojiSupport(emoji) === undefined,
	);
	if (pending.length === 0) return () => {};
	let cancelled = false;
	let frame: number | undefined;
	let task: number | undefined;
	let cursor = 0;
	const run = () => {
		task = undefined;
		if (cancelled) return;
		const started = clock.now();
		let count = 0;
		while (cursor < pending.length && count < EMOJI_SUPPORT_BATCH_SIZE) {
			const emoji = pending[cursor++];
			if (cachedEmojiSupport(emoji) === undefined) canRenderEmoji(emoji);
			count++;
			if (clock.now() - started >= EMOJI_SUPPORT_BUDGET_MS) break;
		}
		onProgress();
		if (!cancelled && cursor < pending.length) task = clock.setTask(run);
	};
	frame = clock.requestFrame(() => {
		if (cancelled) return;
		frame = clock.requestFrame(() => {
			frame = undefined;
			if (!cancelled) task = clock.setTask(run);
		});
	});
	return () => {
		cancelled = true;
		if (frame !== undefined) clock.cancelFrame(frame);
		if (task !== undefined) clock.cancelTask(task);
	};
}
