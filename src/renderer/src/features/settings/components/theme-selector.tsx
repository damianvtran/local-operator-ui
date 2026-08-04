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
 * From the theme itself, at paint time. The wrapper carries
 * `data-theme={id}`, which is the same attribute the theme provider sets on
 * `documentElement`, and every rule in `themes.generated.css` is scoped to
 * `[data-theme="…"]` rather than to `:root`. So the `--lo-*` variables are
 * rebound for this subtree and the ordinary role utilities inside — `bg-canvas`,
 * `bg-surface`, `bg-sunken`, `bg-ink`, `bg-accent`, `border-control` — resolve
 * to *that* theme's values while the rest of the app stays on the active one.
 *
 * The point is that a palette edit shows up here with no code change: the
 * swatch names roles, `pnpm gen-themes` rewrites the variables, and the preview
 * is correct by construction. The previous version hardcoded a
 * `linear-gradient` per theme in twelve `styled(Box)` blocks reading
 * `theme.palette.sidebar.*`, which is how a picker ends up advertising colours
 * a palette stopped using.
 *
 * What it shows is chosen to be the part of a palette a user is actually
 * choosing between: the three grounds in the arrangement the app uses them
 * (sunken rail, canvas page, surface panel), ink at two weights, the accent,
 * and one control edge. `aria-hidden` because the theme's name and description
 * beside it are the real label — a screen reader gains nothing from eleven
 * empty spans.
 */
const ThemeSwatch: FC<{ id: ThemeName }> = ({ id }) => (
	<div
		data-theme={id}
		aria-hidden="true"
		className="flex h-24 overflow-hidden rounded-md border border-hairline bg-canvas"
	>
		<div className="flex w-1/5 flex-col gap-1.5 bg-sunken p-2">
			<span className="h-1 w-full rounded-xs bg-ink-dim" />
			<span className="h-1 w-2/3 rounded-xs bg-ink-dim" />
			<span className="h-1 w-2/3 rounded-xs bg-ink-dim" />
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
 * The appearance picker: twelve themes, each shown as itself.
 *
 * The options are buttons rather than clickable `div`s so they are reachable by
 * keyboard, and the selected one is marked with `aria-pressed` plus a check —
 * the accent border and wash are a second signal, not the only one.
 */
export const ThemeSelector: FC = () => {
	const { themeName, setTheme } = useUiPreferencesStore();

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{Object.values(themes).map(({ id, name, description }) => {
				const Icon = THEME_ICONS[id];
				const isSelected = id === themeName;

				return (
					<button
						key={id}
						type="button"
						aria-pressed={isSelected}
						onClick={() => setTheme(id)}
						className={cn(
							"flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors duration-fast ease-out-quart",
							isSelected
								? "border-accent bg-accent-wash"
								: "border-transparent hover:bg-elevated",
						)}
					>
						<ThemeSwatch id={id} />
						<span className="flex items-center gap-2 px-1">
							<Icon size={14} className="shrink-0 text-ink-dim" />
							<span
								className={cn(
									"flex-1 text-body-sm text-ink",
									isSelected && "font-medium",
								)}
							>
								{name}
							</span>
							{isSelected && (
								<Check size={14} className="shrink-0 text-accent" />
							)}
						</span>
						<span className="px-1 pb-1 text-meta text-ink-muted">
							{description}
						</span>
					</button>
				);
			})}
		</div>
	);
};
