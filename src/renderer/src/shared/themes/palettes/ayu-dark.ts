import type { ThemeDefinition } from "../palette-contract";

/**
 * Ayu Dark.
 *
 * Carried from ayu-theme's `dark` variant: the near-black blue ground, the
 * bright azure accent, and the green, orange, red and violet semantics. Ayu is
 * a family of three — `ayu-mirage.ts` and `ayu-light.ts` are the other two —
 * and all three carry the same accent hue, so a user switching between them
 * sees one scheme change temperature rather than identity.
 *
 * Ayu's ground ladder is upstream's own (bg 0f1419, surface 141821, raised
 * 161a24), reordered onto this contract's four grounds, with `sunken` one step
 * below; its steps measure ΔE00 2.3 against the 2.0 field floor. Roles the
 * scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`.
 *
 * `inkDim` is the one ink that moves: the scheme's dim rung sits a step too
 * close to `inkMuted` for the contract's ΔE00 8 ink step, so the readout rung
 * relaxes away from it rather than the control rung collapsing into `ink`.
 */
export const ayuDark: ThemeDefinition = {
	id: "ayuDark",
	name: "Ayu Dark",
	description: "Ayu's night: near-black blue with a bright azure accent.",
	palette: {
		mode: "dark",

		canvas: "#10141C",
		surface: "#181D27",
		elevated: "#222834",
		sunken: "#080A0F",

		/*
		 * The current row's own ground: `surface` stepped 4.94 `L*` up at the panel's own
		 * hue (2.5 degrees off, inside the 12-degree bound) and carried
		 * 8.63 `C*` against the panel's 7.57 — the panel's own colour, one step lighter, which
		 * is what the operator asked for. ΔE00 from `surface` 3.33, from
		 * `elevated` 0.62, from `sunken` 9.49. Ink on this ground: `ink` 7.94:1,
		 * `ink-muted` 7.25:1, `ink-dim` 4.68:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `1.31x` the panel's
		 * chroma (9.96 `C*` against 7.57), 9 degrees off its hue, ΔE00 4.14 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * THE HOVER STEP IS THE COLLISION: 0.62 to `elevated` is under the field floor,
		 * because `elevated` is the same `surface` + `L*` ramp for the same rows — a bounded
		 * mark has nowhere else to sit. The pair is pinned in `HIGHLIGHT_HOVER_PINS` and is
		 * on the row-hover work list.
		 */
		highlight: "#222733",

		ink: "#BFBDB6",
		inkMuted: "#ACB6BF",
		// the scheme's dim rung, relaxed to clear ΔE00 8 from `inkMuted`.
		inkDim: "#88919C",
		inkDisabled: "#565B66",

		hairline: "#30353F",
		// upstream's ui line 2B3038 is 1.11:1 on `elevated` — a ground colour
		// doing a boundary's job. Lifted along the same blue-grey.
		borderControl: "#667284",

		// upstream's accent, the family's signature azure.
		accent: "#59C2FF",
		accentHover: "#7DCFFF",
		accentActive: "#09A5FF",
		// ΔE00 10.5 from `accent` and 11.1:1 on surface, where the accent is
		// 8.5:1.
		chartBarHover: "#77DFFF",
		accentWash: "#152431",
		onAccent: "#0D1017",

		success: "#AAD94C",
		successWash: "#181F1F",
		successBorder: "#AAD94C",

		warning: "#FFB454",
		warningWash: "#232120",
		warningBorder: "#FFB454",

		danger: "#F07178",
		dangerWash: "#221B23",
		dangerBorder: "#F07178",

		info: "#D2A6FF",
		infoWash: "#222232",
		infoBorder: "#D2A6FF",

		overlayShadow: "0 12px 32px -12px rgb(5 6 9 / 0.8)",
		scrim: "rgb(5 6 9 / 0.65)",
	},
};
