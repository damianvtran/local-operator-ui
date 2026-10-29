/** A Unicode allowlist proves the sequence is valid, not that this computer's emoji font can
 * paint it. Probe the actual font once per sequence: a color glyph ignores text fill colour,
 * while monochrome fallback/tofu changes with it. Width also rejects unjoined ZWJ sequences
 * rendered as several otherwise-supported glyphs. Fail closed if canvas is unavailable. */
const SIZE = 40;
const FONT_SIZE = 28;
const cache = new Map<string, boolean>();
/* The warm-up walk's position, and the only completion marker there is.
   MODULE LEVEL, and advanced only as probes actually run: a walk can be
   cancelled part-way and has to resume, so "started" cannot mean "done". See
   `warmEmojiProbeCache` for the two mounts that cancel it. */
let cursor = 0;
let context: CanvasRenderingContext2D | null | undefined;

export function isSingleColorGlyph(
	white: Uint8ClampedArray,
	black: Uint8ClampedArray,
	width: number,
): boolean {
	if (width <= 0 || width > FONT_SIZE * 1.5 || white.length !== black.length)
		return false;
	let painted = false;
	for (let i = 0; i < white.length; i++) {
		if (white[i] !== black[i]) return false;
		if (i % 4 === 3 && white[i] !== 0) painted = true;
	}
	return painted;
}

export function canRenderEmoji(emoji: string): boolean {
	const cached = cache.get(emoji);
	if (cached !== undefined) return cached;
	if (context === undefined) {
		try {
			const canvas = document.createElement("canvas");
			canvas.width = SIZE;
			canvas.height = SIZE;
			context = canvas.getContext("2d", { willReadFrequently: true });
			if (context) {
				context.font = `${FONT_SIZE}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
				context.textBaseline = "top";
			}
		} catch {
			context = null;
		}
	}
	let supported = false;
	if (context) {
		try {
			const paint = (color: string) => {
				context?.clearRect(0, 0, SIZE, SIZE);
				if (!context) return new Uint8ClampedArray();
				context.fillStyle = color;
				context.fillText(emoji, 2, 2);
				return context.getImageData(0, 0, SIZE, SIZE).data;
			};
			const white = paint("#fff");
			const black = paint("#000");
			supported = isSingleColorGlyph(
				white,
				black,
				context.measureText(emoji).width,
			);
		} catch {
			supported = false;
		}
	}
	cache.set(emoji, supported);
	return supported;
}

/**
 * WARM THE PROBE CACHE BEFORE THE PICKER IS ASKED FOR (operator report
 * 2026-10-27: the picker took seconds to open). `canRenderEmoji` is a canvas
 * paint plus `getImageData` per sequence - about 0.7 ms each here, so the
 * first picker open used to pay for hundreds of them inside its own click
 * handler, and the operator waited on a click that had not painted. This walks
 * the corpus in idle slices instead, starting when a timeline mounts (the
 * toolbar that opens the picker is on every row), so the synchronous probe left
 * on the open path is a cache lookup.
 *
 * Deliberately returns its cancel function, and deliberately walks the corpus
 * ONCE per module: the corpus is a fixed table, so every later caller - the
 * thread pane's own lists, a conversation switch - would otherwise re-walk what
 * is already probed.
 *
 * "Once" means ONE COMPLETED WALK, not one start, because the walk is routinely
 * cancelled part-way and must resume (agent review round 2, R2-M1). Two mounts
 * cancel it: React StrictMode mounts, cleans up and remounts every effect in
 * development, and the timeline list unmounts whenever a conversation loads. A
 * `started` flag set at the top would have left the cache cold for the rest of
 * the session in both cases - every later picker open falling back to the
 * synchronous probing this warm-up exists to remove - so the cursor lives at
 * module level and a later call continues from it. The corpus length is the
 * completion marker: once the cursor reaches it, later calls are no-ops.
 *
 * `requestIdleCallback` is not used: it is absent in older WebKit and the
 * scheduler here only needs "after paint", which a zero-delay timer already
 * gives.
 */
export function warmEmojiProbeCache(
	entries: readonly string[],
	sliceMs = 8,
): () => void {
	if (cursor >= entries.length) return () => {};
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cancelled = false;
	const slice = () => {
		if (cancelled) return;
		const deadline = performance.now() + sliceMs;
		while (cursor < entries.length && performance.now() < deadline) {
			canRenderEmoji(entries[cursor]);
			cursor++;
		}
		if (cursor < entries.length) timer = setTimeout(slice, 0);
	};
	timer = setTimeout(slice, 0);
	return () => {
		cancelled = true;
		if (timer !== undefined) clearTimeout(timer);
	};
}
