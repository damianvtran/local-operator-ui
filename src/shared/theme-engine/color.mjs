/**
 * Colour maths shared by the build-time gates AND the renderer.
 *
 * WHY THIS LIVES UNDER src/shared AND IS PLAIN .mjs. Three consumers measure
 * colour: the contrast contract (`scripts/contrast-contract.mjs`), the evidence
 * gate (`scripts/check-evidence.mjs`) and, since the theme composition engine,
 * the renderer itself - which re-solves a palette at a contrast preset and has
 * to reach the SAME verdict the gate reaches, or the gate would bless palettes
 * the app never paints and vice versa. The scripts are deliberately build-free
 * (`scripts/palette-source.mjs` explains why), so they can only import JS; Vite
 * imports `.mjs` natively. One file, every caller, so a floor and the thing
 * that checks it cannot come to measure different things (the defect D85 was
 * filed over). `scripts/color.mjs` re-exports this module so existing imports
 * keep working.
 *
 * Two luminance curves exist here ON PURPOSE and must not be "unified":
 * `toLab` linearises with the sRGB 0.04045 knee (CIE maths), `lum` with WCAG
 * 2.1's 0.03928 (the contrast formula the floors are written against). Both
 * are the published constants of their own standard; swapping either moves
 * every measured value in the contract by a few thousandths, and shipped
 * palettes sit within hundredths of their floors.
 */

/*
 * Perceptual difference, CIEDE2000.
 *
 * Every other measurement in this file is a contrast ratio, which is a
 * function of luminance alone. Two colours can therefore be equally legible
 * on the same ground, pass every assertion here, and still be the same colour
 * to a reader — which is exactly how `success` and `info` shipped ΔE00 2.2
 * apart in one brand palette and with byte-identical washes in the other.
 * Legibility and distinguishability are different properties and need
 * different maths.
 */
export const toLab = (hex) => {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	const X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
	const Y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
	const Z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
	const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
	const [fx, fy, fz] = [f(X), f(Y), f(Z)];
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

/** CIEDE2000 difference between two hex colours. */
export const deltaE = (h1, h2) => {
	const [L1, a1, b1] = toLab(h1);
	const [L2, a2, b2] = toLab(h2);
	const RAD = Math.PI / 180;
	const DEG = 180 / Math.PI;
	const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
	const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
	const [ap1, ap2] = [(1 + G) * a1, (1 + G) * a2];
	const [Cp1, Cp2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
	const hp = (b, ap) => {
		if (b === 0 && ap === 0) return 0;
		const h = Math.atan2(b, ap) * DEG;
		return h < 0 ? h + 360 : h;
	};
	const [hp1, hp2] = [hp(b1, ap1), hp(b2, ap2)];
	const dL = L2 - L1;
	const dC = Cp2 - Cp1;
	let dhp = 0;
	if (Cp1 * Cp2 !== 0) {
		dhp = hp2 - hp1;
		if (dhp > 180) dhp -= 360;
		else if (dhp < -180) dhp += 360;
	}
	const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * RAD) / 2);
	const Lb = (L1 + L2) / 2;
	const Cpb = (Cp1 + Cp2) / 2;
	let hpb;
	if (Cp1 * Cp2 === 0) hpb = hp1 + hp2;
	else {
		hpb = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2) / 2;
		if (hpb >= 360) hpb -= 360;
	}
	const T =
		1 -
		0.17 * Math.cos((hpb - 30) * RAD) +
		0.24 * Math.cos(2 * hpb * RAD) +
		0.32 * Math.cos((3 * hpb + 6) * RAD) -
		0.2 * Math.cos((4 * hpb - 63) * RAD);
	const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
	const Sc = 1 + 0.045 * Cpb;
	const Sh = 1 + 0.015 * Cpb * T;
	const Rt =
		-Math.sin(2 * 30 * Math.exp(-(((hpb - 275) / 25) ** 2)) * RAD) *
		2 *
		Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
	return Math.sqrt(
		(dL / Sl) ** 2 +
			(dC / Sc) ** 2 +
			(dH / Sh) ** 2 +
			Rt * (dC / Sc) * (dH / Sh),
	);
};

