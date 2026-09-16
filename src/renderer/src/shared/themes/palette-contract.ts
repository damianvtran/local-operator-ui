/**
 * The palette role contract.
 *
 * Every theme in this app supplies one `ThemePalette` and nothing else. All
 * non-colour decisions — type scale, spacing, radii, motion, component
 * anatomy — live once in `createBaseTheme` and in the Tailwind `@theme` block,
 * never in a theme file.
 *
 * ## Why this exists
 *
 * Before this contract, each of the twelve themes was a standalone
 * `createTheme()` of 209–252 lines, and only ~33% of those lines were colour.
 * The other ~67% — breakpoints, typography, and the `MuiAppBar` /
 * `MuiListItemButton` / `MuiIconButton` / `MuiButton` / `MuiCard` /
 * `MuiContainer` overrides — was copied twelve times. A single type-scale
 * change was a twelve-file diff, and the twelfth file is the one that gets
 * missed.
 *
 * Worse, eleven of the twelve never authored `divider`, `action`, `success`,
 * `warning`, `info`, `grey` or `common` at all, while application code reads
 * those 409 times. Those values were coming from MUI's stock palette — a blue
 * `info` and a red `error` that appeared in no theme file and that no theme
 * author had ever seen, let alone checked for contrast. Making the roles
 * mandatory here is what closes that hole: a palette that omits one no longer
 * compiles.
 *
 * ## Roles, not hexes
 *
 * The app cannot adopt the brand palette wholesale, because users pick their
 * own theme and a "Dracula" theme is a promise to a user. Overriding community
 * palettes with brand green would break exactly the users who chose them. So
 * the brand system ports as *roles with contrast floors* rather than as
 * values: `docs/branding.md` § 3 owns the floors, and
 * `scripts/contrast-contract.mjs` fails the build on a palette that cannot be
 * read.
 *
 * @see docs/branding.md — the human-readable version of this contract
 * @see scripts/contrast-contract.mjs — the executable version
 */

/**
 * A theme's complete colour surface.
 *
 * Grouped by role rather than by MUI key, because the MUI mapping is an
 * implementation detail of `createBaseTheme` and the Tailwind mapping is an
 * implementation detail of `theme.css`. Both read from here.
 */
