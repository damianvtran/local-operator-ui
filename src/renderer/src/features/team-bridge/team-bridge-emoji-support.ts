/** A Unicode allowlist proves the sequence is valid, not that this computer's emoji font can
 * paint it. Probe the actual font once per sequence: a color glyph ignores text fill colour,
 * while monochrome fallback/tofu changes with it. Width also rejects unjoined ZWJ sequences
 * rendered as several otherwise-supported glyphs. Fail closed if canvas is unavailable. */
const SIZE = 40;
const FONT_SIZE = 28;
const cache = new Map<string, boolean>();
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
 * Deliberately returns its cancel function: the caller mounts it once per
 * timeline, a slice yields before the browser's next frame, and repeated
 * mounts (every conversation switch) resume from the same module-wide cache,
 * so a second call costs one `performance.now()` per slice. `requestIdleCallback`
 * is not used: it is absent in older WebKit and the scheduler here only needs
 * "after paint", which a zero-delay timer already gives.
 */
export function warmEmojiProbeCache(
	entries: readonly string[],
	sliceMs = 8,
): () => void {
	let index = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cancelled = false;
	const slice = () => {
		if (cancelled) return;
		const deadline = performance.now() + sliceMs;
		while (index < entries.length && performance.now() < deadline) {
			canRenderEmoji(entries[index]);
			index++;
		}
		if (index < entries.length) timer = setTimeout(slice, 0);
	};
	timer = setTimeout(slice, 0);
	return () => {
		cancelled = true;
		if (timer !== undefined) clearTimeout(timer);
	};
}
