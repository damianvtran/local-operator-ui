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
	 *
	 * ## The legibility floors, which bind all four grounds
	 *
	 * A page ground is not a taste call. It is the surface the transcript is read
	 * on for hours, so it is FLOORED at **L\* 12 in a dark theme** - one rung above
	 * GitHub Dark's `#0D1117` (L\* 4.95) and exactly VS Code Dark+'s `#1E1E1E`, and
	 * deliberately above GitHub's default - and **CAPPED at L\* 94 in a light one**,
	 * because `elevated` at L\* 100 is the end of sRGB's ramp and the minimum
	 * canvas-to-elevated spread is 2.5 + 2.5 L\*. The top of the ladder is capped at
	 * **`elevated` L\* 30** (a dark theme's `canvas` also has a hard ceiling of
	 * L\* 22, past which it stops being off-black), because at `elevated` L\* 34 an
	 * `inkDim` at its floor needs L\* 85 and the ink/hover distinction disappears
	 * into the top of the ramp.
	 *
	 * The four grounds are then authored as L\* OFFSETS FROM THE CANVAS, and both
	 * ends of each step are asserted:
	 *
	 * | step | band |
	 * |---|---|
	 * | `canvas` -> `surface` | +2.5 to +5.0 L\* |
	 * | `surface` -> `elevated` | +2.5 to +6.0 L\* |
	 * | `canvas` -> `sunken` (down) | 1.5 to 6.0 L\* |
	 *
	 * with every adjacent pair at **ΔE00 >= 2.0 AND ratio >= 1.03:1** (the first is
	 * `docs/branding.md` § 3's observed threshold at which two grounds read as two
	 * grounds; the second is the older gate floor, which a 1px line needs but a
	 * field does not).
	 *
	 * ## Lifting a ramp moves LIGHTNESS ONLY
	 *
	 * A ground is re-solved by holding its own `a` and `b` at a new `L*`, so the
	 * theme's hue and chroma class are exactly what they were and chroma is scaled
	 * only where sRGB forces it. Lifting a near-black palette therefore changes how
	 * BLACK it is, not what colour it is, and that is the whole point: a user who
	 * chose `obsidian` for monochrome zinc still gets monochrome zinc. The cost is
	 * recorded rather than argued away - the four palettes whose upstream identity
	 * IS near-black (`obsidian`, `tron`, `matrix`, `dune`) lose the black, and keep
	 * the hue, the chroma class and the relative ladder.
	 *
	 * The grounds do not move alone. Raising a dark ground raises the luminance
	 * every ink is measured against, so an ink that cleared its floor before the
	 * lift can fail it after: `localOperatorDark`'s `inkDim` measures 4.61:1 on
	 * `elevated` as shipped, 3.86:1 on that same ink once the ground rises, and
	 * 5.02:1 only because the ink is re-authored with it - and `borderControl`, the
	 * sole boundary of every input, fails 3:1 on a lifted `elevated` in eight
	 * palettes. The grounds, the ink weights and `borderControl` therefore land in
	 * the same commit or not at all, which is a rule about this system rather than
	 * about one palette.
	 */
	canvas: string;
	/** One step raised: cards, panels, inputs, the message paper. */
	surface: string;
	/** Two steps raised: menus, popovers, tooltips, hovered rows. */
	elevated: string;
	/**
	 * One step recessed: wells, tracks, code grounds, footers.
	 *
	 * ## Its second job: the active row of a dialog's list
	 *
	 * `sunken` is also the ground a SELECTION takes inside a popup, where the
	 * dialog's own `bg-elevated` is what the row would otherwise be painted on.
	 * `picker-host.tsx` established it for the keyboard's row and the command
	 * palette's active row takes it for the same reason: it is the one ground that
	 * steps perceptibly away from `elevated` in every palette (measured ΔE00
	 * 5.85-16.70 across all fifty-nine), where the accent wash collapses onto the
	 * dialog ground (`obsidian` ΔE00 0.77) and reads 1.00-1.24:1.
	 *
	 * A selection therefore takes this ground AND a non-colour mark beside it -
	 * `outline-control` on the row, or the 2px accent bar the slash popup uses -
	 * because in nineteen of the fifty-nine palettes the accent's hue is more than
	 * 45 degrees off the panel it tints, so a tint can never be the state's only
	 * signal. `accentWash` is a hover and callout tint and not a selection ground;
	 * see its own doc below for the floor it carries instead.
	 */
	sunken: string;
	/**
	 * The current row's own ground: a step off `surface`, in the direction the
	 * mode runs (darker on light themes, lighter on dark ones).
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
	 * ## The step is lightness, and its DIRECTION is the half that is asserted
	 *
	 * The role was first authored to land at **ΔE00 2.0-2.5 from `surface`**, for
	 * a selection the operator had asked to be SUBTLE. He has since seen it
	 * rendered and reported the current row as lost beside a hovered neighbour,
	 * so the intent is reversed and the step now lands at **ΔE00 4.0 or better on
	 * every palette in the tree** — the twelve this change was authored against at
	 * 4.01-4.15, and the forty-seven the theme port added at 4.00-5.97 (`rosePine` sets the top),
	 * re-authored
	 * to this rule in the same round. It is a LIGHTNESS step first — the row sits
	 * **3.81 to 6.62 `L*`** from its panel on those twelve, and **3.0 or better**
	 * across the rest except six palettes whose OWN ink caps the lightness route
	 * below 3 `L*`: those take the cap, pay the band on the accent cast, and are
	 * pinned in `scripts/contrast-contract.mjs` with the ink number — and chroma pays
	 * only what is left over. The cast's OWN cause is narrower than it reads: of the
	 * forty-one palettes that take it, the hover step is the binding wall for only
	 * TWO (`kanagawaWave`, `rosePineMoon`); on the other thirty-nine what binds is
	 * the ink cap and the band, and the cast is how those two are paid together. Three palettes had reached the band on chroma alone
	 * (tokyoNight, `localOperatorDark`, `localOperatorLight`), at a `L*` step
	 * *smaller* than the ΔE00 2.2 value they had already reported as invisible;
	 * they were re-authored to +5.09, +3.81 and −4.75 `L*` respectively, and
	 * `scripts/contrast-contract.mjs` now asserts **both the direction and a floor
	 * on the step**, so no palette can satisfy the band while landing darker on a
	 * dark theme. That is the trap this doc exists to close: ΔE00 is a budget, and
	 * a chroma-bought step can spend all of it while moving the wrong way.
	 *
	 * ## The rule a porting author follows
	 *
	 * Take the `L*` step first, at the panel's own hue, as far as the ink floors
	 * allow; buy only the shortfall to the band's floor of ΔE00 4.0 on the chroma
	 * axis at that same hue. Chroma may pay a remainder; it may not pay the step.
	 * Some of the twelve still carry a partly chroma-bought step (dracula 1.20x
	 * the panel's chroma, monokai 1.66x, obsidian 1.90x, iceberg 3.31x, each
	 * recorded at its own value) and those are the palettes a re-authoring should
	 * take next. The port's forty-seven were re-authored to this rule when the
	 * raised band landed, at the branch the port itself used: a neutral step (its
	 * branch L) where the palette's ramp affords one, a cast toward `accent` (its
	 * branch H) where the hover step above the row blocks the lightness route.
	 *
	 * ## What bounds it
	 *
	 * Below: every ink on the ground keeps § 3's floor with headroom — `ink` at
	 * 7:1, `ink-muted` and `ink-dim` at 4.5:1 — and `ink-dim` is the binder,
	 * because the caps and the `· lopdev` binding INSIDE a current row are drawn
	 * in it. That floor is what caps the step on the palettes where it stops
	 * short of the band's top, and it is the reason the row's ground cannot simply
	 * be made louder on those palettes.
	 *
	 * Against the app's other selected-row mark: `accentWash` is what an active or
	 * selected row wears elsewhere (`bg-accent-wash`), and this role is a step toward
	 * the same family, so the two converge on a palette whose wash sits close to
	 * `surface` — four of the port's palettes landed under the field floor that way and
	 * were re-authored, and `rosePineDawn` cannot reach it at all (its ink caps the
	 * route and the best cast it can afford measures 1.75), recorded as a pinned
	 * exception. That pair is asserted beside the separations below.
	 *
	 * Beside it: a row's `hover:` step is `elevated`, so a hovered row must STILL
	 * be a different ground from the current one — worst pair ΔE00 2.25
	 * (localOperatorDark), asserted at the field floor. `elevated` is ALSO every
	 * menu, popover and tooltip ground in the app, so it is not a value that can
	 * come down to meet the selection: on eight of the twelve palettes it was measured
	 * against (design round 1, D2), the hover
	 * step remains the larger step off `surface` (up to 6.25 on radient), and the
	 * current row is therefore marked by its ground plus `font-medium`. An earlier
	 * round drew that second step as a 1px `outline-control` boundary; it is
	 * retired, because that role is § 2's *sole boundary of a control* and the
	 * ring rendered as the search field above the list (design round 1, D3). There
	 * is no role in this contract for a selection boundary — adding one would be
	 * role inflation for a mark the ground already carries.
	 *
	 * `highlight` is the ground the row is painted with; every ink on it is
	 * asserted at its own floor, so it is a ground for text rather than a tint
	 * behind it.
	 */
	highlight: string;

	/* ---- ink: four weights, each with a floor --------------------------- */

	/**
	 * Primary text. Floor: **7:1 on all six grounds, and 8:1 on `canvas`**.
	 *
	 * The six are the four elevation steps plus the two grounds that carry text
	 * as a STATE: `accentWash` (the hover/selection tint, chips, callouts,
	 * find-match) and `highlight` (the sidebar's and the settings rail's current
	 * row). Neither was measured before this pass, which is how a keycap on a
	 * selected row and a reading button on a hover could fail with every gate
	 * green. `canvas` takes the extra 1:1 because it is the transcript - the one
	 * surface in this app read for hours at arm's length.
	 */
	ink: string;
	/** Secondary text. Floor: **5.5:1 on all six grounds** — SC 1.4.3 asks 4.5, and
	 * this weight is used at 11-13px, where 4.5:1 is not 4.5:1 at 14px. */
	inkMuted: string;
	/** Tertiary text — captions, metadata, placeholders. Floor: **5.0:1** on all
	 * six grounds, for the same reason as `inkMuted` and one step behind it. */
	inkDim: string;
	/**
	 * Inactive control text. The single exemption from the contrast floors,
	 * because a disabled control that meets 4.5:1 does not read as disabled.
	 *
	 * Disabled state changes *colour*, never opacity: an opacity-faded control
	 * fades its own background too, so it lands on a different colour over
	 * `surface` than over `sunken`.
	 *
	 * ## The one ceiling in the system
	 *
	 * It has no floor, and it does have a **ceiling: `ratio(inkDisabled, g) <= 0.8
	 * x ratio(inkDim, g)` on every ground**. That relation is what keeps the state
	 * legible AS a state, and it is asserted rather than assumed: making `inkDim`
	 * lighter threatens the disabled state from below, and both inks sit on the
	 * same side of every ground, so the ceiling reduces to a fact about the two
	 * inks and moves only when the pair itself collapses.
	 */
	inkDisabled: string;

	/**
	 * ## The ink ladder, in one place
	 *
	 * The three weights are a hierarchy, not three independent floors: three inks
	 * each at their floor can be the same colour. So each step is asserted too -
	 * `deltaE(inkMuted, inkDim) >= 8` (the contract's comment-versus-code floor,
	 * which a live chip beside an inert reading has to beat) and
	 * `deltaE(ink, inkMuted) >= 2.0`.
	 *
	 * Only `inkDim` was ever the flag: it bottoms out on the lighter grounds, and
	 * raising it is what collapses the step, so the step is paid on LIGHTNESS -
	 * `inkMuted` rises with it rather than letting the pair converge. This is why
	 * the five palettes that used to pin that step (`tokyoNight`, `obsidian`,
	 * `iceberg`, `neon`, `localOperatorLight`) carry no pin any more.
	 */

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
	 *
	 * It is also the LOWER of the two bounds on how far a dark ramp can rise. A
	 * lifted `elevated` costs the edge contrast, so this role moves WITH the
	 * grounds in the same commit: left where it stood, it fails 3:1 on the lifted
	 * `elevated` in eight palettes (the worst is `obsidian` at 2.49:1), and the
	 * same is true of each semantic's own `*Border` role on the same ground.
	 */
	borderControl: string;

	/* ---- accent: one hue, spent about three times per screen ------------ */

	/**
	 * Primary action, active state, focus ring. Floor: **4.5:1 as text on all six
	 * grounds**, and **3:1 as a ring on all four** — the focus ring is
	 * `outline: 2px solid var(--color-accent)`, so SC 1.4.11 applies to it as a
	 * non-text graphic as well as SC 1.4.3 to its type.
	 *
	 * The ground list is what makes the accent a legibility role and not only a
	 * brand one: it is a link colour, a dialog's affordance and a chart mark's
	 * sibling, so it is measured on `elevated`, `accentWash` and `highlight` too,
	 * not just the three grounds that happen to carry the page's own text.
	 */
	accent: string;
	accentHover: string;
	accentActive: string;
	/**
	 * The faintest accent tint: hover fills, callout grounds, chips, find-match.
	 *
	 * ## A HOVER TINT, NOT A SELECTION GROUND
	 *
	 * This role is the app's pointer feedback and its callout wash, and it is
	 * deliberately no longer what an active ROW is painted with. A selection is a
	 * state the reader has to find while scanning a list, and a tint of the accent
	 * cannot carry that: on the dialog's own `elevated` it measures ΔE00 0.77 in
	 * `obsidian` and 1.51 in `catppuccinMocha`, at a luminance ratio of
	 * 1.00-1.24:1, so no contrast assertion in the system can see the failure - and
	 * on the default palette the operator's own screenshot PASSED the separation
	 * band at ΔE00 7.14 while reading 1.003:1, because the entire difference was
	 * hue. A selected row therefore takes a GROUND STEP instead (`sunken` inside a
	 * dialog, `highlight` on a panel) plus a non-colour mark.
	 *
	 * What it does carry is its own floor: **ΔE00 >= 2.0 against every ground it is
	 * painted on**. It fails that in eleven palettes at the scope this pass
	 * measured (`catppuccinMacchiato` 0.80 on `surface`, `obsidian` 0.77 on
	 * `elevated`, `tokyoNightDay` 1.13 on `sunken`), so those washes were
	 * re-authored on lightness at their own hue rather than the floor being set
	 * where the existing values happened to sit.
	 */
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

	/**
	 * The composer's STRUCTURED-TOKEN ink: the leading `/word` a user typed.
	 *
	 * Its own role rather than `info`, and the reason is measured rather than
	 * stylistic: the token sits INSIDE the draft, beside prose `ink`, and the
	 * composer already spends `accent` three times on the same screen (focus
	 * ring, send button, popup selection). Across the palettes that shipped when
	 * this role was authored, `info` is the accent's twin in three of them (dune,
	 * neon, radient read ΔE00 0.0) and `ink`'s twin in a fourth (obsidian, also
	 * 0.0), so no shipped text role could carry this run. It is the desktop's
	 * counterpart of the TUI's `$lo-signal`, whose own file states the rule
	 * ("`$lo-accent` is deliberately NOT used here … a recognized command word is
	 * structure, not activity").
	 *
	 * FLOORS (`scripts/contrast-contract.mjs`, the "command token" block): at
	 * least 4.5:1 as text on `surface` and on `elevated`; at least ΔE00 8 from
	 * `ink`, from `accent` and from `success` — the three inks this run is read
	 * against in one line of the composer. obsidian is the single pinned
	 * exception, and it is the app's recorded monochrome case: its `info` IS its
	 * `ink`, so `code-mirror-theme.ts` already separates tokens by WEIGHT there
	 * and `tokenCommand` is bound to `ink` with the composer's own painted weight
	 * step carrying the run (`slash-run-bold` — a text stroke, which thickens the
	 * glyph without moving its advance; a real `font-weight` here moved the
	 * MIRROR's wrap points off the textarea's and hid the tail of the draft behind
	 * the mirror's overflow, QA round 1 Q1). Its width is ONE constant, `0.5px`, at
	 * every raster: a raster-query floor was tried in round 2 (D6, on a proxy
	 * measurement that a real 1x build falsified — the 0.5px stroke paints at half
	 * strength there, not nothing) and withdrawn in round 3, because below 2dppx it
	 * doubled the run's stem against prose's 1 device pixel and closed this row's
	 * counters (D8). So this row's separation is the stroke as it has always been,
	 * at every display.
	 *
	 * The TUI port's palettes author it as their own `info` where that value
	 * clears the floors, which is most of them; the five that missed by a hair
	 * record a lift of that signal and its measured cost in the palette file.
	 * Re-measure before changing a value here.
	 */
	tokenCommand: string;

	/* ---- semantic: each with a wash and a border ------------------------ */

	/**
	 * Semantic triples. All three parts are required rather than derived,
	 * because deriving them is what makes MUI's `augmentColor` invent an
	 * Alert's appearance from a single hex — twelve times, differently.
	 *
	 * Both floors are stated once here and apply to all four roles: the tone is
	 * **4.5:1 as text on all six grounds** (it labels a callout, a status row and a
	 * syntax token), and its `*Border` is **3:1 on all four** (it is the callout's
	 * edge). `elevated`, `accentWash` and `highlight` joined those lists with the
	 * legibility pass, which is what retired the eleven `danger`/`dangerBorder`
	 * exceptions the contract used to carry for this family: they existed because
	 * the pair drawn on a dialog's `elevated` was the one no ground list reached,
	 * and the fix is the value, not the pin.
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
