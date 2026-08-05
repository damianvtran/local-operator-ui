import type { Shadows, Theme } from "@mui/material/styles";
import { createTheme } from "@mui/material/styles";
import type { ThemePalette } from "./palette-contract";

/**
 * The one MUI theme factory.
 *
 * Every non-colour decision in the application lives here exactly once —
 * breakpoints, type scale, radii, spacing, motion, elevation, and every
 * component override. A theme supplies a `ThemePalette` and nothing else.
 *
 * ## Why this replaced twelve `createTheme()` calls
 *
 * The twelve theme files were 209–252 lines each and structurally identical:
 * roughly a third colour, two thirds copy-pasted breakpoints, typography and
 * `MuiAppBar` / `MuiListItemButton` / `MuiIconButton` / `MuiButton` / `MuiCard`
 * / `MuiContainer` overrides. A single type-scale change was a twelve-file
 * diff, and the drift was already visible: three themes had quietly dropped the
 * `MuiPaper` `backgroundImage: none` reset, two had grown per-theme neon glows,
 * and Iceberg carried two `MuiTypography` contrast patches that only existed
 * because its palette could not be read. All three classes of defect are
 * structurally impossible once the structure is written once.
 *
 * ## The bridge, and why it has to be exhaustive
 *
 * Roughly 1405 call sites read `theme.palette.*` directly, so this function is
 * a bridge as much as a factory: it projects the 29 roles onto the MUI palette
 * keys those call sites already use. Nothing outside this directory had to
 * change.
 *
 * The important half of that job is the keys the old themes never authored.
 * Eleven of the twelve defined only `primary`, `secondary`, `background`,
 * `text` and the custom roots — yet application code reads `divider`, `action`,
 * `success`, `warning`, `info`, `grey` and `common` 409 times. Those values
 * were coming from MUI's stock palette: a Material blue `info`, a Material red
 * `error`, and an untinted grey ramp, none of which appeared in any theme file
 * and none of which any theme author had ever checked for contrast. Every one
 * of them is authored below, derived from the palette's own roles, so nothing
 * falls through to a MUI default again.
 *
 * @see palette-contract.ts — the 29 roles and their contrast floors
 * @see ../../styles/index.css — the same non-colour decisions for Tailwind
 */

/* ------------------------------------------------------------------------ *
 * Colour maths
 *
 * Deliberately small and dependency-free. The palette authors the values that
 * carry meaning; these helpers only interpolate between values the palette
 * already chose, so a derived colour is always on the palette's own ramp and
 * inherits its temperature. Nothing here invents a hue.
 * ------------------------------------------------------------------------ */

type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Parse a palette hex.
 *
 * Throws rather than falling back, because a role that cannot be parsed would
 * otherwise silently become black and produce a theme that looks deliberate.
 * Only the roles that get mixed or measured pass through here; `scrim` and
 * `overlayShadow` are CSS values, not colours, and are used verbatim.
 */
const toRgb = (value: string): Rgb => {
	const match = HEX.exec(value.trim());
	if (!match) {
		throw new Error(
			`createBaseTheme: expected a hex colour, received "${value}". Grounds, inks, lines, accent and semantic roles must be hex so they can be mixed and contrast-measured.`,
		);
	}
	const digits =
		match[1].length <= 4
			? [...match[1].slice(0, 3)].map((c) => c + c).join("")
			: match[1].slice(0, 6);
	return [
		Number.parseInt(digits.slice(0, 2), 16),
		Number.parseInt(digits.slice(2, 4), 16),
		Number.parseInt(digits.slice(4, 6), 16),
	];
};

