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

/** Render may read a known font fact, but must never discover one: canvas text
 * rasterisation/readback across the corpus used to block the picker's first
 * frame. `undefined` is intentionally distinct from an unsupported glyph. The
 * deferred scheduler owns discovery; selection only offers proven glyphs. */
export function cachedEmojiSupport(emoji: string): boolean | undefined {
	return cache.get(emoji);
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