/*
 * The inverse of `toLab`, for the one caller that has to ASK a question of a
 * palette rather than check a value it already has: `contrast-contract.mjs`
 * re-derives each pinned palette's ink cap by moving `L*` in the mode's
 * direction at the panel's own hue and chroma until an ink floor breaks, so it
 * needs to turn a Lab triple back into a colour it can measure. Returns null
 * when the triple lands outside sRGB, which is what makes a palette's chroma
 * axis finite: past that boundary the search has no candidate at all.
 */
export const labToHex = ([L, a, b]) => {
	const fy = (L + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;
	const finv = (t) => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29));
	const X = finv(fx) * 0.95047;
	const Y = finv(fy);
	const Z = finv(fz) * 1.08883;
	const lin = [
		X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314,
		X * -0.969266 + Y * 1.8760108 + Z * 0.041556,
		X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252,
	];
	const srgb = lin.map((v) =>
		v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055,
	);
	if (srgb.some((v) => v < -0.0015 || v > 1.0015)) return null;
	const c = (v) =>
		Math.round(Math.min(1, Math.max(0, v)) * 255)
			.toString(16)
			.padStart(2, "0")
			.toUpperCase();
	return `#${srgb.map(c).join("")}`;
};

export const r2 = (n) => Math.round(n * 100) / 100;

/* ---- WCAG 2.1 contrast, compositing (moved verbatim from contrast-contract.mjs) ---- */

/** sRGB relative luminance, WCAG 2.1 formula. */
export const lum = (hex) => {
	const h = hex.replace("#", "").trim();
	const full =
		h.length === 3
			? h
					.split("")
					.map((c) => c + c)
					.join("")
			: h;
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const ratio = (a, b) => {
	const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
	return (x + 0.05) / (y + 0.05);
};

/* A palette value that is not a flat hex — an `rgb()` scrim, a shadow — cannot
   be measured against a ground and is not a colour this contract governs. */
export const HEX = /^#[0-9a-fA-F]{3,8}$/;
export const isHex = (v) => typeof v === "string" && HEX.test(v);

/**
 * A translucent colour over an opaque ground, as the flat hex the eye receives.
 *
 * The panel seam is `hairline` at an alpha, so the colour it actually paints is
 * not a palette value and none of the assertions above can read it without this.
 * Compositing is done in sRGB bytes, the same way the browser composites a
 * background colour, rather than in Lab: the measurement is of the pixel that
 * lands on screen.
 */
export const over = (fg, bg, alpha) => {
	const channels = (hex) => {
		const body = hex.replace("#", "").trim();
		const full =
			body.length === 3
				? body
						.split("")
						.map((c) => c + c)
						.join("")
				: body;
		return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
	};
	const [r, g, b] = channels(fg);
	const [R, G, B] = channels(bg);
	const mix = (x, y) => Math.round(x * alpha + y * (1 - alpha));
	return `#${[mix(r, R), mix(g, G), mix(b, B)]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("")}`;
};

/*
 * `color-mix(in srgb, a share%, b)` as the browser computes it: a straight
 * interpolation of the sRGB-ENCODED channels (CSS Color 5 "in srgb"), rounded
 * to the 8-bit value the compositor paints. Used for fills a component derives
 * from two roles rather than naming one, so the contract measures the colour
 * on screen instead of a role it does not wear.
 */
export const srgbMix = (a, b, share) => {
	if (!isHex(a) || !isHex(b) || a.length !== 7 || b.length !== 7) return null;
	const ch = (h, i) => Number.parseInt(h.slice(i, i + 2), 16);
	return `#${[1, 3, 5]
		.map((i) =>
			Math.round(ch(a, i) * share + ch(b, i) * (1 - share))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
};
