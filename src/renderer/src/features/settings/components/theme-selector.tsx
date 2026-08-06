import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type ThemeName, themes } from "@shared/themes";
import {
	AudioWaveform,
	Check,
	Code,
	Contrast,
	Flame,
	Hexagon,
	Leaf,
	type LucideIcon,
	Moon,
	Mountain,
	Skull,
	Snowflake,
	Sun,
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
 */
const THEME_ICONS: Record<ThemeName, LucideIcon> = {
	localOperatorDark: Moon,
	localOperatorLight: Sun,
	radient: Hexagon,
	dracula: Skull,
	dune: Flame,
	sage: Leaf,
	monokai: Code,
	tokyoNight: Mountain,
	iceberg: Snowflake,
	neon: Zap,
	obsidian: Contrast,
	synth: AudioWaveform,
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
 * choosing between: the three grounds in the arrangement the app uses them
 * (sunken rail, canvas page, surface panel), the active nav row in its accent
 * wash, ink at two weights, the accent fill, and one control edge.
 * `aria-hidden` because the theme's name and description beside it are the real
 * label — a screen reader gains nothing from a dozen empty spans.
 */
const ThemeSwatch: FC<{ id: ThemeName }> = ({ id }) => (
	<div data-theme={id} aria-hidden="true" className="flex h-full bg-canvas">
		<div className="flex w-1/4 flex-col gap-1 bg-sunken p-1.5">
			<span className="flex h-2.5 items-center rounded-xs bg-accent-wash px-1">
				<span className="h-1 w-full rounded-xs bg-accent" />
			</span>
			<span className="mx-1 h-1 w-2/3 rounded-xs bg-ink-dim" />
			<span className="mx-1 h-1 w-1/2 rounded-xs bg-ink-dim" />
		</div>
		<div className="flex flex-1 flex-col justify-between p-2">
			<div className="flex flex-col gap-1.5 rounded-sm bg-surface p-2">
				<span className="h-1.5 w-3/5 rounded-xs bg-ink" />
				<span className="h-1 w-full rounded-xs bg-ink-dim" />
				<span className="h-1 w-4/5 rounded-xs bg-ink-dim" />
			</div>
			<div className="flex items-center gap-1.5">
				<span className="h-3 w-9 rounded-xs bg-accent" />
				<span className="h-3 w-6 rounded-xs border border-control" />
			</div>
		</div>
	</div>
);

/**
 * One theme in the gallery.
 */
const ThemeOptionCard: FC<{
	id: ThemeName;
	name: string;
	description: string;
	isSelected: boolean;
	onSelect: () => void;
}> = ({ id, name, description, isSelected, onSelect }) => {
	const Icon = THEME_ICONS[id];

	return (
		<button
			type="button"
			aria-pressed={isSelected}
			onClick={onSelect}
			className={cn(
				"flex flex-col gap-2 rounded-lg p-2 text-left transition-colors duration-fast ease-out-quart",
				isSelected ? "bg-accent-wash" : "hover:bg-surface",
			)}
		>
			{/*
			 * 16:10 rather than a fixed height: the miniature is a picture of a
			 * window, and a window is not 200x96. It also means the preview grows
			 * with the column instead of stretching into a letterbox.
			 */}
			<span
				className={cn(
					"block aspect-16/10 overflow-hidden rounded-md border transition-colors duration-fast ease-out-quart",
					isSelected ? "border-accent" : "border-hairline",
				)}
			>
				<ThemeSwatch id={id} />
			</span>
			<span className="flex items-center gap-2 px-1">
				<Icon size={14} className="shrink-0 text-ink-dim" aria-hidden="true" />
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-body-sm text-ink",
						isSelected && "font-medium",
					)}
				>
					{name}
				</span>
				{/* The check is not decoration: the wash and the accent frame are
				    both colour, and colour alone is not a state. */}
				{isSelected && (
					<Check
						size={14}
						className="shrink-0 text-accent"
						aria-hidden="true"
					/>
				)}
			</span>
			<span className="px-1 pb-1 text-meta text-ink-muted">{description}</span>
		</button>
	);
};

/**
 * The appearance picker: twelve themes, each shown as itself.
 *
 * ## Why it is grouped by mode
 *
 * Nine dark and three light in one undifferentiated grid asks the eye to sort
 * them, and "I want a light theme" is the first decision almost everyone
 * makes. Splitting on the palette's own `mode` — rather than on a list
 * maintained here — means a new palette lands in the right group with no code
 * change, which is the same property the swatch has.
 *
 * ## Why the selected card is not four signals
 *
 * It used to be an accent border *and* an accent wash *and* an accent check
 * *and* a bolder name, on a card sitting in a grid of eleven others. The frame
 * moved onto the preview — the thing actually being chosen — the card keeps the
 * wash, and the check stays because colour alone is not a state. Three marks
 * for one card, and only one card at a time.
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
					 * squeeze three 165px thumbnails into a 530px column. 240px is
					 * the narrowest a miniature can be and still read as a window,
					 * which caps the measured column at three across on its own.
					 */}
					<div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
						{group.items.map(({ id, name, description }) => (
							<ThemeOptionCard
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
