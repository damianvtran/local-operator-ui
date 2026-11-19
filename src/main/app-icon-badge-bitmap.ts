/** Windows overlays are NativeImages, not SVG/data URLs handed to a native
 * API that does not accept them. A tiny deterministic BGRA bitmap avoids a
 * renderer, font availability, canvas and an additional graphics dependency.
 * The monochrome ink/ground pair stays legible independently of app themes;
 * the outer white rim distinguishes its black disc from a dark taskbar.
 */
const DIGITS: Record<string, string[]> = {
	"1": ["010", "110", "010", "010", "111"],
	"2": ["110", "001", "010", "100", "111"],
	"3": ["110", "001", "010", "001", "110"],
	"4": ["101", "101", "111", "001", "001"],
	"5": ["111", "100", "110", "001", "110"],
	"6": ["011", "100", "111", "101", "111"],
	"7": ["111", "001", "010", "010", "010"],
	"8": ["111", "101", "111", "101", "111"],
	"9": ["111", "101", "111", "001", "110"],
};

export function appIconBadgeBitmap(label: string): Buffer {
	if (label !== "•" && label !== "9+" && !DIGITS[label]) {
		throw new Error("Unsupported app icon badge label");
	}
	const bitmap = Buffer.alloc(16 * 16 * 4);
	const pixel = (x: number, y: number, white: boolean) => {
		const offset = (y * 16 + x) * 4;
		bitmap.fill(white ? 255 : 0, offset, offset + 3);
		bitmap[offset + 3] = 255;
	};
	for (let y = 0; y < 16; y++) {
		for (let x = 0; x < 16; x++) {
			const distance = (x - 7.5) ** 2 + (y - 7.5) ** 2;
			if (distance <= 56.25) pixel(x, y, distance > 42.25);
		}
	}
	if (label === "•") {
		for (let y = 5; y <= 10; y++) {
			for (let x = 5; x <= 10; x++) {
				if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 8.5) pixel(x, y, true);
			}
		}
		return bitmap;
	}
	const overflow = label === "9+";
	const glyph = DIGITS[overflow ? "9" : label];
	const xScale = overflow ? 1 : 2;
	// Overflow needs a black gap around its narrow 9, not a rim-shaped stroke.
	// Trim the doubled top/bottom rows to fit the 9 in the inner 8px height.
	const left = overflow ? 4 : 5;
	for (let y = 0; y < 5; y++) {
		const height = overflow && (y === 0 || y === 4) ? 1 : 2;
		const top = 3 + y * 2 + Number(overflow && y === 0);
		for (let x = 0; x < 3; x++) {
			if (glyph[y][x] !== "1") continue;
			for (let dy = 0; dy < height; dy++) {
				for (let dx = 0; dx < xScale; dx++) {
					pixel(left + x * xScale + dx, top + dy, true);
				}
			}
		}
	}
	if (overflow) {
		for (let n = 0; n < 5; n++) {
			pixel(8 + n, 7, true);
			pixel(10, 5 + n, true);
		}
	}
	return bitmap;
}
