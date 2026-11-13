/**
 * THE MARKETING SCENES' GLASS: the app's real translucent paint over a stand-in
 * desktop, story-only.
 *
 * WHY THIS EXISTS. The shipped default is window glass ON at intensity 80,
 * covering every column. On macOS that is `vibrancy`: the OS draws a blurred,
 * frosted copy of whatever sits behind the window, and the renderer only makes
 * its grounds translucent (`data-glass` plus the `--lo-glass-*` alphas written by
 * `applyGlassFacts`). A browser document has no OS material, so the preview's
 * glass frame (`.storybook/preview.tsx`, `GlassFrame`) paints a FLAT measured
 * grey under the window instead - right for evidence stories that measure
 * contrast against the solver's worst tone, but a marketing frame of it reads as
 * an opaque, lifeless canvas, which is not what a user sees (operator, design
 * review round 4 D8 on PRs #1825 and #1833).
 *
 * WHAT IT DOES. Two pieces, both opt-in per story file (spread `marketingGlass`
 * into the meta):
 *   1. `args` default the preview's own `glass` arg to the shipped default (on,
 *      80, full). The preview frame then calls the SHIPPED `applyGlassFacts`, so
 *      every alpha is the app's derivation - nothing here picks an alpha or
 *      paints a veil over the app. Because these are story args, a capture URL
 *      that pins only `theme:` keeps glass on, and `?args=glass:off` still gives
 *      the flat, glass-free frame.
 *   2. A decorator paints a textured "desktop wallpaper" layer under the window,
 *      ONLY while that arg is on, and blurs THE LAYER ITSELF. That is exactly
 *      the work vibrancy does natively (blur and lightly saturate what is behind
 *      the window), so the real translucent surfaces show a soft, frosted
 *      texture through them without any `backdrop-filter` the product does not
 *      ship.
 *
 * CONSTRAINTS.
 * - Luminance tracks `BACKDROP_GRAY["under-window"]`, the tone the glass floors
 *   were solved against, per scheme. Every tint is a `color-mix` toward that
 *   tone, so the texture varies hue far more than lightness and text over the
 *   glass stays in the contrast range the solver derived for.
 * - CSS and an inline SVG only: no binary asset to version or license.
 * - It sits at `z-index: -1` like the preview's flat backdrop, and later in tree
 *   order, so it paints over that flat tone and under the whole window. The flat
 *   tone is still the preview's default for every other story.
 * - THIS FILE IS SHARED BYTE-IDENTICAL by two independent branches (#1825's
 *   shell scenes and #1833's memory scenes), so whichever merges second merges
 *   cleanly. Change it in one place, on main, once both have landed.
 */
import { DEFAULT_THEME, getTheme, isThemeName } from "@shared/themes";
import type { Decorator } from "@storybook/react";
import { BACKDROP_GRAY } from "../../../../../shared/glass-derivation.mjs";

/** The shipped glass default, expressed as the preview's own arg seam. */
export const MARKETING_GLASS_ARGS = {
	glass: "on",
	glassIntensity: 80,
	glassCoverage: "full",
} as const;

/*
 * Film grain, so the blurred field reads as frosted rather than as a smooth
 * gradient. `stitchTiles` keeps the 160px tile seamless when it repeats.
 */
// i18n: ignore CSS background-image value (SVG grain data URL), not user copy
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
)}")`;

/**
 * The stand-in desktop. Tints are mixed toward the measured under-window tone
 * (mostly tone, a little hue) so the field's average luminance stays near it.
 */
const MarketingWallpaper = ({ dark }: { dark: boolean }) => {
	const t = BACKDROP_GRAY["under-window"][dark ? "dark" : "light"];
	const tone = `rgb(${t}, ${t}, ${t})`; // i18n: ignore CSS colour value, not user copy
	/* Lighter and darker steps are small on purpose: the blur spreads them, and
	   a wider swing would move text contrast off the solver's assumption. */
	const tint = (hue: string, share: number) =>
		`color-mix(in srgb, ${hue} ${share}%, ${tone})`;
	const blue = tint(dark ? "#5b7bd5" : "#6f93e0", 34);
	const violet = tint(dark ? "#8a6cc9" : "#a48bd9", 26);
	const sand = tint(dark ? "#c9a06a" : "#e2c08f", 30);
	const teal = tint(dark ? "#4fa7a0" : "#71bfb6", 28);
	const lift = tint("#ffffff", dark ? 8 : 16);
	const sink = tint("#000000", dark ? 14 : 8);
	return (
		<div
			aria-hidden="true"
			data-story-glass-backdrop="marketing-wallpaper"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: -1,
				overflow: "hidden",
				backgroundColor: tone,
				pointerEvents: "none",
			}}
		>
			{/*
			 * The "desktop" before the OS blurs it: soft colour fields plus a few
			 * window-like bands so the blur has edges to soften. Oversized by the
			 * blur radius on every side so the filter's transparent fringe never
			 * reaches the viewport edge as a dark vignette.
			 */}
			<div
				style={{
					position: "absolute",
					inset: -96,
					backgroundColor: tone,
					backgroundImage: [
						`radial-gradient(42% 55% at 12% 18%, ${blue} 0%, transparent 70%)`, // i18n: ignore CSS gradient value, not user copy
						`radial-gradient(38% 46% at 86% 14%, ${violet} 0%, transparent 72%)`, // i18n: ignore CSS gradient value, not user copy
						`radial-gradient(48% 52% at 78% 88%, ${sand} 0%, transparent 70%)`, // i18n: ignore CSS gradient value, not user copy
						`radial-gradient(40% 50% at 22% 84%, ${teal} 0%, transparent 72%)`, // i18n: ignore CSS gradient value, not user copy
						`linear-gradient(118deg, transparent 38%, ${lift} 46%, transparent 54%)`, // i18n: ignore CSS gradient value, not user copy
						`linear-gradient(118deg, transparent 58%, ${sink} 64%, transparent 72%)`, // i18n: ignore CSS gradient value, not user copy
						`conic-gradient(from 210deg at 54% 46%, ${tone}, ${lift}, ${tone}, ${sink}, ${tone})`, // i18n: ignore CSS gradient value, not user copy
					].join(", "),
					filter: "blur(28px) saturate(1.25)",
				}}
			/>
			{/* Frost: grain kept OUT of the blur, faint, as the material's own texture. */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					backgroundImage: GRAIN,
					opacity: dark ? 0.07 : 0.09,
					mixBlendMode: "overlay",
				}}
			/>
		</div>
	);
};

/**
 * Paints the wallpaper under the story while the `glass` arg is on. The scheme
 * follows the `theme` arg, as the preview's own glass frame does, so a dark
 * palette never sits on the light desktop it was not derived against.
 */
export const withMarketingGlass: Decorator = (Story, context) => {
	const raw = String(context.args.theme ?? DEFAULT_THEME);
	const theme = isThemeName(raw) ? raw : DEFAULT_THEME;
	const dark = getTheme(theme).theme.palette.mode === "dark";
	return (
		<>
			{context.args.glass === "on" && <MarketingWallpaper dark={dark} />}
			<Story />
		</>
	);
};

/** Spread into a story file's meta: `{ title, ...marketingGlass, parameters }`. */
export const marketingGlass = {
	args: MARKETING_GLASS_ARGS,
	decorators: [withMarketingGlass],
};
