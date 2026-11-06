/**
 * Pure glass derivation shared by authored-theme tooling and live compositions.
 * A palette identity cannot tell us what alpha is safe: contrast and custom
 * colours move the very inks/grounds the floor was measured against. Keep the
 * material measurements and the solver identical on both sides of that boundary.
 */
import { deltaE } from "./theme-engine/color.mjs";

/** Measured composite grey of each macOS material tier over its worst backdrop. */
export const BACKDROP_GRAY = {
	"under-window": { dark: 81, light: 199 },
	menu: { dark: 102, light: 171 },
	popover: { dark: 122, light: 143 },
};

/** The roles that may go translucent. The rest stay opaque by design. */
export const GLASS_ROLES = ["canvas", "surface", "elevated"];

/** Every body ink is held to AA over glass; the system's own 7/5.5/5.0 floors apply to the flat roles. */
export const GLASS_INKS = ["ink", "inkMuted", "inkDim"];
export const GLASS_INK_FLOOR = 4.5;
/**
 * The structural edge keeps its 3:1 floor over glass (docs/branding.md § 3: the
 * sole boundary of an input or an outlined button), held against the ground
 * COMPOSITE - the role at its alpha over the worst measured backdrop - because
 * that is what the border is actually drawn against.
 *
 * IT IS NOT HELD BY RAISING THE GROUND ALPHA. Measured: it would force the dark
 * `elevated` ground to alpha 1.0 (`autumn`'s `borderControl` sits exactly on the
 * flat 3:1 floor, so ANY translucency under it breaks the floor), which switches
 * glass off for every dark pane. Instead, inside a glass region the border colour
 * itself is mixed toward `ink` by `controlMix` - the smallest constant, per
 * material tier and scheme, at which every palette's edge clears 3:1 against every
 * glass ground at ITS floor alpha over the worst backdrop. A border that is a
 * little stronger on glass costs nothing; a pane that is never translucent costs
 * the whole feature.
 */
export const GLASS_EDGE_FLOOR = 3;

/**
 * THE PANEL BOUNDARY'S OWN FLOOR, and why it is not `GLASS_EDGE_FLOOR`.
 *
 * The 3:1 floor is the app's STRUCTURAL edge - the sole boundary of an input or an
 * outlined button, drawn in `borderControl`. A floating panel's hairline is not that
 * element: across the palette table the design system's own strongest divider,
 * `hairlineStrong` against `elevated`, measures 1.22-1.41:1 on the dark palettes and
 * 1.86-2.24 on the light ones, and its ordinary hairline 1.15-1.31 / 1.37-1.74.
 * Holding the panel edge at 3:1 would paint every menu with a line stronger than any
 * border this app ships - a third kind of edge, invented to settle a fill-step
 * argument.
 *
 * 1.5 IS THE CONVENTION FOR TWO ADJACENT SURFACES STILL READING AS TWO (the same
 * order as WCAG's 3:1 for a component boundary, applied one step down because this
 * is a plate's edge and not a control's).
 *
 * WHERE THE DERIVED EDGE ACTUALLY LANDS, per scheme, because one sentence covered
 * both and only the dark half was true (agent review round 4, N4-2): 1.57:1 in both
 * schemes, which is ABOVE the whole dark band - the dark `hairlineStrong` tops out
 * at 1.41 - and in the light scheme between the ordinary hairline's band and
 * `hairlineStrong`'s (1.57 against 1.86-2.24). So the claim is: on the states where
 * the fill step collapsed, the dark panels get an edge stronger than any divider
 * this system ships, and the light panels get one stronger than their ordinary
 * hairline though not as strong as their strongest divider. More than the shadow's
 * alone in both, which is what D2 asked for.
 */
export const GLASS_OVERLAY_EDGE_FLOOR = 1.5;

/**
 * THE SEMANTIC REGISTERS THE FLOATING LAYER CARRIES AS TEXT, and the reason they
 * are not simply `GLASS_INKS`.
 *
 * `ink`/`inkMuted` are the panel's body inks; these five are the palette's meaning
 * colours, and they render as text on a marked panel exactly as the body inks do:
 * a destructive menu item is `text-danger` (`dropdown-menu.tsx`, `context-menu.tsx`),
 * a link in a search result or a changelog entry is `text-accent`
 * (`settings-search.tsx`, `update-notification.tsx`). The flat contract already
 * floors every one of them at 4.5:1 as an ink (`theme-engine/contrast.mjs`), so on
 * a floating panel they are held to the same floor rather than treated as
 * decoration.
 *
 * THEY ARE NOT IN `deriveOverlayFloor`'s SOLVER, and that is deliberate: see
 * `deriveOverlayInkMix` for the measurement that ruled the fill out.
 *
 * `accent` IS THE ONE THAT IS NOT HERE, although it is text on the same layer. It is
 * the palette's only dual-use role - an ink and the primary action's fill - so a
 * subtree rebind would recolour 165 `bg-accent` sites inside a panel, every primary
 * button face among them. Its text case is deferred on the PR with the measurement;
 * `scripts/contrast-contract.mjs` reports it and does not claim it.
 */
export const GLASS_OVERLAY_INKS = ["danger", "success", "warning", "info"];

