/**
 * Perceptual colour maths, shared.
 *
 * `contrast-contract.mjs` owns the palette assertions and `check-evidence.mjs`
 * owns the frame assertions, and both need CIEDE2000. It lived in the contract
 * and was about to be typed a second time - which is how a floor and a ceiling
 * come to measure different things, the defect D85 was filed over. One
 * implementation, two callers.
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

export const r2 = (n) => Math.round(n * 100) / 100;