export type ThemePalette = {
	/** Drives MUI's `palette.mode` and the `dark` class Tailwind keys off. */
	mode: "light" | "dark";

	/* ---- grounds: four steps, distinguishable without a shadow ---------- */

	/**
	 * The page ground. The furthest-back surface in the app.
	 *
	 * Elevation in this system is a lightness step, not a shadow — see
	 * `docs/branding.md` § 5. These four values must be visually distinct from
	 * each other, because they are the only elevation signal available.
	 */
	canvas: string;
	/** One step raised: cards, panels, inputs, the message paper. */
	surface: string;
	/** Two steps raised: menus, popovers, tooltips, hovered rows. */
	elevated: string;
	/** One step recessed: wells, tracks, code grounds, footers. */
	sunken: string;
	/**
	 * The current row's own ground: a SHALLOW step off `surface`, in the
	 * direction the mode runs (darker on light themes, lighter on dark ones).
	 *
	 * A selection is not a well. Before this role existed the current row was
	 * painted `sunken`, which is always RECESSED — a hole in the panel — and
	 * loud with it: `deltaE(sunken, surface)` runs 3.75 (iceberg) to 14.94
	 * (synth) across the twelve palettes, against the ~2 perceptual threshold
	 * `docs/branding.md` § 3 cites. `sunken` is also the role for wells, tracks
	 * and code grounds, with 97 `*-sunken` utility occurrences across 66 files
	 * under `src/renderer` depending on it (85 live class usages and 12 inside
	 * prose, the palettes and the generated stylesheet excluded), so the current
	 * row could not be quietened by moving that value: the row needed a ground of
	 * its own.
	 *
	 * ## The band, and the two floors it sits between
	 *
	 * Authored to land at **ΔE00 2.0-2.5 from `surface`** — above the
	 * perceptual threshold (below it a row is drawn and not seen, the defect
	 * `docs/evidence/chat-sidebar-selection/README.md` records) and well under
	 * `sunken`'s 3.75-14.94 (above that it stops being a highlight and becomes
	 * the box the operator reported). Measured per palette by
	 * `scripts/contrast-contract.mjs`'s `highlight` block; the authored values
	 * land 2.18-2.28.
	 *
	 * The top of the band is bounded by something the row does not control: a
	 * row's `hover:` step is `elevated`, so a hovered row must STILL be a
	 * different ground from the current one. That pair's worst case is ΔE00
	 * 2.52 (obsidian) and the contract asserts it at the field floor, which is
	 * what stops the band running up into the hover step.
	 *
	 * `highlight` is the ground the row is painted with; every ink on it is
	 * asserted at its own floor, so it is a ground for text rather than a tint
	 * behind it.
	 */
	highlight: string;

	/* ---- ink: four weights, each with a floor --------------------------- */

	/** Primary text. Floor: 7:1 on all four grounds. */
	ink: string;
	/** Secondary text. Floor: 4.5:1 on all four grounds. */
	inkMuted: string;
	/** Tertiary text — captions, metadata, placeholders. Floor: 4.5:1. */
	inkDim: string;
	/**
	 * Inactive control text. The single exemption from the contrast floors,
	 * because a disabled control that meets 4.5:1 does not read as disabled.
	 *
	 * Disabled state changes *colour*, never opacity: an opacity-faded control
	 * fades its own background too, so it lands on a different colour over
	 * `surface` than over `sunken`.
	 */
	inkDisabled: string;

	/* ---- lines: the decorative/structural split ------------------------- */

	/**
	 * Decorative 1px rule — section dividers, table rules, list separators.
	 * Carries no information, so it has no contrast floor.
	 */
	hairline: string;
	/**
	 * Structural 1px boundary — the sole visual boundary of an input, select,
	 * checkbox or outlined button. Floor: 3:1 on all four grounds.
	 *
	 * This is the role most likely to be missing from an existing palette,
	 * because most palettes have exactly one border colour and use it for
	 * both jobs. Adding a second, legally distinct border value was the single
	 * highest-return accessibility change in this port: the previous light
	 * theme bounded every input at 1.25:1.
	 */
	borderControl: string;

	/* ---- accent: one hue, spent about three times per screen ------------ */

	/** Primary action, active state, focus ring. Floor: 4.5:1 as text. */
	accent: string;
	accentHover: string;
	accentActive: string;
	/** The faintest accent tint: hover fills, active rows, focus washes. */
	accentWash: string;
	/** Ink that sits on the accent fill. Floor: 4.5:1 on `accent`. */
	onAccent: string;
	/**
	 * The chart mark under the pointer.
	 *
	 * A first-class role rather than a reuse of `accentHover`, because the two
	 * answer different questions. `accentHover` is a step on the ACCENT RAMP: it
	 * is the primary button's own fill as the pointer crosses it, authored to be
	 * separable from `accent` (ΔE00 >= 2.0) with no promise about the surface
	 * behind it. That is fine for a button, whose shape and position say what it
	 * is, and wrong for a chart mark the reader has to FIND among its siblings.
	 * Obsidian is where it showed: its accent is the palette's brightest value, so
	 * its ramp can only walk downwards, and the hovered bar receded toward the
	 * ground instead of standing out (16.97:1 at rest, 13.96:1 under the pointer).
	 *
	 * Both properties below are asserted per palette by `check-themes`
	 * (`scripts/contrast-contract.mjs`, the "chart bar (hover)" block): at least
	 * ΔE00 10 from `accent`, and never closer to the plot ground than `accent` is.
	 * The 10 is the contract's own separation floor for this role, sitting between
	 * the syntax tokens' 8 and the semantics' 15 — read that block for the argument
	 * and for the names of the two constants, and re-measure before changing a value
	 * here; obsidian's window is narrow by construction, and tokyoNight's sits two
	 * thousandths above the floor.
	 */
	chartBarHover: string;

	/* ---- semantic: each with a wash and a border ------------------------ */

	/**
	 * Semantic triples. All three parts are required rather than derived,
	 * because deriving them is what makes MUI's `augmentColor` invent an
	 * Alert's appearance from a single hex — twelve times, differently.
	 */
	success: string;
	successWash: string;
	successBorder: string;
	warning: string;
	warningWash: string;
	warningBorder: string;
	danger: string;
	dangerWash: string;
	dangerBorder: string;
	info: string;
	infoWash: string;
	infoBorder: string;

	/* ---- overlay -------------------------------------------------------- */

	/**
	 * The one shadow in the system, used by the four MUI overlay elevations
	 * (AppBar 4, Menu/Popover 8, Drawer 16, Dialog 24) and nothing else. An
	 * arbitrary `<Paper elevation={6}>` gets no shadow, which is the intent.
	 */
	overlayShadow: string;
	/** Scrim behind modals and drawers. */
	scrim: string;
};

/** A palette plus the identity the theme picker shows. */
export type ThemeDefinition = {
	id: string;
	name: string;
	/** One line, shown under the name in the theme picker. */
	description: string;
	palette: ThemePalette;
};