/**
 * STATES AND FIELDS ARE AN INK OVERLAY ON THE GLASS, not the palette's opaque tint.
 *
 * The palette's `rowHover` / `rowSelected` are flat tints authored to sit on an
 * OPAQUE `surface` or `canvas`. Painted opaque inside a see-through column they are
 * holes (the cream "New chat" pill); painted at the alpha that keeps the stack AA
 * they are either solid again (derived: 0.96-1.0 on dark palettes) or invisible.
 * So on glass a state is the palette's own `ink` at a small fixed alpha OVER the
 * glass: a step that reads on every backdrop because it is relative to whatever
 * the ground already is (lighter on a dark theme, darker on a light one), the way
 * the OS itself draws a selection on a vibrant sidebar.
 *
 * The three alphas are chosen so the step clears `GLASS_STATE_STEP` (ΔE00) off the
 * ground on every palette, and the ground floors below are derived WITH the
 * overlay in the stack (an overlay of ink lowers ink's own contrast, so the grounds
 * must be a little more opaque than text alone needs). Hover is the quietest step;
 * selected is deliberately about 1.7x it so the two never read as one; a field's
 * fill matches hover, with its `border-control` carrying the boundary.
 */
export const GLASS_STATE_ALPHA = {
	hover: 0.05,
	selected: 0.08,
	field: 0.05,
	/*
	 * A RUNNING TOOL ROW is the row that is the subject right now, which is the
	 * same claim a selected row makes; the two cannot co-occur, and asserting a
	 * second, separately-tuned alpha would be two constants for one idea. The
	 * alias is printed into the floors table so the renderer paints it from the
	 * same published value, and a future divergence is a one-line derivation here
	 * rather than a hand-tuned CSS number.
	 */
	work: 0.08,
};
/**
 * The block veil's step off the canvas glass.
 *
 * A BLOCK is text-bearing content whose fill was its ONLY boundary on the flat
 * system (the user message bubble: `messageSurface`, floored at ΔE00 4.0 off
 * canvas; project cards, hub cards). On glass the flat role has no usable
 * answer: `messageSurface` itself measures 0.77 dark / 0.46 light as an alpha
 * floor and collapses to ΔE00 0.9-1.2 off the canvas on rosewood/oneLight/
 * iceberg - a bubble that vanishes. So the block's fill becomes a RELATIVE
 * overlay: the palette's `ink` at the smallest alpha that still steps ΔE00 4.0
 * off the canvas glass at ITS floor, over the worst measured backdrop. Like a
 * state overlay it does not scale with the slider (the ground beneath moves, the
 * step stays >= 4.0), and it is painted once: a well never sits under a veiled
 * block (`docs/branding.md`, the alpha-owning law).
 */
export const GLASS_BLOCK_VEIL_STEP = 4.0;
export const GLASS_STATE_STEP = { hover: 1.5, selected: 2.5, field: 1.5 };

/**
 * A LANE IS A WELL THAT MUST READ ON A TRANSLUCENT PAGE, and it cannot be an ink
 * overlay the way a field or a track is.
 *
 * WHY NOT INK. A lane sits UNDER text-bearing blocks (the Projects board's cards),
 * and the block veil is already an ink layer over the ground. Ink 5% under a veil
 * measured `inkMuted` 4.03:1 on synthwave (the stack the veil's note forbids) - the
 * card's own text is the thing a lane would spend. So a lane is a palette ROLE at an
 * alpha over the page's canvas glass. It composes and leaves the veil as the only
 * ink layer under the card.
 *
 * THE ALPHA TRACKS THE SLIDER. Review round 1 (F2) measured the failure of a fixed
 * wash: the page moved `0.66 -> 0.96` with intensity while the lane stayed at one
 * alpha, and the step fell to ΔE00 0.59 on dark at 25 and 0.99 on light at 0 - the
 * lane vanished exactly where the window was most opaque. The lane therefore takes a
 * SCALE of the page's own alpha (`pageAlpha * scale`), so it converges on the flat
 * role at the opaque end and keeps the same share of the ground's translucency at
 * the clear end. ONE constant per scheme, but the family is derived at EVERY slider
 * position (0..100) and every material tier, and the committed scale is the max the
 * worst position needs.
 *
 * THE ROLE IS DERIVED TOO, because a single role cannot carry both schemes: at the
 * opaque end the page is nearly the canvas colour, so the lane can only step as far
 * as the role's own distance from `canvas` allows. Dark `surface` is ΔE00 1.3-1.6
 * off `canvas` on several palettes and cannot clear at any alpha; dark `sunken`
 * can. Light `sunken` is equally close to `canvas`; light `surface` can. The wash
 * therefore recesses on dark and lifts on light - the direction that moves AWAY from
 * the material tone the page composites toward. Derived, never hand-picked.
 */
export const GLASS_LANE_STEP = 1.5;
/**
 * Mirrors `GLASS_ALPHA_CEILING` in `src/shared/window-glass.ts`. This script has no
 * build step and cannot import the TypeScript module, so `window-glass.test.mjs`
 * (G-7c) asserts the mirror: a change that is not carried here fails the suite
 * rather than silently moving the derivation.
 */
