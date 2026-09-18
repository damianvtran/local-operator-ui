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
 * Before this contract, every theme was a standalone `createTheme()` of
 * 209–252 lines, and only ~33% of those lines were colour. The other ~67% —
 * breakpoints, typography, and the `MuiAppBar` / `MuiListItemButton` /
 * `MuiIconButton` / `MuiButton` / `MuiCard` / `MuiContainer` overrides — was
 * copied into every one of them. A type-scale change was a diff across every
 * theme file, and the last file is the one that gets missed.
 *
 * Worse, eleven of the twelve themes that existed then never authored
 * `divider`, `action`, `success`, `warning`, `info`, `grey` or `common` at
 * all, while application code reads those 409 times. Those values were coming
 * from MUI's stock palette — a blue `info` and a red `error` that appeared in
 * no theme file and that no theme author had ever seen, let alone checked for
 * contrast. Making the roles mandatory here is what closes that hole: a
 * palette that omits one no longer compiles.
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

/*
 * Type-only, so `themes/palette-contract.ts` and `types/theme.ts` still share
 * no runtime code: the registry is built from the palette directory, and the
 * union this file is checked against is erased at compile time.
 */
import type { ThemeName } from "../types/theme";

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
	 * The current row's own ground: **the panel's own colour**, one step along
	 * the `L*` axis in the direction the mode runs (darker on light themes,
	 * lighter on dark ones).
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
	 * ## THE MARK IS THE PANEL'S COLOUR, AND ALL THREE OF ITS AXES ARE BOUNDED
	 *
	 * The operator, after seeing the first two attempts rendered: *"the highlight
	 * still needs to be improved, it doesn't look great on all themes... use a
	 * lighter color relative to the sidebar background that looks visually
	 * appealing. On tokyo night for example the selected style doesn't look
	 * great, it looks almost grey when it should be a lighter slate."*
	 *
	 * On that palette the report is exact: `surface` #24283B carries 13.31 `C*`
	 * and its `highlight` #313342 carried 10.12 — 0.76x the panel's chroma, i.e.
	 * LESS tinted than the ground it sits on. The cause was the rule this one
	 * replaces: it bought the mark's **ΔE00 4.0 off `surface` from whatever axis
	 * was free**, and chroma is the free one, because WCAG contrast is a function
	 * of luminance alone — moving chroma costs the row's own ink floors nothing,
	 * while moving lightness spends the headroom that keeps the caps and the
	 * `· lopdev` binding inside the row legible. So the axis was spent in
	 * whichever direction reached the band first, and both are in the fleet:
	 * eight palettes read grey (cyberpunk 0.62x, alucard 0.66, solarizedLight
	 * 0.66, arcade 0.75, tokyoNight 0.76, gruvboxLight 0.86, arctic 0.91,
	 * everforest 0.91), thirteen read as a colour the panel never had (oneLight
	 * paints a BLUE highlight on a neutral #F4F4F4 panel, tokyoNightDay 3.60x,
	 * iceberg 3.31x, githubLight 2.91x, ayuLight 2.21x, rosePineDawn 2.10x,
	 * catppuccinLatte 1.93x, linen 1.90x, obsidian 1.90x, localOperatorDark
	 * 1.87x, localOperatorLight 1.85x, monokai 1.66x, oneDark 1.48x), and eleven
	 * broke the hue outright (arcade 160 degrees off its panel's, everforest 36,
	 * rosePine 25, neonNoir 24, rosePineDawn 22, catppuccinLatte 19,
	 * solarizedLight 18, nord 18, cyberpunk 17, ocean 14, solarizedDark 14).
	 *
	 * ## The rule a porting author follows
	 *
	 * The mark is the panel's own colour, moved along `L*` and nothing else:
	 *
	 * - **`L*` at least 3** off `surface`, in the direction the mode runs, and as
	 *   far as the ink floors allow — that is the whole of the mark's strength;
	 * - **hue within 12 degrees** of the panel's (asserted where the panel itself
	 *   carries at least 2 `C*`; below that an angle is 8-bit quantisation, which
	 *   is what keeps `linen` — panel 1.59 `C*` — out of the hue test);
	 * - **chroma never below the panel's**, and no more than **+15% or +1.6 `C*`**
	 *   above it. The absolute term is what makes the same rule mean the same
	 *   thing on a near-neutral panel, where a ratio says "3.31x" and means
	 *   nothing: it is why `oneLight`'s blue on a neutral panel fails while
	 *   `highContrastLight`, authored chroma-free on both sides, stays neutral.
	 *   The rule asks for continuity with the panel, not for a cast.
	 *
	 * ## What bounds it, and what happens where the bound cannot be held
	 *
	 * Below: every ink on the ground keeps § 3's floor with headroom — `ink` at
	 * 7:1, `ink-muted` and `ink-dim` at 4.5:1 — and `ink-dim` is the binder,
	 * because the caps and the `· lopdev` binding INSIDE a current row are drawn
	 * in it. That floor is what caps the step, and it caps it below the ΔE00 4.0
	 * band on thirty-six palettes: ΔE00 at a fixed hue is a function of the `L*`
	 * step alone, the band needs 5.3-6.9 `L*`, and those palettes' own `ink-dim`
	 * reaches its floor with headroom at 2.4-7.5. Each of them takes the largest
	 * step its inks allow and is recorded in `HIGHLIGHT_CAP_PINS` with the cap,
	 * the binder and both ratios, re-derived by the gate. Seven of those cannot
	 * reach even the **ΔE00 2.5 floor every palette must hold** and carry
	 * `subFloor: true` — a named list with its measurements, because buying the
	 * difference back on chroma or hue is the defect above.
	 *
	 * Against the app's other selected-row mark: `accentWash` is what an active or
	 * selected row wears elsewhere (`bg-accent-wash`), and a mark that keeps the
	 * panel's own colour lands on that mark's family rather than away from it —
	 * four of the port's palettes converged that way and were re-authored, and the
	 * pairs that still cannot be separated are pinned in `HIGHLIGHT_WASH_PINS`
	 * with the ceiling the gate re-derives.
	 *
	 * Beside it: a row's `hover:` step is `elevated`, and that is the collision
	 * this bound exposes rather than creates. `elevated` is the SAME `surface` +
	 * `L*` ramp for the same rows (a conversation's neighbours carry
	 * `hover:bg-elevated`) and also every menu, popover and tooltip ground in the
	 * app, sitting 1.7-8.6 `L*` off its panel (median 3.8); a bounded mark has
	 * exactly one place to sit, which is further along that ramp, so it can land
	 * on the hover step's shoulder — arcade measures ΔE00 0.31, tokyoNightStorm
	 * 0.32, ayuDark 0.54, oneDark 0.54, obsidian 0.63. Before this round the
	 * separation was bought by hue-breaking the mark, i.e. with the defect this
	 * round removes. Those pairs are pinned at what they measure
	 * (`HIGHLIGHT_ADJACENT_PINS`, `sunken` included, where the light palettes
	 * collide at the other end) and the fix is a **row-hover ground that steps
	 * less than the mark**, leaving `elevated` to the menu, popover and tooltip
	 * job it also holds: a role this contract does not have yet, and its own
	 * change rather than a remediation round of this one.
	 *
	 * An earlier round drew the mark's second signal as a 1px `outline-control`
	 * boundary; it is retired, because that role is § 2's *sole boundary of a
	 * control* and the ring rendered as the search field above the list (design
	 * round 1, D3). There is no role in this contract for a selection boundary —
	 * adding one would be role inflation for a mark the ground already carries.
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
	/**
	 * The theme's id, typed as the union rather than `string` on purpose.
	 *
	 * A `string` here compiled anything: a palette whose `id` disagreed with its
	 * `ThemeName` member still shipped a `[data-theme="…"]` block under that
	 * spelling (the CSS generator reads this directory, not the union), still
	 * rendered a tile (the picker maps over this array), and `getTheme` returned
	 * the default for it in silence. Widening the set from twelve hand-typed ids
	 * to fifty-nine is what made that trap worth closing, and it closes here
	 * rather than in the registry: with `ThemeName` on the field, a mismatch
	 * between a file's id and the union is a compile error, and `index.ts` no
	 * longer needs a cast to build `ThemeCollection` out of it (review round 1,
	 * M-1). A type-only import, so the two modules still share no runtime code.
	 */
	id: ThemeName;
	name: string;
	/** One line, shown under the name in the theme picker. */
	description: string;
	palette: ThemePalette;
};