const toHex = (rgb: Rgb): string =>
	`#${rgb
		.map((channel) =>
			Math.round(Math.min(255, Math.max(0, channel)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

/** Linear blend: `t` of 0 returns `from`, 1 returns `to`. */
const mix = (from: string, to: string, t: number): string => {
	const a = toRgb(from);
	const b = toRgb(to);
	return toHex([
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t,
	]);
};

/** WCAG relative luminance. */
const luminance = (colour: string): number => {
	const [r, g, b] = toRgb(colour).map((channel) => {
		const s = channel / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio. */
const contrast = (a: string, b: string): number => {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/**
 * The two ends of a palette's neutral axis: every derived colour in this file
 * is a point between them.
 */
type NeutralExtremes = {
	/** The highest-luminance neutral the palette contains. */
	lightest: string;
	/** The lowest-luminance neutral the palette contains. */
	darkest: string;
};

/**
 * The lightest and darkest neutrals the palette actually contains.
 *
 * These anchor every derivation below. Using the palette's own extremes rather
 * than `#fff` / `#000` is what keeps derived values inside the palette's
 * temperature: a warm palette's greys stay warm, and a cool one's stay cool.
 * Mixed-temperature neutrals are the single thing that makes a palette look
 * accidental, and they are exactly what a hardcoded white or black introduces.
 */
const neutralExtremes = (palette: ThemePalette): NeutralExtremes => {
	const candidates = [
		palette.canvas,
		palette.surface,
		palette.elevated,
		palette.sunken,
		palette.ink,
		palette.inkMuted,
		palette.inkDim,
		palette.inkDisabled,
	];
	let lightest = candidates[0];
	let darkest = candidates[0];
	for (const candidate of candidates) {
		if (luminance(candidate) > luminance(lightest)) lightest = candidate;
		if (luminance(candidate) < luminance(darkest)) darkest = candidate;
	}
	return { lightest, darkest };
};

/**
 * Expand one authored colour into the `{ main, light, dark, contrastText }`
 * MUI expects.
 *
 * MUI would otherwise run `augmentColor`, which invents `light` and `dark` from
 * `main` with its own fixed tonal offset and picks `contrastText` against a
 * hardcoded white. That is how an Alert ends up with an appearance no theme
 * author chose. Here `light` and `dark` walk toward the palette's own extremes,
 * and `contrastText` is measured rather than assumed.
 */
const family = (main: string, extremes: NeutralExtremes) => ({
	main,
	light: mix(main, extremes.lightest, 0.3),
	dark: mix(main, extremes.darkest, 0.3),
	contrastText:
		contrast(main, extremes.darkest) >= contrast(main, extremes.lightest)
			? extremes.darkest
			: extremes.lightest,
});

/**
 * MUI's grey ramp, re-cut on the palette's own neutral axis.
 *
 * Orientation stays absolute — 50 is the lightest step and 900 the darkest, in
 * every theme — because the ~34 call sites that read it are all inside
 * `mode === "light" ? grey[n] : ...` ternaries and expect that. What changes is
 * the tint: instead of Material's cool neutral it now runs between this
 * palette's lightest and darkest values.
 */
const greyRamp = (extremes: NeutralExtremes) => {
	const step = (t: number) => mix(extremes.lightest, extremes.darkest, t);
	return {
		50: step(0.02),
		100: step(0.08),
		200: step(0.17),
		300: step(0.28),
		400: step(0.42),
		500: step(0.55),
		600: step(0.67),
		700: step(0.78),
		800: step(0.88),
		900: step(0.96),
		A100: step(0.08),
		A200: step(0.17),
		A400: step(0.42),
		A700: step(0.78),
	};
};

/* ------------------------------------------------------------------------ *
 * The factory
 * ------------------------------------------------------------------------ */

/**
 * Build the MUI theme for one palette.
 *
 * @param palette the theme's complete colour surface
 */
