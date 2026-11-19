/** OKLab's published sRGB matrices. Picker coordinates stay in OKLCH while
 * exported values are opaque sRGB hex, the engine's closed colour grammar.
 * Out-of-gamut colours reduce chroma, not RGB channels (which changes hue).
 */
export const hexToOklch = (hex) => {
	const rgb = [1, 3, 5]
		.map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	const [r, g, b] = rgb;
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return {
		l: L,
		c: Math.hypot(a, bb),
		h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
	};
};
const linear = ({ l, c, h }) => {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
		-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
		-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
	];
};
export const oklchToHex = (value) => {
	const coord = {
		l: Math.max(0, Math.min(1, value.l)),
		c: Math.max(0, Math.min(0.4, value.c)),
		h: ((value.h % 360) + 360) % 360,
	};
	const inGamut = (rgb) => rgb.every((v) => v >= -1e-7 && v <= 1 + 1e-7);
	const clipped = !inGamut(linear(coord));
	if (clipped) {
		let low = 0;
		let high = coord.c;
		for (let i = 0; i < 22; i++) {
			const mid = (low + high) / 2;
			if (inGamut(linear({ ...coord, c: mid }))) low = mid;
			else high = mid;
		}
		coord.c = low;
	}
	const hex = `#${linear(coord)
		.map((v) => {
			const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
			return Math.round(Math.max(0, Math.min(1, s)) * 255)
				.toString(16)
				.padStart(2, "0");
		})
		.join("")
		.toUpperCase()}`;
	return { hex, clipped };
};
export const rgbToHex = (values) =>
	values.length === 3 &&
	values.every((v) => Number.isFinite(v) && v >= 0 && v <= 255)
		? `#${values
				.map((v) => Math.round(v).toString(16).padStart(2, "0"))
				.join("")
				.toUpperCase()}`
		: null;
