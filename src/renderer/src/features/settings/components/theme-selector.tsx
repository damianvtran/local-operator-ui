import { Tooltip, TooltipProvider } from "@shared/components/ui/tooltip";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type ThemeName, themes } from "@shared/themes";
import {
	Aperture,
	Atom,
	AudioWaveform,
	Binary,
	BookOpen,
	Candy,
	CarFront,
	CassetteTape,
	Check,
	CircuitBoard,
	CloudLightning,
	CloudMoon,
	CloudSnow,
	CloudSun,
	Code,
	Coffee,
	Contrast,
	Cpu,
	CupSoda,
	Disc3,
	Droplet,
	Droplets,
	Fish,
	Flame,
	Flower,
	Flower2,
	Ghost,
	Github,
	Guitar,
	Hexagon,
	IceCreamBowl,
	Joystick,
	Leaf,
	Lightbulb,
	type LucideIcon,
	Milk,
	Moon,
	MoonStar,
	Mountain,
	MountainSnow,
	Radio,
	Sailboat,
	Shirt,
	Skull,
	Snowflake,
	Sparkle,
	Stars,
	Sun,
	SunDim,
	Sunrise,
	Sunset,
	Tent,
	TreeDeciduous,
	TreePalm,
	TreePine,
	Trees,
	Umbrella,
	Waves,
	Wheat,
	Wind,
	Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { FC, KeyboardEvent } from "react";
import {
	type TileGridGroup,
	isTileNavKey,
	nextTileIndex,
} from "../theme-grid-navigation";

/**
 * The mark shown beside each theme's name.
 *
 * Identity, not colour, so it lives here rather than in the palette: a palette
 * says what a theme looks like, and none of them should have to know that a
 * picker exists. Exhaustive over `ThemeName`, so adding a theme fails to
 * compile until it has a mark.
 *
 * ## Why every icon here is different
 *
 * The mark is 12px beside a name the reader is comparing against its
 * neighbours, so two themes sharing one icon is a picker that says two things
 * are the same when they are not — and this set's whole reason for existing is
 * that near-identical palettes are the hard case. The five collisions that
 * survived the family-by-family slices that wrote these palettes (`Sunset` on
 * desert and synthwave, `Waves` on ocean, kanagawa-wave and solarized-dark,
 * `Wind` on nord and arctic, `TreeDeciduous` on autumn and everforest-light,
 * `Flower2` on lavender and kanagawa-lotus) were each resolved to the nearest
 * distinct lucide glyph that still says what the palette is. `Sun` /
 * `SunDim` / `SunMedium`, `Moon` / `MoonStar`, `Flower` / `Flower2`,
 * `Droplet` / `Droplets`, and `Trees` / `TreePine` / `TreeDeciduous` /
 * `TreePalm` are the deliberate near-pairs: sharing the family motif is the
 * point there, and each pair is still told apart at 12px.
 *
 * Every name is checked against the installed `lucide-react` — 0.507.0's own
 * export list — rather than assumed, because a name the package does not
 * export binds as `undefined` and React drops the mark without complaining.
 * No two entries share a glyph and all fifty-nine resolve; `Record<ThemeName,
 * LucideIcon>` makes the first half structural (a theme with no entry does not
 * compile), and the uniqueness is held by hand — nothing asserts it.
 *
 * ## Why the light group's near-pairs are told apart by ADJACENCY (round 1, D7)
 *
 * The design round measured the light group as the closest in the set (grounds
 * 1.07-1.48 apart in three of its pairs) and found four of its tiles wearing the
 * sun family — `Sun`, `SunMedium`, `Sunrise`, `CloudSun` — with `Eclipse` and
 * `Lightbulb` beside them. At 12px in the label column those read as one glyph
 * with small variations, in the one group whose tiles already need the marks to
 * distinguish them. So the map is re-slotted on adjacency rather than on family:
 * the light grid is five across in registry order, and two of the family pairs
 * sat side by side or stacked there — `SunMedium` at row 2 col 3 beside
 * `Lightbulb` at col 4, and `Eclipse` at row 2 col 1 directly under `Sun` at row
 * 1 col 1. Both are gone: `tokyoNightDay` takes `MountainSnow` (the light half of
 * `tokyoNight`'s `Mountain`, which is the pair the name already promises) and
 * `alucard` takes `Ghost` (the light half of `dracula`'s `Skull`). `Sun`,
 * `Sunrise` and `CloudSun` stay — the sun is what those names mean and none of
 * them is adjacent to another sun-family mark.
 */
const THEME_ICONS: Record<ThemeName, LucideIcon> = {
	localOperatorDark: Moon,
	localOperatorLight: Sun,
	dracula: Skull,
	dune: Flame,
	sage: Leaf,
	monokai: Code,
	tokyoNight: Mountain,
	iceberg: Snowflake,
	radient: Hexagon,
	neon: Zap,
	obsidian: Contrast,
	synth: AudioWaveform,

	/* classics */
	catppuccinMocha: Coffee,
	catppuccinLatte: Milk,
	tokyoNightStorm: CloudLightning,
	gruvbox: CassetteTape,
	nord: Wind,
	oneDark: Atom,
	solarizedDark: SunDim,

	/* rosé pine */
	rosePine: Flower,
	rosePineMoon: MoonStar,
	rosePineDawn: CloudSun,

	/* companions */
	alucard: Ghost,
	gruvboxLight: Disc3,
	tokyoNightDay: MountainSnow,
	oneLight: Lightbulb,
	catppuccinFrappe: CupSoda,
	catppuccinMacchiato: IceCreamBowl,
	palenight: Stars,

	/* modern */
	everforest: Trees,
	everforestLight: TreePine,
	kanagawaWave: Waves,
	kanagawaLotus: Flower2,
	ayuDark: Droplet,
	ayuMirage: Droplets,
	ayuLight: Sailboat,
	nightfox: CloudMoon,
	duskfox: Sunset,

	/* neon/retro */
	synthwave: Radio,
	matrix: Binary,
	tron: CircuitBoard,
	cyberpunk: Cpu,
	vaporwave: TreePalm,
	outrun: CarFront,
	neonNoir: Umbrella,
	arcade: Joystick,

	/* nature */
	forest: TreeDeciduous,
	ocean: Fish,
	desert: Tent,
	autumn: Wheat,
	lavender: Sparkle,
	arctic: CloudSnow,
	rosewood: Guitar,

	/* lights */
	solarizedLight: Sunrise,
	githubLight: Github,
	paper: BookOpen,
	linen: Shirt,
	highContrastLight: Aperture,
	mintLight: Candy,
};

/**
 * The selected tile's ground, and the disc the check sits on.
 *
 * The accent at 8% over the palette's own `accentWash`. The palette is frozen
 * and upstream-faithful, and the wash alone is not always the stronger of the
 * two readings the pointer produces — see the tile's own note for the measured
 * worst case over all fifty-nine. Stated in `srgb` so the painted colour is the
 * one the measurement computes, and naming two roles rather than a value, which
 * is what lets it survive a theme swap.
 */
const SELECTED_TILE_GROUND =
	"bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-accent-wash))]";

/**
 * A miniature of the app in one theme.
 *
 * ## Where the colours come from
 *
 * From the theme itself, at paint time. The inner element carries
 * `data-theme={id}`, the same attribute the theme provider sets on
 * `documentElement`, and every rule in `themes.generated.css` is scoped to
 * `[data-theme="…"]` rather than to `:root`. So `--lo-*` is rebound for this
 * subtree and the ordinary role utilities inside — `bg-canvas`, `bg-surface`,
 * `bg-sunken`, `bg-ink`, `bg-accent`, `border-control` — resolve to *that*
 * theme's values while the rest of the app stays on the active one.
 *
 * This did not use to be true, and the failure was invisible: Tailwind's
 * `@theme` declares `--color-canvas: var(--lo-canvas)` on `:root`, and a
 * `var()` inside a custom property is substituted where the property is
 * *declared*, not where it is used. So every `--color-*` was frozen to the root
 * palette, descendants inherited the already-resolved value, and all twelve
 * previews rendered in whichever theme was active — twelve identical swatches
 * that each looked plausible. The token layer now re-declares those pairs for
 * `[data-theme]:not(:root)`, generated from the same `@theme` block, so a new
 * role cannot leave scoped previews stale.
 *
 * The frame lives on the wrapper *outside* the `data-theme` element on purpose.
 * It is the picker's chrome — it says "selected" in the app's accent — and if
 * it sat on the scoped element it would draw itself in the previewed palette
 * and mean nothing.
 *
 * What it shows is chosen to be the part of a palette a user is actually
 * choosing between: the grounds in the arrangement the app uses them (sunken
 * rail, canvas page, surface panel, and now the elevated step — see below), the
 * active nav row in its accent wash, ink at two weights, the accent fill, and
 * one control edge.
 * `aria-hidden` because the theme's name and description beside it are the real
 * label — a screen reader gains nothing from a dozen empty spans.
 *
 * ## Why the height is fixed at 40px
 *
 * It used to be `aspect-16/10`, so a preview grew with its column: at the
 * settings page's measured 896px column a card was 277 x 254. That is fine for
 * twelve themes and impossible for 59, and it has a second cost that only shows
 * once there are many — two previews of the same palette are different sizes
 * depending on which column they land in, and comparing near-identical
 * palettes is exactly what this picker is for. A fixed 40px keeps the row pitch
 * independent of the column width and makes every miniature in the grid
 * identical, so a difference the eye finds is the palette and not the layout.
 *
 * ## Why `elevated` is now in the miniature
 *
 * The palette contract has four grounds and the miniature used to show three of
 * them. The fourth is the one a palette author is most likely to vary on its
 * own — it is the step a menu or a hovered row takes — and two dark palettes
 * with the same canvas can differ only there. It is drawn as the leftmost of
 * the three marks in the page's bottom row: the raised block, then the accent
 * fill, then the control's own edge. It carries no border on purpose: elevation
 * in this system is a lightness step, so the one bordered mark stays the only
 * one, which is also what keeps `border-control` from reading as decoration.
 */
const ThemeSwatch: FC<{ id: ThemeName }> = ({ id }) => (
	<div data-theme={id} aria-hidden="true" className="flex h-full bg-canvas">
		<div className="flex w-1/4 flex-col gap-1 bg-sunken p-1">
			<span className="flex h-2.5 items-center rounded-xs bg-accent-wash px-1">
				<span className="h-1 w-full rounded-xs bg-accent" />
			</span>
			<span className="mx-1 h-1 w-2/3 rounded-xs bg-ink-dim" />
			<span className="mx-1 h-1 w-1/2 rounded-xs bg-ink-dim" />
		</div>
		<div className="flex flex-1 flex-col justify-between p-1">
			<div className="flex flex-col gap-1 rounded-xs bg-surface p-1">
				<span className="h-1 w-3/5 rounded-xs bg-ink" />
				<span className="h-1 w-full rounded-xs bg-ink-dim" />
			</div>
			<div className="flex items-center gap-1">
				<span className="h-2.5 w-6 rounded-xs bg-elevated" />
				<span className="h-2.5 w-5 rounded-xs bg-accent" />
				<span className="h-2.5 w-4 rounded-xs border border-control" />
			</div>
		</div>
	</div>
);

/**
 * One theme in the gallery.
 *
 * ## Why the tile is a thumbnail and a name, and the description is a tooltip
 *
 * The twelve-theme picker measured 1105px tall: 92.1px of height per theme,
 * from a 16:10 preview that grew with its 277px column, a name row and a
 * description line. Fifty-nine of those is a 5,400px scroll, which is not a
 * picker any more. The tile is now a fixed 40px thumbnail and a name row.
 *
 * ## The density is a band, not a number (round 1, U1)
 *
 * The 896px column these figures were first taken in is the STORY's frame: the
 * story renders the section on its own with no rails, and `max-w-4xl` is a
 * maximum, so at every window width it shows the 5-column band and nothing else.
 * In the app the grid's column is set by the two rails around it, so the cost per
 * theme is a band — measured in the app (UX round 1) at each window width, 868px
 * of viewport height in every case:
 *
 * | window | grid column | columns | rows | tile w | grid span | per theme |
 * |---|---|---|---|---|---|---|
 * | 800 | 460 | 2 | 30 | 226.0 | 2415px | 40.9px |
 * | 1000 | 660 | 3 | 20 | 214.7 | 1621px | 27.5px |
 * | 1020 | 680 | 4 | 16 | 164.0 | 1304px | 22.1px |
 * | 1040 | 528 | 3 | 20 | 170.7 | 1621px | 27.5px |
 * | 1300 | 788 | 4 | 16 | 191.0 | 1304px | 22.1px |
 * | 1380 | 868 | 5 | 13 | 167.2 | 1066px | 18.1px |
 *
 * The 800 row is the app's declared minimum window (`WINDOW_MIN_WIDTH = 800` in
 * `main/window-mode.ts`), and it is the bottom of the range this table exists to
 * cover rather than a width a user is unlikely to reach (round 2, U3): the same
 * column identity gives it a 460px grid column, measured in the story at a
 * 508px viewport, where the grid is 2 across and 30 rows deep — 2415px, 40.9px
 * per theme, the most expensive band in the app.
 *
 * So the honest figure is 40.9px per theme at the app's 800px minimum, 27.5px at
 * 1000px and 18.1px at 1380px, against 92.1px for the twelve. The 1040 row is
 * TALLER than the 1020 row
 * because the window got wider, and that is a known property of the page around
 * this grid rather than something to tune away: crossing 1040 expands the
 * settings rail from 48px to 220px inside the same window
 * (`settings-page.tsx`'s `w-12 min-[1040px]:w-55`), which eats two columns'
 * worth of tiles while the window gains 20px. 5 columns needs a window of about
 * 1344px — the app's own default 1380 clears it by 36px — and 1040 to ~1175 is
 * the sparser middle band, so widening the window can make the picker sparser.
 * The grid's minimum cannot be tightened to flatten it without truncating
 * `Catppuccin Macchiato` (see the label row below), so it is recorded.
 *
 * The "shorter than the twelve" comparison therefore holds only where both grids
 * are at their widest count: at the story's own 896px column the tile grid is
 * 1090.9px against the card grid's 1105.2px, 14px shorter. At the narrower bands
 * the two are not comparable on that axis, because the card grid and the tile
 * grid change column count at different widths.
 *
 * The description cannot stay in the tile at that size. The registry's
 * descriptions are 241-348px of `text-meta` and the name has 137.2px of box to
 * share with its icon — the check left this row in round 1's D2 — so a
 * description line in the tile is an ellipsis with two words of it readable, and
 * the description is the one piece of text that says what the palette is FOR. It
 * moves to the `Tooltip` the app already reveals text with: hovering or focusing
 * the tile shows the whole sentence, and the tooltip's own `aria-describedby` is
 * what carries the description to a screen reader. The panel deliberately does
 * NOT repeat the name (round 1, U5): the name is on the tile beside the panel and
 * the duplicate only made the panel taller.
 *
 * The focus path is real but it is not unconditional, and the claim that it
 * shows the panel "at every stop" was false (round 2, U2). Radix's tooltip
 * closes itself on any scroll whose target contains its trigger
 * (`TooltipContentImpl`'s capture-phase `scroll` listener in the installed
 * `@radix-ui/react-tooltip`), and a focus move that scrolls the picker mounts
 * the panel and immediately unmounts it: measured, open at +2ms and closed at
 * +4ms, still closed 2.9s later, so the description appears on the stops that do
 * not scroll the container and is absent on the ones that do — and the panel
 * takes the tile's `aria-describedby` with it, so those stops are the ones
 * described by name alone (round 3, R3-U1: the sentence here said nothing was
 * lost "either way" until the trigger's `aria-describedby` was watched — set at
 * +2ms, removed at +4ms with the content). The behaviour is left alone here: the
 * same root cause is round 1's deferred U4, and the fix (scroll the target into
 * view, then focus it with `preventScroll`) changes when the panel opens, which
 * is a question for a round that can re-shoot frames.
 *
 * ## Why 12px, and what the name's box actually is
 *
 * Measured in the app, in the app's own font at 12px: the longest name in the
 * set is `Catppuccin Macchiato` at **126.5px**, and the names it is usually
 * confused with need less — `Local Operator Light` 115.8px, `Local Operator
 * Dark` 113.7px. The tile is 163.2px wide at the picker's 5-column band, the
 * label row inside it is 155.2px, and the 12px icon plus its 6px gap leave the
 * name **137.2px**.
 *
 * That box is the same in both states on purpose, and this is round 1's D2: the
 * check used to sit in this row and cost the name 18px, so a SELECTED
 * `Catppuccin Macchiato` had 119.2px against the 126.5px it needs and ellipsised
 * to `Catppuccin Macchi…` while every unselected name printed in full — the one
 * truncated name in the picker was the one the user had just chosen. The check
 * now overlays the preview's own corner, so the name is charged for the icon
 * only and has 10.7px of headroom at the tightest column the app renders (more
 * columns means narrower tiles, and the 5-column band is the narrowest).
 *
 * So the name takes the dense step: the card's old 13px would ellipsis the two
 * `Local Operator` themes, which is precisely the pair a new user confuses, and
 * the icon takes the 12px slot that belongs with `meta`.
 *
 * `font-medium` on the selected name is gone with it. It was a fourth selected
 * signal on a tile that is documented to carry three, it is the widest state of
 * the widest string, and at this width it is the state most likely to truncate.
 * The three that remain are the ones the criterion names: the wash on the tile,
 * the accent frame on the preview, and the check.
 *
 * ## The selected ground, and why it is not the palette's wash alone (D1)
 *
 * The tile's selected ground is `accentWash` carrying 8% of `accent`. The design
 * round measured the pair the wash forms with `canvas` over all fifty-nine
 * palettes and found the selection was not always the stronger of the two
 * readings the pointer can produce: `gruvboxLight`'s hover step is 3.58 ΔE00
 * while its wash is 2.36, and in seven themes the hover is within 0.3 of the
 * selection. The wash cannot be moved (the palettes are frozen and upstream-
 * faithful) and the hover cannot be made quieter without making it a JND in half
 * the set, so the picker strengthens its own ground: measured over all 59 with
 * `scripts/color.mjs`'s `deltaE`, the selection's worst separation from `canvas`
 * rises from 2.21 to 3.52 and the ordering margin (selection minus hover) from
 * -1.23 to +1.13, with the hover's own step left exactly as designed. The mix is
 * stated in `srgb` so the painted colour is the one the measurement computes, and
 * it names two roles rather than a value.
 *
 * 8% is the step that was chosen, and it is NOT a threshold — an earlier sentence
 * here claimed it was and does not reproduce (round 2, M-2). Re-derived over all
 * fifty-nine with `scripts/color.mjs`'s `deltaE` and the mix in sRGB, which is
 * the arithmetic `color-mix` performs, the worst ordering margin by 2% step is
 * 2% -0.14 (`gruvboxLight`), 4% +0.74 (`gruvboxLight`), 6% **+1.02** (`linen`),
 * 8% +1.13 (`linen`), 10% +2.12 (`paper`) — so 6% already clears a full ΔE00 of
 * margin and 8% is not the smallest step that does. The ratio is not monotone in
 * the result either: 7% and 9% land at +1.63 and +1.77, and the binding palette's
 * own separation from `canvas` dips across the shipped value — `linen` reads 3.01
 * at 5%, 3.41 at 6%, 4.02 at 7%, **3.52 at 8%**, 4.16 at 9%. A "smallest step that
 * clears X" claim cannot be true of a function that moves backwards. Recorded as
 * what it is, then: the step this change measured, captured and had signed off,
 * inside the 6-10% band where the ordering margin holds above a full ΔE00 while
 * the loud end stays subordinate to the state it marks — the worst separation
 * from `canvas` is 26.88 at 8%, up from 19.66 on the bare wash, on `cyberpunk`,
 * where the state was never in doubt. Moving it to 7% or 9% would buy about 0.5
 * ΔE00 on the binding palette and cost a re-shoot of all fifty-nine committed
 * frames, so it stays where both rounds measured it.
 *
 * One follow-up is recorded here rather than taken (round 2, M-3): this composite
 * is stated in `srgb` while the app's other composite of the same pair
 * (`ui/button.tsx`) uses `in_oklab`, and oklab measures better at both ends — the
 * worst separation from `canvas` 4.10 against 3.52, on a +1.71 margin against
 * +1.13. Taking it here would move every one of those fifty-nine frames, so it is
 * a change with its own re-shoot and its own reviews rather than a constant
 * edited in this one.
 */
const ThemeOptionTile: FC<{
	id: ThemeName;
	name: string;
	description: string;
	isSelected: boolean;
	/** Whether this tile is the picker's single tab stop (see `ThemeSelector`). */
	isTabStop: boolean;
	onSelect: () => void;
	/** Tells the picker which tile the tab stop should follow (see `ThemeSelector`). */
	onFocusTile: () => void;
}> = ({
	id,
	name,
	description,
	isSelected,
	isTabStop,
	onSelect,
	onFocusTile,
}) => {
	const Icon = THEME_ICONS[id];

	return (
		<Tooltip side="bottom" align="start" content={description}>
			<button
				type="button"
				data-theme-tile={id}
				aria-pressed={isSelected}
				tabIndex={isTabStop ? 0 : -1}
				onFocus={onFocusTile}
				onClick={onSelect}
				className={cn(
					"relative flex flex-col gap-1.5 rounded-md p-1 text-left transition-colors duration-fast ease-out-quart",
					isSelected ? SELECTED_TILE_GROUND : "hover:bg-surface",
				)}
			>
				{/*
				 * A fixed height, and the width is the tile's: the miniature is a
				 * picture of a window, and the window is as wide as the column. What
				 * must NOT follow the column is the height, or the row pitch moves
				 * with the window size (see `ThemeSwatch`). The frame is the accent
				 * one when selected and `hairline` otherwise: it is the picker's own
				 * chrome around a picture, not the boundary of a control, so it is
				 * not `border-control`.
				 */}
				<span
					className={cn(
						"relative block h-10 overflow-hidden rounded-sm border transition-colors duration-fast ease-out-quart",
						isSelected ? "border-accent" : "border-hairline",
					)}
				>
					<ThemeSwatch id={id} />
					{/*
					 * The check is not decoration: the wash and the accent frame are both
					 * colour, and colour alone is not a state. It sits over the preview's
					 * corner rather than in the name row because in the row it costs the
					 * name 18px, and 18px is more than the longest name in the set can
					 * spare — the selected `Catppuccin Macchiato` ellipsised while every
					 * unselected name printed in full (round 1, D2).
					 *
					 * The disc under it is the tile's OWN ground, not the preview's: the
					 * previewed palette is one of fifty-nine and the check is drawn in the
					 * active theme's accent, so a preview whose canvas happens to sit near
					 * that accent would swallow it. On the tile's ground the pairing is the
					 * one the component already relies on — accent on the wash.
					 */}
					{isSelected && (
						<span
							className={cn(
								"pointer-events-none absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full",
								SELECTED_TILE_GROUND,
							)}
						>
							<Check size={12} className="text-accent" aria-hidden="true" />
						</span>
					)}
				</span>
				{/*
				 * No horizontal padding on this row, so the icon and the name start at the
				 * thumbnail's own left edge rather than 4px inside it, and the name is
				 * charged for the icon only: the row is 155.2px, the 12px icon and its 6px
				 * gap take 18, and the name keeps 137.2px against the 126.5px
				 * `Catppuccin Macchiato` needs — in BOTH states, because the check left
				 * this row (round 1, D2). One measured figure, not two: the earlier note
				 * here quoted `Local Operator Dark`'s 114.7px and `Catppuccin Macchiato`'s
				 * 126.6px as if they were the same question (round 1, N-3).
				 */}
				<span className="flex items-center gap-1.5">
					<Icon
						size={12}
						className="shrink-0 text-ink-dim"
						aria-hidden="true"
					/>
					<span className="min-w-0 flex-1 truncate text-meta text-ink">
						{name}
					</span>
				</span>
			</button>
		</Tooltip>
	);
};

/**
 * The appearance picker: every theme in the registry, each shown as itself.
 *
 * ## Why it is dense
 *
 * The registry goes from twelve palettes to fifty-nine. At the old card
 * treatment — a 16:10 preview per theme — that is a 5,600px scroll, and a
 * picker you cannot take in at a glance is a list you have to search. The tiles
 * are therefore thumbnail-first and compact: the cost falls from 92.1px per
 * theme to 40.9px at the app's own 800px minimum window, 27.5px at 1000px and
 * 18.1px at 1380px, and `ThemeOptionTile`
 * carries the measured band table, including the 1040px band where widening the
 * window makes the grid SPARSER rather than denser.
 *
 * ## Why it is grouped by mode
 *
 * Forty-one dark and eighteen light in one undifferentiated grid asks the eye
 * to sort them, and "I want a light theme" is the first decision almost
 * everyone makes. Splitting on the palette's own `mode` — rather than on a
 * list maintained here — means a new palette lands in the right group with no
 * code change, which is the same property the swatch has.
 *
 * ## Why the grid is one tab stop (round 1, U2)
 *
 * Fifty-nine native `button`s in a grid are fifty-nine tab stops: measured in
 * the app, the picker cost a keyboard user 28 presses to reach its first tile
 * and 59 to cross it, and ArrowRight/ArrowDown/End did nothing. So the tiles use
 * the roving-tabindex pattern: exactly one tile is in the tab order and the
 * arrows move focus across the whole grid in visual order, with Home/End at the
 * ends. Enter and Space still select, because the tile is still a real button,
 * and the column count is measured from the DOM rather than hardcoded:
 * `auto-fill` decides it from the column width, so it is 3, 4 or 5 depending on
 * the window.
 *
 * The tab stop follows FOCUS, not the selection (round 2, M-6): with the arrows
 * parked on one tile and the selection on another, Tab-away and Shift-Tab-back
 * return to the tile the user was on, which is what the pattern means by a
 * roving tabindex. The selected tile is the fallback for the state before
 * anything here has been focused, and the set's first tile is the fallback when
 * the stored name is not in the rendered set, so the picker is never
 * unreachable.
 *
 * The arrows' rule is NOT a flat offset, and that is round 2's U1. The Dark
 * group's last row is short and the Light group begins a new one, so
 * `index ± columns` stepped off the end of the Dark group's arithmetic and
 * landed up to four columns into the Light group's first row — `ArrowDown` from
 * `rosewood` reached `rosePineDawn` 685px away instead of `localOperatorLight`
 * directly beneath it. The rule that follows the picture (down/up to the tile in
 * the next/previous visual row nearest this column, a group's first tile
 * starting a new row) lives in `theme-grid-navigation.ts` as a pure function
 * over indices and is covered by `scripts/theme-grid-navigation.test.mjs`,
 * including the boundary at 3, 4 and 5 columns; this component keeps the part
 * that needs a browser — reading the tiles and each grid's own column count out
 * of the DOM — and delegates the decision.
 *
 * No role is added to say "grid". A `role="grid"` owes its reader rows and
 * gridcells, which this DOM does not have, and a role that lies about the
 * structure is worse than none: the buttons keep their own semantics and their
 * `aria-pressed`, and the arrow keys are an addition to the tab order rather
 * than a claim about a widget type.
 *
 * ## Why the selected tile is not four signals
 *
 * It used to be an accent border *and* an accent wash *and* an accent check
 * *and* a bolder name, on a card sitting in a grid of eleven others. The frame
 * moved onto the preview — the thing actually being chosen — the tile keeps
 * the wash, and the check stays because colour alone is not a state. Three
 * marks for one tile, and only one tile at a time; the bolder name was the
 * fourth and it is gone (see `ThemeOptionTile` for why it is also the one that
 * truncates).
 *
 * The options are buttons rather than clickable `div`s so they are reachable by
 * keyboard, and the selected one is marked with `aria-pressed`.
 */

/**
 * The measured shape of the tiles as the DOM has them: one entry per group grid,
 * in DOM order.
 *
 * Both figures this rule needs come from the render rather than from a constant:
 * the group's tile count is what it actually rendered, and its column count is
 * read off the group's OWN first row, because `auto-fill` decides that from the
 * column's width and a count measured in one grid would silently misplace every
 * row of a grid that turned out narrower. The row test is the one this component
 * has always used: tiles share a `top` to within a sub-pixel when they are on
 * one row, and a `gap-2` column step is orders of magnitude larger than that.
 */
const measureTileGrids = (root: Element): TileGridGroup[] =>
	[...root.querySelectorAll<HTMLElement>("[data-theme-grid]")].map((grid) => {
		const tiles = [...grid.querySelectorAll<HTMLElement>("[data-theme-tile]")];
		const rowTop = tiles[0]?.getBoundingClientRect().top ?? 0;
		return {
			count: tiles.length,
			columns: Math.max(
				1,
				tiles.filter(
					(tile) => Math.abs(tile.getBoundingClientRect().top - rowTop) < 1,
				).length,
			),
		};
	});

export const ThemeSelector: FC = () => {
	const { themeName, setTheme } = useUiPreferencesStore();

	const groups = useMemo(() => {
		const all = Object.values(themes);
		return [
			{
				label: "Dark",
				items: all.filter((t) => t.theme.palette.mode === "dark"),
			},
			{
				label: "Light",
				items: all.filter((t) => t.theme.palette.mode === "light"),
			},
		].filter((group) => group.items.length > 0);
	}, []);

	/*
	 * The tile the tab stop follows: the one that has focus, so Tab-away and
	 * Shift-Tab-back return to where the user left off rather than to the
	 * selection they arrowed away from (round 2, M-6). The SELECTED tile is the
	 * fallback for the state before anything here has been focused, and the first
	 * tile of the set is the fallback when the stored name is not in the rendered
	 * set — so no state leaves the picker with zero tab stops.
	 */
	const [focusedId, setFocusedId] = useState<ThemeName | null>(null);

	const tabStop = useMemo(() => {
		const order = groups.flatMap((group) => group.items.map((item) => item.id));
		if (focusedId && order.includes(focusedId)) return focusedId;
		return order.includes(themeName) ? themeName : order[0];
	}, [groups, focusedId, themeName]);

	/**
	 * Move focus by arrow, Home or End.
	 *
	 * The DECISION is `nextTileIndex`'s — a pure function over indices, covered by
	 * `scripts/theme-grid-navigation.test.mjs` — and this function owns only what
	 * needs a live DOM: reading the tiles in their own order rather than keeping a
	 * second copy here (so a group gaining a palette needs no change), measuring
	 * each grid's column count, and moving focus.
	 */
	const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!isTileNavKey(event.key)) return;
		const tiles = [
			...event.currentTarget.querySelectorAll<HTMLButtonElement>(
				"[data-theme-tile]",
			),
		];
		const index = tiles.indexOf(event.target as HTMLButtonElement);
		if (index < 0) return;
		/* Handled: stop ArrowDown/Up from scrolling the page under the grid. */
		event.preventDefault();
		const next = nextTileIndex({
			index,
			key: event.key,
			groups: measureTileGrids(event.currentTarget),
		});
		/* `next` is `index` when the press clamps or cannot move. */
		if (next !== index) tiles[next]?.focus();
	};

	return (
		/*
		 * One provider for the whole grid. Every tile used to self-provide because
		 * the settings page mounts none, so the shared `skipDelayDuration` grace —
		 * the thing that lets the pointer sweep a row without re-waiting on each
		 * tile — never applied, and 59 tiles meant 59 providers holding 59 timers
		 * (round 1, M-3). `agents-sidebar.tsx` sets the precedent: the component
		 * that renders the list owns the provider, with this surface's own delays.
		 */
		<TooltipProvider>
			<div onKeyDown={moveFocus} className="flex flex-col gap-6">
				{groups.map((group) => (
					<div key={group.label}>
						<h3 className="px-1 pb-2 text-meta text-ink-dim">{group.label}</h3>
						{/*
						 * `auto-fill` on a minimum column rather than viewport
						 * breakpoints, the same idiom `InfoGrid` uses. This grid lives in
						 * a measured column inside two rails, so its width and the
						 * window's width are different questions: a `lg:grid-cols-3` fixes
						 * three columns at a viewport size that says nothing about how
						 * much room the previews actually have, and at 1024 it would
						 * squeeze three 165px thumbnails into a 530px column.
						 *
						 * 160px is the width at which the name box still holds the
						 * longest theme name at `text-meta` beside its icon: 137.2px of
						 * room against the 126.5px `Catppuccin Macchiato` needs, with the
						 * check out of that row, in both states (see `ThemeOptionTile`).
						 * At the settings page's 896px column that is five across, which
						 * is the widest band the app renders and 10.7px of headroom —
						 * the tightest it gets, since a narrower column means fewer, wider
						 * tiles. Tightening this minimum is what truncated that name
						 * (round 1, D2), and raising it drops the grid to four columns
						 * at the widest band, so it stays.
						 */}
						<div
							data-theme-grid={group.label}
							className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2"
						>
							{group.items.map(({ id, name, description }) => (
								<ThemeOptionTile
									key={id}
									id={id}
									name={name}
									description={description}
									isSelected={id === themeName}
									isTabStop={id === tabStop}
									onSelect={() => setTheme(id)}
									onFocusTile={() => setFocusedId(id)}
								/>
							))}
						</div>
					</div>
				))}
			</div>
		</TooltipProvider>
	);
};
