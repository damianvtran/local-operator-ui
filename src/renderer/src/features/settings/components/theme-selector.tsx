import { Tooltip } from "@shared/components/ui/tooltip";
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
	Eclipse,
	Fish,
	Flame,
	Flower,
	Flower2,
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
	Radio,
	Sailboat,
	Shirt,
	Skull,
	Snowflake,
	Sparkle,
	Stars,
	Sun,
	SunDim,
	SunMedium,
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
import { useMemo } from "react";
import type { FC } from "react";

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
	alucard: Eclipse,
	gruvboxLight: Disc3,
	tokyoNightDay: SunMedium,
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
 * settings page's measured 896px column a card was 293 x 183. That is fine for
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
 * The twelve-theme picker measured 1145px tall: 95.4px of height per theme,
 * from a 16:10 preview that grew with its 293px column, a name row and a
 * description line. Fifty-nine of those is a 5,600px scroll, which is not a
 * picker any more. The tile is now a fixed 40px thumbnail and a name row —
 * 71.4px of tile in a 5-across grid at the settings page's column — so the
 * measured cost is 17.1px per theme, and all 59 land in 1012px against the
 * 1145px the 12 take today.
 *
 * The description cannot stay in the tile at that size. The registry's
 * descriptions are 241-348px of `text-meta` and the name has 121px of box to
 * share with its icon and its check, so a description line in the tile is an
 * ellipsis with two words of it readable — and the description is the one piece
 * of text that says what the palette is FOR. It moves to the `Tooltip` the app
 * already reveals text with: hovering OR focusing the tile shows the full name
 * and the whole sentence, and the tooltip's own `aria-describedby` is what
 * carries the description to a screen reader. That focus path is the point —
 * a tooltip is not a hover-only affordance here.
 *
 * ## Why 12px, no bold, and a check that stays
 *
 * Measured, not chosen by eye: at 5 columns the name box is 120.8px, and the
 * longest current name ("Local Operator Dark") needs 124.3px at `text-body-sm`
 * against 114.7px at `text-meta`. So the name takes the dense step — the card's
 * old 13px would ellipsis the two `Local Operator` themes, which is precisely
 * the pair a new user confuses — and the icon takes the 12px slot that belongs
 * with `meta`.
 *
 * `font-medium` on the selected name is gone with it. It was a fourth selected
 * signal on a tile that is documented to carry three, it is the widest state of
 * the widest string, and at this width it is the state most likely to truncate.
 * The three that remain are the ones the criterion names: the wash on the tile,
 * the accent frame on the preview, and the check.
 */
const ThemeOptionTile: FC<{
	id: ThemeName;
	name: string;
	description: string;
	isSelected: boolean;
	onSelect: () => void;
}> = ({ id, name, description, isSelected, onSelect }) => {
	const Icon = THEME_ICONS[id];

	return (
		<Tooltip
			side="bottom"
			align="start"
			content={
				<>
					{/*
					 * The name is already this tile's own label, so the copy here is for
					 * the eye only: left in the accessible description it would arrive
					 * twice, once as the name and once inside the description.
					 */}
					<span aria-hidden="true" className="block text-ink">
						{name}
					</span>
					{description}
				</>
			}
		>
			<button
				type="button"
				aria-pressed={isSelected}
				onClick={onSelect}
				className={cn(
					"flex flex-col gap-1.5 rounded-md p-1 text-left transition-colors duration-fast ease-out-quart",
					isSelected ? "bg-accent-wash" : "hover:bg-surface",
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
						"block h-10 overflow-hidden rounded-sm border transition-colors duration-fast ease-out-quart",
						isSelected ? "border-accent" : "border-hairline",
					)}
				>
					<ThemeSwatch id={id} />
				</span>
				{/*
				 * No horizontal padding on this row, so the icon and the name start at the
				 * thumbnail's own left edge rather than 4px inside it. That is both the
				 * alignment the eye expects and 4px of box the longest name in the set
				 * needs: measured against the tile's font, "Catppuccin Macchiato" wants
				 * 126.6px and the box is 121px with padding, 129px without it. */}
				<span className="flex items-center gap-1.5">
					<Icon
						size={12}
						className="shrink-0 text-ink-dim"
						aria-hidden="true"
					/>
					<span className="min-w-0 flex-1 truncate text-meta text-ink">
						{name}
					</span>
					{/* The check is not decoration: the wash and the accent frame are
					    both colour, and colour alone is not a state. */}
					{isSelected && (
						<Check
							size={12}
							className="shrink-0 text-accent"
							aria-hidden="true"
						/>
					)}
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
 * picker you cannot take in at a glance is a list you have to search. The
 * tiles are therefore thumbnail-first and compact: measured on the real render
 * at the settings page's column, 59 themes take 1012px against the 1145px the
 * 12 take today, and the cost falls from 95.4px per theme to 17.1px.
 *
 * ## Why it is grouped by mode
 *
 * Forty-one dark and eighteen light in one undifferentiated grid asks the eye
 * to sort them, and "I want a light theme" is the first decision almost
 * everyone makes. Splitting on the palette's own `mode` — rather than on a
 * list maintained here — means a new palette lands in the right group with no
 * code change, which is the same property the swatch has.
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

	return (
		<div className="flex flex-col gap-6">
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
					 * longest theme name at `text-meta` beside its icon and its
					 * check (120.8px of room against 114.7px needed — see
					 * `ThemeOptionTile`). At the settings page's 896px column that is
					 * five across, which is what puts all 59 themes in less height
					 * than the 12 took before.
					 */}
					<div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
						{group.items.map(({ id, name, description }) => (
							<ThemeOptionTile
								key={id}
								id={id}
								name={name}
								description={description}
								isSelected={id === themeName}
								onSelect={() => setTheme(id)}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	);
};