export const LANE_ALPHA_CEILING = 0.96;
/** The roles the derivation may choose between, in preference order. */
export const LANE_ROLES = ["sunken", "surface"];

/**
 * THE ONE RELAXATION, stated: `inkDim` (captions, metadata, placeholders) is held to
 * 3.5:1, not 4.5:1, on a hovered or selected row and on a field's fill over glass.
 * `ink` and `inkMuted` keep AA. Measured: no ink-overlay state can keep `inkDim` at
 * 4.5:1 - the flat system already ships `inkDim` at its 5.0 floor on `rowSelected`,
 * and ANY lightening of a dark ground (or darkening of a light one) spends that
 * margin - so holding it would force every dark ground to alpha 1.0 and switch glass
 * off. 3.5:1 clears the 3:1 non-text floor with headroom and costs ~0.07 of ground
 * alpha, which is the price of states that are visible instead of holes.
 */
export const GLASS_STATE_DIM_FLOOR = 3.5;

const lum = (hex) => {
	const h = hex.replace("#", "");
	const full =
		h.length === 3
			? h
					.split("")
					.map((c) => c + c)
					.join("")
			: h.slice(0, 6);
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
const channel = (hex, i) =>
	Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
export const gray = (n) => `#${n.toString(16).padStart(2, "0").repeat(3)}`;
/** `fg` at alpha `a` over `bg`, both opaque hex: the flat colour a reader sees. */
export const composite = (fg, a, bg) =>
	`#${[0, 1, 2]
		.map((i) =>
			Math.round(channel(fg, i) * a + channel(bg, i) * (1 - a))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

/** A palette is dark when its canvas is: the same split the contract uses. */
export const schemeOf = (palette) =>
	lum(palette.canvas) < 0.18 ? "dark" : "light";

/** The smallest alpha, in 0.01 steps, at which `ink` clears the floor on `role` over `backdrop`. */
export const minAlpha = (palette, role, ink, backdrop) => {
	for (let a = 0.2; a <= 1.0001; a += 0.01) {
		if (
			ratio(palette[ink], composite(palette[role], a, backdrop)) >=
			GLASS_INK_FLOOR
		)
			return Math.round(a * 100) / 100;
	}
	return 1;
};

/** As `minAlpha`, with the ink overlay `state` stacked on the ground composite. */
export const minAlphaUnder = (palette, role, ink, backdrop, state) => {
	for (let a = 0.2; a <= 1.0001; a += 0.01) {
		const ground = composite(palette[role], a, backdrop);
		if (
			ratio(palette[ink], composite(palette.ink, state, ground)) >=
			(ink === "inkDim" ? GLASS_STATE_DIM_FLOOR : GLASS_INK_FLOOR)
		)
			return Math.round(a * 100) / 100;
	}
	return 1;
};

/** The smallest alpha at which the structural edge clears 3:1 against `role` over `backdrop`. */
export const minEdgeAlpha = (palette, role, backdrop) => {
	for (let a = 0.2; a <= 1.0001; a += 0.01) {
		if (
			ratio(palette.borderControl, composite(palette[role], a, backdrop)) >=
			GLASS_EDGE_FLOOR
		)
			return Math.round(a * 100) / 100;
	}
	return 1;
};

/** `ink` at `mix` over `borderControl`: the edge colour the glass regions paint. */
export const glassEdge = (palette, mix) =>
	composite(palette.ink, mix, palette.borderControl);

/**
 * The block veil: the smallest ink alpha clearing `GLASS_BLOCK_VEIL_STEP` off
 * the canvas glass at its committed floor, max over palettes per scheme.
 *
 * ONE CONSTANT PER SCHEME, not per material tier: the veil is relative to the
 * ground it sits on, and the ground already carries the tier's floor. Measured
 * minimum steps at the derived values: dark 4.27 (solarizedDark), light 4.20
 * (ayuLight) - the palettes the note names as binding.
 */
export function deriveBlockVeil(floors, palettes) {
	const out = {};
	for (const scheme of ["dark", "light"]) {
		let need = 0;
		for (const tier of Object.keys(BACKDROP_GRAY)) {
			for (const { palette } of palettes) {
				if (schemeOf(palette) !== scheme) continue;
				const ground = composite(
					palette.canvas,
					floors[tier][scheme].canvas,
					gray(BACKDROP_GRAY[tier][scheme]),
				);
				let a = 0.01;
				while (
					a < 1 &&
					deltaE(composite(palette.ink, a, ground), ground) <
						GLASS_BLOCK_VEIL_STEP
				)
					a = Math.round((a + 0.01) * 100) / 100;
				need = Math.max(need, a);
			}
		}
		/* The exact smallest clearing alpha, like `minAlpha`: the contract asserts
		 * it at the committed value, so headroom here would be a number nobody
		 * derived. */
		out[scheme] = Math.round(need * 100) / 100;
	}
	return out;
}

/**
 * The lane's role and the scale of the page alpha it is painted at, per scheme.
 *
 * For every candidate role and every slider position and material tier, the
 * smallest alpha that clears `GLASS_LANE_STEP` off the page composite is found; a
 * role is feasible only if such an alpha exists at every position (at the opaque
 * end it may not: see the note above). The committed scale is the largest ratio of
 * the needed alpha to the page's own alpha, rounded UP to 0.01 - the one constant
 * the whole family is multiplied by. Rounding up covers every position; the
 * contract then asserts the exact shipped composite at each one.
 */
export function deriveLaneWash(floors, palettes) {
	const positions = Array.from({ length: 101 }, (_, i) => i);
	const pageAlpha = (floor, intensity) =>
		Math.round(
			(LANE_ALPHA_CEILING - (intensity / 100) * (LANE_ALPHA_CEILING - floor)) *
				100,
		) / 100;
	/* The smallest alpha clearing the floor on every palette for one tier and
	 * position, or null when no alpha can (the role is too close to the canvas). */
	const needAt = (role, scheme, intensity, tier) => {
		for (let a = 0.05; a <= 1.0001; a = Math.round((a + 0.01) * 100) / 100) {
			let clears = true;
			for (const { palette } of palettes) {
				if (schemeOf(palette) !== scheme) continue;
				const page = composite(
					palette.canvas,
					pageAlpha(floors[tier][scheme].canvas, intensity),
					gray(BACKDROP_GRAY[tier][scheme]),
				);
				if (deltaE(composite(palette[role], a, page), page) < GLASS_LANE_STEP) {
					clears = false;
					break;
				}
			}
			if (clears) return a;
		}
		return null;
	};
	const out = {};
	for (const scheme of ["dark", "light"]) {
		let best = null;
		for (const role of LANE_ROLES) {
			let scale = 0;
			let feasible = true;
			for (const tier of Object.keys(BACKDROP_GRAY)) {
				for (const intensity of positions) {
					const need = needAt(role, scheme, intensity, tier);
					if (need === null) {
						feasible = false;
						break;
					}
					scale = Math.max(
						scale,
						need / pageAlpha(floors[tier][scheme].canvas, intensity),
					);
				}
				if (!feasible) break;
			}
			if (!feasible) continue;
			/* Round up, then bump until the RUNTIME rounding (2dp of `pageAlpha *
			 * scale`, exactly what `glassPaintFor` publishes) clears at every position. */
			let committed = Math.ceil(scale * 100) / 100;
			for (;;) {
				let clears = true;
				for (const tier of Object.keys(BACKDROP_GRAY)) {
					for (const intensity of positions) {
						const a =
							Math.round(
								pageAlpha(floors[tier][scheme].canvas, intensity) *
									committed *
									100,
							) / 100;
						if (a < needAt(role, scheme, intensity, tier)) {
							clears = false;
							break;
						}
					}
					if (!clears) break;
				}
				if (clears) break;
				committed = Math.round((committed + 0.01) * 100) / 100;
			}
			const candidate = { role, scale: committed };
			if (best === null || candidate.scale < best.scale) best = candidate;
		}
		if (best === null)
			throw new Error(
				`no lane role clears ΔE00 ${GLASS_LANE_STEP} on ${scheme} at every slider position`,
			);
		out[scheme] = best;
	}
	return out;
}

export function derive(palettes, stateAlpha = GLASS_STATE_ALPHA) {
	const out = {};
	for (const [tier, byScheme] of Object.entries(BACKDROP_GRAY)) {
		out[tier] = {};
		for (const scheme of ["dark", "light"]) {
			out[tier][scheme] = {};
			for (const role of GLASS_ROLES) {
				let worst = 0;
				for (const { palette } of palettes) {
					if (schemeOf(palette) !== scheme) continue;
					for (const ink of GLASS_INKS)
						worst = Math.max(
							worst,
							minAlpha(palette, role, ink, gray(byScheme[scheme])),
							...Object.values(stateAlpha).map((s) =>
								minAlphaUnder(palette, role, ink, gray(byScheme[scheme]), s),
							),
						);
				}
				// Two steps of headroom over the measured worst palette: the backdrop
				// grey is a measurement of three materials over two flat desktops,
				// and a real wallpaper is neither.
				out[tier][scheme][role] = Math.min(
					1,
					Math.round((worst + 0.02) * 100) / 100,
				);
			}
		}
	}
	return out;
}

/**
 * THE ISOLATING BAND'S OWN ALPHA FLOOR, per scheme.
 *
 * A BAND is a strip that masks what scrolls under it, and the ordinary bands
 * (`data-glass-plane="band"`) sit on a STATIC ground - the pane's own fill -
 * so the pane's published alpha is right for them. An ISOLATING BAND
 * (`data-glass-plane="band-backdrop"`) sits over MOVING content, and that
 * changes the question: its ground is whatever happens to be scrolling under
 * it, so the alpha that keeps the band readable is not the ground's alpha but
 * the alpha at which the INK ON IT still clears its floor over the worst
 * content that can pass beneath.
 *
 * THE FLOOR IS DERIVED, NOT CHOSEN. For each palette in the scheme, the
 * smallest alpha at which the band's own role holds the count's ink over the
 * worst content colour clears the 4.5 text floor, and the scheme's floor is
 * the largest of those. The worst content is the extreme the scheme's ink
 * contrasts against: a WHITE thumbnail under a dark band, a BLACK one under a
 * light band. A content colour in between is easier, not harder, so the
 * extremes bound it.
 *
 * The floor is per SCHEME and not per tier because the band is a pane's strip
 * and the pane is under the window; and it is derived against the count's ink
 * (`inkMuted`, the register the app's own section headers use beside a label)
 * rather than the strongest ink, because the count is the band's own text and
 * a band whose count cannot be read is a band that has failed at being one.
 */
export function deriveBandFloor(palettes) {
	const out = {};
	for (const scheme of ["dark", "light"]) {
		let need = 0;
		for (const { palette } of palettes) {
			if (schemeOf(palette) !== scheme) continue;
			/* The worst content colour: the extreme the ink contrasts against. */
			const backdrop = scheme === "dark" ? "#ffffff" : "#000000";
			const a = minAlpha(palette, "elevated", "inkMuted", backdrop);
			need = Math.max(need, a);
		}
		out[scheme] = Math.round(need * 100) / 100;
	}
	return out;
}

/**
 * THE FLOATING OVERLAY'S OWN ALPHA FLOOR, per scheme.
 *
 * A PORTAL is not a column. A menu, tooltip, popover, dialog, select or sheet is
 * painted at the document root by Radix, so no `data-glass-region` ancestor
 * describes it: whatever the anchor floats over is its backdrop, and that backdrop
 * is arbitrary. The same question the isolating band answers has to be answered
 * here, with one difference that matters - a portal always floats over SOMETHING THE
 * APP PAINTED, never over the raw desktop, so the layer beneath it contributes its
 * own alpha and the panel's alpha does not have to carry the whole job.
 *
 * WHY THIS IS NOT THE BAND'S FLOOR. The band is a strip in a column whose own fill
 * it replaces, so it is measured as if it stood on the desktop alone. A portal sits
 * ON TOP of that column, so that rung's own alpha would land near-opaque: the
 * elevated floor is 0.68 on the dark palettes and the least opaque column's `canvas`
 * is 0.53, and 0.68 over 0.53 composes to 0.85 (0.45 over 0.61 is 0.79 on the light
 * ones) - the opaque plate the operator reported.
 *
 * Derived against the layer beneath it, the smallest alpha that still holds the
 * floor is materially lower, so the panel is genuinely translucent AND readable -
 * the whole request, rather than a re-paint of the same opacity under a new name.
 *
 * THE BACKING IS THE LEAST OPAQUE THE APP CAN PRESENT: the smallest `canvas` floor
 * across the material tiers. A denser backing is easier (it contributes more), so
 * the clearest column the app can draw is the worst case and bounds the rest. The
 * desktop behind it is the scheme's extreme - a white thumbnail under a dark panel,
 * a black one under a light panel - for the band's reason: an intermediate content
 * colour is easier, never harder.
 *
 * THE INKS ARE `ink` AND `inkMuted`, the two registers a portal carries its own text
 * in (a release-detail paragraph, a menu item). Both are measured rather than taking
 * the stronger one as a bound, because which of the two is stricter is not obvious
 * once the ground is a composite; the contract asserts both over every palette.
 *
 * AND THE THIRD REGISTER NEEDS NO THIRD MEASUREMENT: `inkDim` carries real panel text
 * (a menu label, an item's shortcut, a select's group heading), and on this composite
 * it lands at 3.62:1 dark / 3.59:1 light at the floor - under the 4.5 text floor on
 * 57 of the 59 palettes, where the opaque `elevated` plate it replaces read
 * 5.48-7.94:1. Holding it here would take the panel to alpha 0.86 dark / 0.71 light -
 * denser than the `elevated` rung's own floor (0.68 / 0.45) and a step under the
 * band's (0.88 / 0.78), i.e. more opaque than the plate it replaces, which is the
 * slab this row exists to remove. So the panel rebinds `--color-ink-dim` to
 * `--color-ink-muted` on glass (the floating-layer rule in `index.css`) and its dim
 * rows render in the muted ink: the hierarchy deliberately collapses inside a
 * floating panel, and the pair that survives is the one that still clears AA. That
 * is why the ink set here is two roles, not three.
 *
 * A HIGHLIGHTED ROW IS NOT A STACK ON THIS FLOOR. A menu row's `accentWash` is an
 * OPAQUE palette role that replaces the panel's ground for that row, so it is
 * measured as its own fill (the flat contract's `accentWash` rows) and never as an
 * ink overlay on top of the alpha here - which is what keeps keyboard navigation
 * legible at every slider position.
 */
/** The least opaque column the app can draw under a floating panel: the floor's own
 * worst case, in one place so the floor, the ink mix and the edge mix cannot drift. */
export function overlayBacking(floors, scheme) {
	let backing = 1;
	for (const tier of Object.keys(floors))
		backing = Math.min(backing, floors[tier][scheme]?.canvas ?? 1);
	return backing;
}

/** The ground a floating panel paints: `elevated` at `alpha` over the clearest
 * column, which is itself over the scheme's extreme desktop. */
export function overlayGround(palette, alpha, floors, scheme) {
	const backdrop = scheme === "dark" ? "#ffffff" : "#000000";
	return composite(
		palette.elevated,
		alpha,
		composite(palette.canvas, overlayBacking(floors, scheme), backdrop),
	);
}

export function deriveOverlayFloor(palettes, floors) {
	const out = {};
	for (const scheme of ["dark", "light"]) {
		/* The least opaque column the app can draw under the portal. */
		const backing = overlayBacking(floors, scheme);
		/* The extreme the ink contrasts against, as in `deriveBandFloor`. */
		const backdrop = scheme === "dark" ? "#ffffff" : "#000000";
		let need = 0;
		for (const { palette } of palettes) {
			if (schemeOf(palette) !== scheme) continue;
			const beneath = composite(palette.canvas, backing, backdrop);
			for (const ink of ["inkMuted", "ink"]) {
				let a = 0.2;
				for (; a <= 1.0001; a += 0.01) {
					if (
						ratio(palette[ink], composite(palette.elevated, a, beneath)) >=
						GLASS_INK_FLOOR
					)
						break;
				}
				need = Math.max(need, Math.round(Math.min(a, 1) * 100) / 100);
			}
		}
		out[scheme] = Math.round(need * 100) / 100;
	}
	return out;
}

/**
 * THE SEMANTIC INKS' OWN MIX ON THE FLOATING LAYER, per scheme.
 *
 * THE MEASUREMENT THAT RULED OUT THE COLUMN AFFAIR. The obvious answer is the one
 * the dim ink got: put the semantic inks in `deriveOverlayFloor`'s set and let the
 * floor rise until they pass. It does not survive the numbers. Every meaning colour
 * sits in the middle of the lightness range - it has to, or it would stop reading as
 * that colour - and the floating panel's ground does not: over the palette's own
 * dark ground the panel is dark, over the extreme backdrop (a white one behind a
 * dark theme, a black one behind a light one) it rises to the middle of the range,
 * and a mid-tone ink on a mid-tone ground is the one combination no opacity can fix
 * from above. Solving it gives a floor of 1.00 for the light half of the palette
 * table's registers and 0.82 for the light scheme, i.e. the panel stops being a
 * material at all - the slab this section exists to remove, arrived at from the
 * other end.
 *
 * SO THE TRADE IS AT THE INK AGAIN, the one `ink-dim` already makes: each meaning
 * colour is mixed toward `ink` by the smallest constant that holds 4.5:1 on the
 * panel at the floor, over every palette of the scheme. The hue survives; the
 * saturation and the lightness move to whichever pole the ground can carry. That
 * is the same move the flat system makes when it steps `borderControl` toward ink,
 * and it is the move a translucent surface has to make: on glass the semantic
 * register loses its vivid end, exactly as the dim register loses its step.
 *
 * THE COST IS STATED RATHER THAN HIDDEN: this is one constant applied to the whole
 * panel subtree, so a destructive item is quieter on glass than on the opaque plate
 * even where the ground would have carried the authored red (a dark panel over a
 * dark desktop). A rebind cannot be conditioned on the backdrop - CSS has no such
 * query - and the alternative is a sub-AA destructive label on the states that do
 * occur. Quiet everywhere beats illegible somewhere.
 *
 * DERIVED AGAINST THE FLOOR, not the default: the slider's floor is where the
 * ground is clearest and the ink is worst, and every denser position is easier.
 */
export function deriveOverlayInkMix(palettes, floors, overlayFloor) {
	const out = {};
	for (const scheme of ["dark", "light"]) {
		let need = 0;
		for (const { palette } of palettes) {
			if (schemeOf(palette) !== scheme) continue;
			const ground = overlayGround(
				palette,
				overlayFloor[scheme],
				floors,
				scheme,
			);
			for (const role of GLASS_OVERLAY_INKS) {
				let m = 0;
				/* 0.05 steps, the same granularity as `deriveControlMix`. */
				for (; m <= 1.0001; m += 0.05)
					if (
						ratio(composite(palette.ink, m, palette[role]), ground) >=
						GLASS_INK_FLOOR
					)
						break;
				need = Math.max(need, Math.round(Math.min(m, 1) * 100) / 100);
			}
		}
		out[scheme] = Math.round(need * 100) / 100;
	}
	return out;
}

/**
 * THE PANEL'S EDGE: the hairline stepped toward `ink` until the boundary does not
 * rest on the shadow alone (design round 1, D2).
 *
 * WHY THE FILL CANNOT DO THIS JOB. The floating layer's separation used to be its
 * fill step against the column under it, and measured over the model's under-window
 * grey that step is -2.2 L* in the dark scheme and +1.4..+2.1 over white in the
 * light one: below the threshold where a fill step reads as a step, and inverted on
 * a mid-tone desktop in dark. It cannot be repaired by raising the alpha either,
 * because the step is relative to an arbitrary backdrop: a denser panel converges on
 * the `elevated` ROLE, and in the dark palettes that role is DARKER than the column
 * it floats over - `elevated` (47,42,31) against `surface` (49,48,45) - so no opacity
 * puts the panel above the column it came from.
 *
 * WHAT ACTUALLY SEPARATES A PLATE is its edge, and the edge on a marked panel was
 * the hairline landing on the panel's own fill: 1.03:1 dark / 1.18:1 light against
 * it, i.e. no boundary of its own. Stepping the hairline toward `ink` by a derived
 * constant gives every panel a 1px line that clears the 3:1 structural floor against
 * its own ground - the same floor `controlMix` holds for a control's edge, applied
 * to the boundary that now carries the layer instead of the fill step.
 *
 * DERIVED AGAINST THE TWO ENDS THE CONTRACT MEASURES - the default 80 and the
 * floor - and not against intensity 0. At 0 the panel is 0.96 and already reads as
 * the opaque plate whose hairline the design system ships today (1.19:1 dark /
 * 1.44:1 light against that ground, accepted there and unchanged by this row); the
 * edge exists to carry the states where the panel has actually become a material.
 */
export function deriveOverlayEdgeMix(palettes, floors, overlayFloor) {
	const out = {};
	for (const scheme of ["dark", "light"]) {
		const floor = overlayFloor[scheme];
		/* `LANE_ALPHA_CEILING` is the veil ceiling this module owns (the same 0.96
		 * `GLASS_ALPHA_CEILING` mirrors in `window-glass.ts`); it is the alpha at
		 * slider 0, which is where every overlay's ramp starts. */
		const top = Math.max(LANE_ALPHA_CEILING, floor);
		/* The default first, then maximum transparency: the rule's own arithmetic. */
		const alphas = [Math.round((top - 0.8 * (top - floor)) * 100) / 100, floor];
		let need = 0;
		for (const { palette } of palettes) {
			if (schemeOf(palette) !== scheme) continue;
			for (const alpha of alphas) {
				const ground = overlayGround(palette, alpha, floors, scheme);
				let m = 0;
				for (; m <= 1.0001; m += 0.05)
					if (
						ratio(composite(palette.ink, m, palette.hairline), ground) >=
						GLASS_OVERLAY_EDGE_FLOOR
					)
						break;
				need = Math.max(need, Math.round(Math.min(m, 1) * 100) / 100);
			}
		}
		out[scheme] = Math.round(need * 100) / 100;
	}
	return out;
}

/** The smallest border->ink mix (0.05 steps) that holds 3:1 on every ground at its floor. */
export function deriveControlMix(floors, palettes) {
	const out = {};
	for (const [tier, byScheme] of Object.entries(BACKDROP_GRAY)) {
		out[tier] = {};
		for (const scheme of ["dark", "light"]) {
			let need = 0;
			for (const { palette } of palettes) {
				if (schemeOf(palette) !== scheme) continue;
				for (const role of GLASS_ROLES) {
					const ground = composite(
						palette[role],
						floors[tier][scheme][role],
						gray(byScheme[scheme]),
					);
					let m = 0;
					while (
						m < 1 &&
						ratio(glassEdge(palette, m), ground) < GLASS_EDGE_FLOOR
					)
						m = Math.round((m + 0.05) * 100) / 100;
					need = Math.max(need, m);
				}
			}
			out[tier][scheme] = Math.min(1, Math.round((need + 0.05) * 100) / 100);
		}
	}
	return out;
}

/** A bounded value cache: live slider revisits must not solve the same palette
 * twice. Key the colour values, never a generated ID or a single accent role. */
const paletteTables = new Map();

/** State overlays spend contrast too. A softer composed elevated ground can
 * make the authored 8% selection impossible even at alpha 1 (Dracula Soft:
 * inkMuted 4.479:1). Clamp the OVERLAY, not the user's material or opacity, to
 * the strongest step whose text still holds with a translucent ground. The
 * same floor solver then derives the ground with its measured 0.02 headroom.
 * Values remain published paint inputs, so the contract can test the actual
 * state, rather than declaring an impossible alpha=1 result safe. */
export function glassStateAlphas(palette) {
	const scheme = schemeOf(palette);
	const safe = (alpha) =>
		Object.values(BACKDROP_GRAY).every((tier) =>
			GLASS_ROLES.every((role) =>
				GLASS_INKS.every(
					(ink) =>
						minAlphaUnder(palette, role, ink, gray(tier[scheme]), alpha) <=
						0.95,
				),
			),
		);
	return Object.fromEntries(
		Object.entries(GLASS_STATE_ALPHA).map(([state, desired]) => {
			let alpha = desired;
			while (alpha > 0.01 && !safe(alpha))
				alpha = Math.round((alpha - 0.01) * 100) / 100;
			return [state, alpha];
		}),
	);
}
/** A per-palette minimum has no fleet headroom: quantisation can make the
 * block step dip between its floor and the frosted end. Verify every published
 * slider alpha, not just the floor sample used by the authored fleet table. */
function composedBlockVeil(palette, floors) {
	const scheme = schemeOf(palette);
	let alpha = deriveBlockVeil(floors, [{ palette }])[scheme];
	const clears = () =>
		Object.entries(BACKDROP_GRAY).every(([tier, tones]) =>
			Array.from({ length: 101 }, (_, intensity) => {
				const floor = floors[tier][scheme].canvas;
				const top = Math.max(LANE_ALPHA_CEILING, floor);
				const pageAlpha =
					Math.round((top - (intensity / 100) * (top - floor)) * 100) / 100;
				const ground = composite(
					palette.canvas,
					pageAlpha,
					gray(tones[scheme]),
				);
				return (
					deltaE(composite(palette.ink, alpha, ground), ground) >=
					GLASS_BLOCK_VEIL_STEP
				);
			}).every(Boolean),
		);
	while (alpha < 1 && !clears()) alpha = Math.round((alpha + 0.01) * 100) / 100;
	return { dark: 0, light: 0, [scheme]: alpha };
}
/** Unlike a threshold comparison, testing the final quantised colour catches
 * a one-step Delta-E dip after the first passing alpha. This is the slider the
 * renderer publishes, not an assumption that perceptibility is monotone. */
function composedLaneWash(palette, floors) {
	const scheme = schemeOf(palette);
	for (const role of LANE_ROLES) {
		for (let hundredths = 5; hundredths <= 104; hundredths++) {
			const scale = hundredths / 100;
			const clears = Object.entries(BACKDROP_GRAY).every(([tier, tones]) =>
				Array.from({ length: 101 }, (_, intensity) => {
					const floor = floors[tier][scheme].canvas;
					const top = Math.max(LANE_ALPHA_CEILING, floor);
					const pageAlpha =
						Math.round((top - (intensity / 100) * (top - floor)) * 100) / 100;
					const laneAlpha = Math.round(pageAlpha * scale * 100) / 100;
					if (laneAlpha > 1) return false;
					const ground = composite(
						palette.canvas,
						pageAlpha,
						gray(tones[scheme]),
					);
					return (
						deltaE(composite(palette[role], laneAlpha, ground), ground) >=
						GLASS_LANE_STEP
					);
				}).every(Boolean),
			);
			if (clears) return { dark: { role, scale }, light: { role, scale } };
		}
	}
	/* This is a candidate search, not a palette-validity verdict. A legible
	 * canvas may still be too transparent for either lane role to separate from
	 * it (Mint Light Soft, Linen Gentle). Let the joint solver move that ground
	 * and re-solve its dependent veil instead of throwing through React paint. */
	return null;
}

/** The block veil is a second ink overlay on CANVAS only. Solve its text floor
 * jointly with its visible step: applying the elevated selection clamp to it
 * would solve the wrong surface, and measuring only the bare canvas misses it. */
function composedBlockFloors(palette, floors) {
	const scheme = schemeOf(palette);
	for (;;) {
		const veil = composedBlockVeil(palette, floors);
		let changed = false;
		for (const [tier, tones] of Object.entries(BACKDROP_GRAY)) {
			const need = Math.min(
				1,
				Math.round(
					(Math.max(
						...GLASS_INKS.map((ink) =>
							minAlphaUnder(
								palette,
								"canvas",
								ink,
								gray(tones[scheme]),
								veil[scheme],
							),
						),
					) +
						0.02) *
						100,
				) / 100,
			);
			if (need > floors[tier][scheme].canvas) {
				floors[tier][scheme].canvas = need;
				changed = true;
			}
		}
		if (!changed) return veil;
	}
}

export function glassFloorsForPalette(palette) {
	const key = JSON.stringify(palette);
	const hit = paletteTables.get(key);
	if (hit) return hit;
	const palettes = [{ palette }];
	const stateAlpha = glassStateAlphas(palette);
	const alphaFloor = derive(palettes, stateAlpha);
	let blockVeil;
	let laneWash;
	/* Text gives a LOWER bound on canvas opacity, not a complete solution for
	 * a lane drawn above it. Search the remaining transparent canvas grounds in
	 * published 0.01 steps, re-solving the veil on each candidate. Accepted
	 * palette roles keep their flat separation; moving toward that ground makes
	 * the lane feasible without lowering its Delta-E floor, changing colours,
	 * or disabling native glass. Unchanged feasible palettes stop immediately.
	 * The complete supported-palette/accent matrix pins this totality contract. */
	for (let minimum = 0; minimum <= 99; minimum++) {
		let changed = false;
		for (const tier of Object.keys(BACKDROP_GRAY)) {
			const scheme = schemeOf(palette);
			const current = alphaFloor[tier][scheme].canvas;
			const candidate = Math.max(current, minimum / 100);
			changed ||= candidate !== current;
			alphaFloor[tier][scheme].canvas = candidate;
		}
		if (minimum > 0 && !changed) continue;
		blockVeil = composedBlockFloors(palette, alphaFloor);
		laneWash = composedLaneWash(palette, alphaFloor);
		if (laneWash) break;
	}
	if (!laneWash)
		throw new Error("palette roles cannot form a readable transparent lane");
	/* AFTER the lane's canvas search, not before: raising a canvas floor moves the
	 * least opaque column the panel composites onto, and the floating layer's floor
	 * (and the two mixes derived from it) must answer the column the app presents. */
	const overlayFloor = deriveOverlayFloor(palettes, alphaFloor);
	const table = {
		alphaFloor,
		blockVeil,
		laneWash,
		controlMix: deriveControlMix(alphaFloor, palettes),
		bandFloor: deriveBandFloor(palettes),
		overlayFloor,
		overlayInkMix: deriveOverlayInkMix(palettes, alphaFloor, overlayFloor),
		overlayEdgeMix: deriveOverlayEdgeMix(palettes, alphaFloor, overlayFloor),
		stateAlpha,
	};
	paletteTables.set(key, table);
	if (paletteTables.size > 8)
		paletteTables.delete(paletteTables.keys().next().value);
	return table;
}
