import type { ThemeDefinition } from "../palette-contract";

/**
 * Rosé Pine Dawn.
 *
 * The daytime half of Rosé Pine, and the reason this scheme is worth porting at
 * all: it is the variant a user picks so that Rosé Pine looks the same at noon
 * as it does at midnight. Preserving that means the accent row stays the
 * scheme's own — rose, pine, gold, love, foam — and only its lightness moves,
 * which is what most of this file is about.
 *
 * ## What the four grounds cost
 *
 * Rosé Pine Dawn defines three grounds and this contract needs four, each
 * measured against every ink. Upstream's ladder (base faf4ed, surface fffaf3,
 * overlay f2e9e1, highlight-med dfdad9) cannot supply them: base-to-surface is
 * ΔE00 1.3 and surface-to-elevated 1.8, under the 2.0 at which the captured
 * theme frames show a card reading as a separate surface from its canvas, and
 * its top is already a shade off white with nothing above it.
 *
 * Deepening in lightness alone is not available either, because every ink in
 * this scheme is a soft one — text 4e4970 is 7.7:1 on upstream's base, not the
 * 13:1 a modern dark ink gets — so each step down costs a floor. So the ladder
 * is re-solved at the brand light pair's own proportions and keeps `canvas`
 * within ΔE00 0.7 of upstream's base: the top sheet goes to near-white, and the
 * three steps below it are spaced by a single step each. Adjacent steps measure
 * ΔE00 2.14 / 2.27, and the deepest ground 6.34 from the top.
 *
 * Roles the scheme has no value for follow the derivation rules recorded in
 * `rose-pine.ts`. `info` is the one value that moves for a second reason: foam
 * 56949f arrives at 3.1:1 on this paper, and once lifted to the floor it
 * measured ΔE00 13.7 from pine — under the 15 the contract wants between two
 * semantics a reader meets alone and has to name. It is pulled toward its green
 * end to 10746E, which holds 15.6.
 */
export const rosePineDawn: ThemeDefinition = {
	id: "rosePineDawn",
	name: "Rosé Pine Dawn",
	description: "Rosé Pine by daylight: warm rose paper with pine and gold ink.",
	palette: {
		mode: "light",

		canvas: "#F9F2EA",
		surface: "#FCF7F3",
		elevated: "#FFFEFB",
		sunken: "#F8EDE0",

		/*
		 * The current row's own ground: `surface` stepped 2.93 `L*` down at the panel's own
		 * hue (7.3 degrees off, inside the 12-degree bound) and carried
		 * 3.83 `C*` against the panel's 2.69 — the panel's own colour, one step darker, which
		 * is what the operator asked for. ΔE00 from `surface` 2.20, from
		 * `elevated` 4.41, from `sunken` 3.56. Ink on this ground: `ink` 7.30:1,
		 * `ink-muted` 6.13:1, `ink-dim` 4.65:1 — `ink-dim` is the binder, and
		 * the 0.15 of headroom it keeps is the floor this mark is authored against.
		 *
		 * WHAT THIS REPLACES: the value before this round — `2.10x` the panel's
		 * chroma (5.64 `C*` against 2.69), 22 degrees off its hue, ΔE00 4.09 from
		 * `surface` — is the cast that bought its band, and it is what the operator reported as
		 * grey on the palettes that lost chroma and as a foreign colour on the ones that
		 * gained it. The mark is the panel's own colour now, and the step is lightness:
		 *
		 * AND IT IS BELOW THE FLOOR: ΔE00 2.20 is under the 2.5 every palette must hold.
		 * Hue-faithfully there is no value that reaches it — the row cannot rise further
		 * without putting this palette's own body ink under its floor, and buying it back
		 * on chroma or hue is the defect this round removes. It is on the NAMED LIST in
		 * `HIGHLIGHT_CAP_PINS` (`subFloor`), with its numbers, and the structural fix is the
		 * row-hover split rather than a louder mark here.
		 */
		highlight: "#F6EEE9",

		ink: "#4e4970",
		inkMuted: "#5B5573",
		inkDim: "#6C697A",
		inkDisabled: "#9893a5",

		hairline: "#E5DCD5",
		borderControl: "#91838c",

		accent: "#a15552",
		accentHover: "#8b4644",
		accentActive: "#743a38",
		// ΔE00 10.4 from `accent` and 7.8:1 on surface, where the accent is
		// 5.0:1 — the step goes deeper here, because on paper the plot ground is
		// above the mark.
		chartBarHover: "#803836",
		accentWash: "#fbece8",
		onAccent: "#fffaf3",

		// pine, canonical.
		success: "#286983",
		successWash: "#e4edf1",
		successBorder: "#5c8ba0",

		warning: "#995d00",
		warningWash: "#f6ead6",
		warningBorder: "#AA8546",

		danger: "#a1526a",
		dangerWash: "#fcebef",
		dangerBorder: "#B27C8D",

		// foam 56949f measures 3.1:1 on this paper; lifted to the floor and
		// pulled green to clear ΔE00 15 from pine. See the header.
		info: "#10746E",
		infoWash: "#e2eeef",
		infoBorder: "#599598",

		overlayShadow: "0 12px 32px -12px rgb(87 82 121 / 0.24)",
		scrim: "rgb(87 82 121 / 0.4)",
	},
};