export const createBaseTheme = (palette: ThemePalette): Theme => {
	const extremes = neutralExtremes(palette);
	const grey = greyRamp(extremes);

	/**
	 * The disabled treatment, written once and applied to the eight components
	 * that would otherwise fade themselves.
	 *
	 * Disabled changes colour, never opacity. An opacity-faded control fades its
	 * own background along with its text, so the same disabled control lands on
	 * a different colour over `surface` than it does over `sunken`, and neither
	 * of those two colours was designed. `inkDisabled` is the one role exempt
	 * from the contrast floors precisely so this can be a colour change.
	 *
	 * `pointerEvents: auto` is what lets `cursor: not-allowed` render at all —
	 * MUI sets `pointer-events: none` on disabled controls, and a pointer event
	 * that never reaches the element cannot change the cursor.
	 */
	const disabledState = {
		opacity: 1,
		color: palette.inkDisabled,
		cursor: "not-allowed",
		pointerEvents: "auto",
	} as const;

	/**
	 * The eight components in MUI 6.4 whose own styles multiply themselves by
	 * `palette.action.disabledOpacity`. Verified against
	 * `node_modules/@mui/material/*​/*.js` — re-check this list on a MUI major:
	 *
	 *   AccordionSummary  &.Mui-disabled
	 *   Autocomplete      .MuiAutocomplete-option[aria-disabled="true"]
	 *   Chip              &.Mui-disabled
	 *   ListItemButton    &.Mui-disabled
	 *   MenuItem          &.Mui-disabled
	 *   PaginationItem    &.Mui-disabled  (root and the outlined/text slots)
	 *   Rating            &.Mui-disabled
	 *   Tab               &.Mui-disabled
	 *
	 * `action.disabledOpacity` is also pinned to 1 in the palette below, which
	 * covers a ninth component appearing in a future MUI. These overrides stay
	 * anyway: only they carry the colour and the cursor.
	 *
	 * ListItemButton is the one absentee here. It has anatomy overrides of its
	 * own further down, and `components` is a flat object — a second
	 * `MuiListItemButton` key would silently replace the first rather than merge
	 * with it. Its disabled state is applied inside that block instead.
	 */
	const disabledOverrides = {
		MuiAccordionSummary: {
			styleOverrides: { root: { "&.Mui-disabled": disabledState } },
		},
		MuiAutocomplete: {
			styleOverrides: {
				option: { '&[aria-disabled="true"]': disabledState },
			},
		},
		MuiChip: {
			styleOverrides: { root: { "&.Mui-disabled": disabledState } },
		},
		/* ListItemButton: see the note above — applied in its own block. */
		MuiMenuItem: {
			styleOverrides: { root: { "&.Mui-disabled": disabledState } },
		},
		MuiPaginationItem: {
			styleOverrides: { root: { "&.Mui-disabled": disabledState } },
		},
		MuiRating: {
			styleOverrides: { root: { "&.Mui-disabled": disabledState } },
		},
		MuiTab: {
			styleOverrides: { root: { "&.Mui-disabled": disabledState } },
		},
	};

	return createTheme({
		breakpoints: {
			/* `lg` and `xl` are wider than Material's defaults because this is a
			   desktop window, not a phone: the app is routinely 1400–1900px and
			   Material's 1200/1536 would put almost every session in the top
			   bucket, making the two largest breakpoints useless. */
			values: { xs: 0, sm: 600, md: 900, lg: 1300, xl: 1800 },
		},

		spacing: 8,

		shape: {
			/* `--radius-md` from index.css. MUI multiplies this for a few slots,
			   which is why the component overrides below state their radius
			   outright instead of scaling it. */
			borderRadius: 10,
		},

		/**
		 * One shadow, at four indices.
		 *
		 * `shadows` is a fixed 25-entry array indexed by `elevation`, and MUI
		 * reaches into it by number from the components' own defaults: AppBar 4,
		 * Menu and Popover 8, Drawer 16, Dialog 24. Those four are the objects
		 * that leave the document flow, and they are the only things in this
		 * system that get a shadow — elevation between in-flow surfaces is a
		 * lightness step through canvas/surface/elevated instead.
		 *
		 * The other 21 entries stay `none` on purpose, so an arbitrary
		 * `<Paper elevation={6}>` renders flat. That is the point: an author who
		 * wants separation reaches for a ground, not for a number.
		 */
		shadows: Array.from({ length: 25 }, (_, elevation) =>
			elevation === 4 || elevation === 8 || elevation === 16 || elevation === 24
				? palette.overlayShadow
				: "none",
		) as Shadows,

		transitions: {
			/* Mirrors the `--duration-*` and `--ease-*` tokens in index.css, so a
			   MUI transition and a Tailwind one on adjacent elements finish
			   together. Durations are short because this is a tool: the longest
			   is 240ms, and only for something entering the screen. */
			duration: {
				shortest: 80,
				shorter: 120,
				short: 180,
				standard: 180,
				complex: 240,
				enteringScreen: 180,
				leavingScreen: 120,
			},
			easing: {
				easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
				easeOut: "cubic-bezier(0.25, 1, 0.5, 1)",
				easeIn: "cubic-bezier(0.5, 0, 0.75, 0)",
				sharp: "cubic-bezier(0.16, 1, 0.3, 1)",
			},
		},

		palette: {
			mode: palette.mode,

			background: {
				default: palette.canvas,
				paper: palette.surface,
			},

			text: {
				primary: palette.ink,
				secondary: palette.inkMuted,
				disabled: palette.inkDisabled,
			},

			/* `light` and `dark` here are MUI's names for the hover and active
			   states, not luminance claims — in a light palette `accentHover` is
			   darker than `accent`, which is correct and is why these are
			   authored rather than derived. */
			primary: {
				main: palette.accent,
				light: palette.accentHover,
				dark: palette.accentActive,
				contrastText: palette.onAccent,
			},

			/* The system has one accent. `secondary` exists only so MUI's stock
			   purple can never appear; it is the accent, not a second hue. The
			   nine call sites that read it are all "an accent-coloured thing next
			   to another accent-coloured thing", and the two now match. */
			secondary: {
				main: palette.accent,
				light: palette.accentHover,
				dark: palette.accentActive,
				contrastText: palette.onAccent,
			},

			success: family(palette.success, extremes),
			warning: family(palette.warning, extremes),
			error: family(palette.danger, extremes),
			info: family(palette.info, extremes),

			divider: palette.hairline,

			grey,

			/* Absolute black and white, tinted. Every call site composites these
			   through `alpha()` for a shadow or a scrim, so an untinted pair drags
			   a grey cast across a warm palette. */
			common: {
				black: extremes.darkest,
				white: extremes.lightest,
			},

			/**
			 * The interaction states, authored rather than inherited.
			 *
			 * MUI's defaults are alpha overlays — `rgba(0,0,0,0.04)` and friends —
			 * which composite differently over each of the four grounds and were
			 * never checked against any of them. These are opaque steps on the
			 * palette's own ramp instead, so a hovered row on `canvas` and a
			 * hovered row on `surface` both land on a colour the palette chose.
			 *
			 * `disabledOpacity: 1` is the backstop for the eight components listed
			 * above; the opacity numbers that remain are the ones MUI multiplies
			 * into ripples, where a fraction is what is wanted.
			 */
			action: {
				active: palette.inkMuted,
				hover: palette.elevated,
				hoverOpacity: 0.06,
				selected: palette.accentWash,
				selectedOpacity: 0.12,
				focus: palette.accentWash,
				focusOpacity: 0.12,
				disabled: palette.inkDisabled,
				disabledBackground: palette.sunken,
				disabledOpacity: 1,
				activatedOpacity: 0.12,
			},
		},

		/**
		 * Type, on the same scale as `--text-*` in index.css.
		 *
		 * MUI has six heading slots and the scale has three steps, so the slots
		 * collapse in pairs. That is intentional: a desktop app read at arm's
		 * length for hours has no hero, and the previous `h3` at 3rem was a
		 * marketing-page size that no screen in this app has a use for.
		 */
		typography: {
			fontFamily:
				'"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
			fontSize: 16,

			h1: {
				fontSize: "1.75rem",
				lineHeight: 1.2,
				letterSpacing: "-0.02em",
				fontWeight: 600,
			},
			h2: {
				fontSize: "1.75rem",
				lineHeight: 1.2,
				letterSpacing: "-0.02em",
				fontWeight: 600,
			},
			h3: {
				fontSize: "1.25rem",
				lineHeight: 1.3,
				letterSpacing: "-0.012em",
				fontWeight: 600,
			},
			h4: {
				fontSize: "1.25rem",
				lineHeight: 1.3,
				letterSpacing: "-0.012em",
				fontWeight: 600,
			},
			h5: {
				fontSize: "1rem",
				lineHeight: 1.4,
				letterSpacing: "-0.006em",
				fontWeight: 600,
			},
			h6: {
				fontSize: "1rem",
				lineHeight: 1.4,
				letterSpacing: "-0.006em",
				fontWeight: 600,
			},

			subtitle1: { fontSize: "0.875rem", lineHeight: 1.55, fontWeight: 600 },
			subtitle2: { fontSize: "0.8125rem", lineHeight: 1.5, fontWeight: 600 },
			body1: { fontSize: "0.875rem", lineHeight: 1.55 },
			body2: { fontSize: "0.8125rem", lineHeight: 1.5 },
			caption: { fontSize: "0.75rem", lineHeight: 1.45 },
			overline: {
				fontSize: "0.75rem",
				lineHeight: 1.45,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
			},
			button: {
				fontSize: "0.8125rem",
				lineHeight: 1.5,
				fontWeight: 500,
				textTransform: "none",
			},
		},

		components: {
			...disabledOverrides,

			MuiCssBaseline: {
				styleOverrides: {
					/**
					 * The focus ring, MUI's half. One ring, defined once.
					 *
					 * NOTE: the authoritative copy is the unlayered rule at the bottom
					 * of `styles/index.css`. This one only reaches surfaces that
					 * render a `<CssBaseline/>`, which the app does not - Storybook
					 * did, which is how the app shipped without a ring while every
					 * story had one. It is kept so those surfaces stay consistent,
					 * not because anything depends on it.
					 *
					 * `outline` rather than `box-shadow`, but NOT because outlines
					 * escape clipping - they do not. An outline is ink overflow and
					 * an ancestor's `overflow: hidden` clips it just as it clips an
					 * outset shadow. This comment previously asserted the opposite;
					 * the conclusion was right and the reason was wrong, which is the
					 * more dangerous combination because the reason is what gets
					 * reused. Outline is correct here because it follows the
					 * element's own `border-radius` without being told, stays out of
					 * layout, and is what `:focus-visible` tooling expects.
					 *
					 * `:focus-visible` only: a mouse user clicking a button should not
					 * get a ring, a keyboard user tabbing to it must.
					 *
					 * The `html` prefix is load-bearing. `MuiButtonBase` and `MuiChip`
					 * both set `outline: 0` on their own root at single-class
					 * specificity, and emotion injects component styles after the
					 * CssBaseline globals — so an unprefixed `:focus-visible` ties on
					 * specificity and loses on order, and every button, tab, menu item
					 * and list row in the app ends up with no ring at all. Verified in
					 * a browser: without the prefix the computed `outline-offset`
					 * applies and the `outline` does not.
					 *
					 * `!important` is confined to the box-shadow reset, which has to
					 * reach rings MUI ships at two-class specificity such as
					 * `.MuiSlider-thumb.Mui-focusVisible`.
					 */
					"html :focus-visible, html .Mui-focusVisible": {
						outline: `2px solid ${palette.accent}`,
						outlineOffset: "2px",
						boxShadow: "none !important",
					},

					/**
					 * The ring's shape, at zero specificity so it only fills a gap.
					 *
					 * `border-radius: inherit` belongs on an element that has no radius
					 * of its own and sits inside something rounded — a bare focusable
					 * row in a rounded card. Applied at any real specificity it does
					 * the opposite of its intent: a focused Chip would inherit its
					 * parent's radius and stop being a pill for exactly as long as it
					 * is focused. `:where()` makes it lose to any authored radius,
					 * which is precisely the wanted behaviour. index.css carries the
					 * identical rule for the Tailwind half.
					 */
					":where(:focus-visible)": {
						borderRadius: "inherit",
					},
				},
			},

			MuiPaper: {
				styleOverrides: {
					root: {
						/* MUI's dark mode paints a white alpha gradient over Paper to
						   fake elevation. This system already has four authored
						   grounds, so the gradient only desaturates them. */
						backgroundImage: "none",
						backgroundColor: palette.surface,
					},
				},
			},

			MuiAppBar: {
				styleOverrides: {
					root: {
						top: 0,
						/* Opaque, not translucent. The old themes used an 80% canvas
						   with no `backdrop-filter`, so the bar just leaked whatever
						   scrolled behind it. It leaves the flow, so it takes
						   `shadows[4]` from its default elevation. */
						backgroundColor: palette.canvas,
						backgroundImage: "none",
						color: palette.ink,
					},
				},
			},

			MuiListItemButton: {
				styleOverrides: {
					root: {
						borderRadius: 10,
						paddingTop: 12,
						paddingBottom: 12,
						"&:hover": { backgroundColor: palette.elevated },
						"&.Mui-selected": {
							backgroundColor: palette.accentWash,
							color: palette.accent,
							"&:hover": {
								backgroundColor: mix(palette.accentWash, palette.accent, 0.18),
							},
						},
						/* The eighth of the `disabledOpacity` components, applied here
						   rather than in `disabledOverrides` because a duplicate
						   `MuiListItemButton` key would replace this block, not merge
						   into it. */
						"&.Mui-disabled": disabledState,
					},
				},
			},

			MuiIconButton: {
				styleOverrides: {
					root: {
						color: palette.inkMuted,
						"&:hover": {
							backgroundColor: palette.elevated,
							color: palette.ink,
						},
					},
				},
			},

			MuiButton: {
				styleOverrides: {
					root: {
						borderRadius: 6,
						padding: "8px 16px",
					},
					/* Buttons stay flat: a filled button is already separated from its
					   ground by its fill, and a shadow on something that never leaves
					   the flow is the exact confusion this system removes. */
					contained: {
						boxShadow: "none",
						"&:hover": { boxShadow: "none" },
						"&:active": { boxShadow: "none" },
					},
					outlined: {
						borderColor: palette.borderControl,
					},
				},
			},

			MuiCard: {
				styleOverrides: {
					root: {
						backgroundColor: palette.surface,
						borderRadius: 14,
						border: `1px solid ${palette.hairline}`,
					},
				},
			},

			MuiContainer: {
				styleOverrides: {
					/* Pinned to the `lg` / `xl` breakpoints above so a container does
					   not stop growing 100px before its own breakpoint fires. */
					maxWidthLg: {
						maxWidth: "1300px",
						"@media (min-width:1300px)": { maxWidth: "1300px" },
					},
					maxWidthXl: {
						maxWidth: "1800px",
						"@media (min-width:1800px)": { maxWidth: "1800px" },
					},
				},
			},

			MuiTooltip: {
				styleOverrides: {
					tooltip: {
						backgroundColor: palette.elevated,
						color: palette.ink,
						border: `1px solid ${palette.hairline}`,
						borderRadius: 6,
						fontSize: "0.75rem",
						boxShadow: palette.overlayShadow,
					},
					arrow: { color: palette.elevated },
				},
			},

			MuiDivider: {
				styleOverrides: { root: { borderColor: palette.hairline } },
			},

			MuiOutlinedInput: {
				styleOverrides: {
					root: {
						backgroundColor: palette.surface,
						"& .MuiOutlinedInput-notchedOutline": {
							borderColor: palette.borderControl,
						},
						"&:hover .MuiOutlinedInput-notchedOutline": {
							borderColor: palette.accent,
						},
						/* The focused input keeps a 1px border and gets the outline ring
						   like everything else, instead of MUI's 2px border swap, which
						   reflows the text by a pixel on focus. */
						"&.Mui-focused .MuiOutlinedInput-notchedOutline": {
							borderWidth: 1,
							borderColor: palette.accent,
						},
						"&.Mui-disabled .MuiOutlinedInput-notchedOutline": {
							borderColor: palette.hairline,
						},
					},
				},
			},

			MuiBackdrop: {
				styleOverrides: { root: { backgroundColor: palette.scrim } },
			},
		},
	});
};
