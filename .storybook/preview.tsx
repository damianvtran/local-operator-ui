/*
 * The app's real faces. Both renderer entries import this, and until Storybook
 * did too every captured frame rendered `font-mono` as the platform fallback
 * rather than Geist Mono - so the evidence set could not show a typography
 * change, and reviewing type from a screenshot was measuring the reviewer's OS.
 * A verification surface that differs from the product will certify a defect
 * eventually; this is the second time that has bitten this repo, after the
 * <CssBaseline/> focus-ring split.
 */
// @ts-ignore Path aliases don't work for Storybook root
import "@renderer/assets/fonts/fonts.css";
import { CssBaseline } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
// @ts-ignore Path aliases don't work for Storybook root
import { config } from "@renderer/shared/config";
// @ts-ignore Path aliases don't work for Storybook root
import { applyGlassFacts } from "@renderer/shared/hooks/use-window-glass";
// @ts-ignore Path aliases don't work for Storybook root
import { AuthProviders } from "@renderer/shared/providers/auth";
// @ts-ignore Path aliases don't work for Storybook root
import { FeatureFlagProvider } from "@renderer/shared/providers/feature-flags";
// @ts-ignore Path aliases don't work for Storybook root
import { useUiPreferencesStore } from "@renderer/shared/store/ui-preferences-store";
// @ts-ignore Path aliases don't work for Storybook root
import "@renderer/styles/index.css";
// @ts-ignore Path aliases don't work for Storybook root
import { defaultQueryOptions } from "@renderer/shared/api/query-client";
import {
	DEFAULT_THEME,
	applyThemeToDocument,
	getTheme,
	themes,
	// @ts-ignore Path aliases don't work for Storybook root
} from "@renderer/shared/themes";
// @ts-ignore Path aliases don't work for Storybook root
import type { ThemeName } from "@renderer/shared/themes";
// @ts-ignore Path aliases don't work for Storybook root
import { ThemedToastContainer } from "@shared/components/common/themed-toast-container";
// @ts-ignore Path aliases don't work for Storybook root
import {
	DEFAULT_LOCALE,
	currentLocale,
	setLocale,
	subscribeLocale,
} from "@shared/i18n";
// @ts-ignore Path aliases don't work for Storybook root
import { LocaleDirectionProvider } from "@shared/i18n/locale-direction";
import type { Preview } from "@storybook/react";
import {
	QueryClient,
	QueryClientProvider,
	focusManager,
} from "@tanstack/react-query";
import { PostHogProvider } from "posthog-js/react";
import React, { type ReactNode, useLayoutEffect, useRef } from "react";
import { MemoryRouter } from "react-router-dom";

// Mock the Electron preload API for Storybook
if (typeof window !== "undefined") {
	// Mock window.api for Storybook
	// biome-ignore lint/suspicious/noExplicitAny: Necessary for mocking the window object
	(window as any).api = {
		// Mock session storage methods with window variable
		session: {
			getSession: async () => {
				const session = window.sessionStorage.getItem("mock-radient-session");
				return session
					? JSON.parse(session)
					: { jwt: undefined, expiry: undefined };
			},
			storeSession: async (jwt: string, expiry: number) => {
				window.sessionStorage.setItem(
					"mock-radient-session",
					JSON.stringify({ jwt, expiry }),
				);
				return true;
			},
			clearSession: async () => {
				window.sessionStorage.removeItem("mock-radient-session");
				return true;
			},
		},
		// Mock other API methods as needed
		openFile: async () => {},
		openExternal: async () => {},
		systemInfo: {
			getAppVersion: async () => "1.0.0",
			getPlatformInfo: async () => ({
				platform: "darwin",
				arch: "x64",
				nodeVersion: "16.0.0",
				electronVersion: "25.0.0",
				chromeVersion: "114.0.0",
			}),
		},
		// Mock ipcRenderer methods
		ipcRenderer: {
			send: () => {}, // Mock send if needed
			on: () => () => {}, // Mock on and return a cleanup function
			// Mock the new provider auth check
			checkProviderAuthEnabled: async () => {
				console.log(
					"[Storybook Mock] checkProviderAuthEnabled called, returning true",
				);
				// Default to true for Storybook, can be overridden per story if needed
				return true;
			},
		},
		// Mock oauth methods (add if needed for stories using OAuth)
		oauth: {
			login: async (provider: string) => {
				console.log(`[Storybook Mock] oauth.login called for ${provider}`);
				return { success: true };
			},
			logout: async () => {
				console.log("[Storybook Mock] oauth.logout called");
				return { success: true };
			},
			getStatus: async () => {
				console.log("[Storybook Mock] oauth.getStatus called");
				// Simulate logged-out status by default
				return { success: true, status: { loggedIn: false, provider: null } };
			},
			onStatusUpdate: (
				_callback: (status: {
					loggedIn: boolean;
					provider: string | null;
				}) => void,
			) => {
				console.log("[Storybook Mock] oauth.onStatusUpdate listener added");
				// Return a no-op cleanup function
				return () => {
					console.log("[Storybook Mock] oauth.onStatusUpdate listener removed");
				};
			},
		},
	};
}

/**
 * Every theme the app ships, in registry order.
 *
 * Read off the registry rather than written out, because a hand-kept list here
 * is a list that goes stale the day a thirteenth palette lands and then quietly
 * makes that palette unreviewable.
 */
const THEME_IDS = Object.keys(themes) as ThemeName[];

/**
 * The theme frame, applied to every story.
 *
 * This lives here rather than in each story file because the failure mode of
 * the per-story version was silent: a story without a copy rendered the default
 * palette whatever theme was asked for, and `scripts/capture-evidence.mjs`
 * would still write twelve files named for twelve themes with identical pixels
 * in them. Evidence that asserts something false is worse than no evidence, and
 * the only way to make it impossible is to leave the story no way to opt out.
 *
 * All three halves of the bridge move together, from the one `theme` arg:
 *
 *  - MUI bakes palette values into Emotion classes as literal hexes when
 *    `createBaseTheme` runs, so it needs the theme OBJECT through context;
 *  - Tailwind role utilities resolve `--lo-*` live off `data-theme`, so the
 *    document element needs the attribute and the matching `dark` class;
 *  - components that read the palette from the preferences store rather than
 *    from context (the shell, the theme selector) need the store set.
 *
 * Moving only one of the three is what produced dark ink on light paper in
 * earlier evidence runs and read as a contrast defect in the product.
 */
const ThemeFrame = ({
	theme,
	children,
}: {
	theme: ThemeName;
	children: ReactNode;
}) => {
	/*
	 * `useLayoutEffect` so the attribute lands in the same commit as the MUI
	 * theme below; a `useEffect` shows one painted frame of the previous
	 * palette's variables under the new MUI theme on every switch, which a
	 * screenshot run is fast enough to catch.
	 */
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({ themeName: theme });
		applyThemeToDocument(theme);
	}, [theme]);

	/* No teardown restoring the previous theme: every story mounts through this
	   frame and sets its own, so a restore would only ever paint a palette
	   nothing asked for between two stories. */
	return (
		<div className="min-h-screen bg-canvas font-sans text-body text-ink">
			{children}
		</div>
	);
};

/**
 * THE GLASS FRAME, applied to every story.
 *
 * The window glass is an Electron capability: MAIN resolves it before a window
 * exists, and the renderer paints its answer as `data-glass` plus the
 * `--lo-glass-*` alphas. Storybook has neither process, so before this frame a
 * surface that only reveals its defects under glass - the Projects board's
 * lane and column strip are the case that found this - could not be captured
 * at all. The frame writes the SAME paint the shipped hook writes
 * (`applyGlassFacts`), with the scheme read from the theme `ThemeFrame` has
 * just applied, so the alphas are the shipped derivation rather than a
 * hand-picked alpha.
 *
 * OFF BY DEFAULT, like `applyGlassFacts(null)`: every existing story keeps the
 * flat frame it has always painted. An evidence run asks for glass through the
 * preview's own `glass` arg (`?args=glass:on`), the same URL seam the theme
 * and locale pins use. It sits OUTSIDE `ThemeFrame` on purpose: React runs a
 * child's layout effect first, so the outer frame reads `classlist` and the
 * palette AFTER the theme commit rather than one frame late.
 */
const GlassFrame = ({
	glass,
	glassIntensity,
	ownsGlass,
	theme,
	children,
}: {
	glass: boolean;
	glassIntensity: number;
	/** The story's own meta decorator paints the document (Library's harness). */
	ownsGlass: boolean;
	theme: ThemeName;
	children: ReactNode;
}) => {
	useLayoutEffect(() => {
		/* Do not clear a paint a child decorator made on purpose. Storybook's
		 * global decorator is OUTERMOST and React runs layout effects child-first,
		 * so the off path would otherwise erase the Library harness's glass one
		 * effect after it painted. */
		if (!glass && ownsGlass) return;
		const scheme =
			getTheme(theme).theme.palette.mode === "dark" ? "dark" : "light";
		applyGlassFacts(
			glass
				? {
						mechanism: "vibrancy",
						coverage: "full",
						intensity: Math.min(100, Math.max(0, glassIntensity)),
						material: "window",
						scheme,
					}
				: null,
		);
	}, [glass, glassIntensity, ownsGlass, theme]);
	return <>{children}</>;
};

/**
 * The locales an evidence run may pin.
 *
 * WHY THIS EXISTS. A locale change is user-visible and its risk is width (some
 * locales run longer than English, and the console capacity line is
 * width-critical), but this Storybook had no way to render a non-English
 * locale: the renderer locale store (`src/i18n/locale.ts`) resolves from the
 * backend's `language` answer or, before that, `navigator.language` - which in
 * a Storybook host is the operator's own OS language. The language-door story's
 * backend stub does not carry the shipped choices either, so those locales
 * render as "Not available" and no locale frame could be captured at all.
 *
 * This is the reuse precedent the theme arg set: one preview-level arg whose
 * decorator writes the locale through the store's own `setLocale` seam -
 * exactly the seam `locale.ts` documents for fixtures - so a capture run can
 * drive a locale with `?args=locale:<tag>` and get a REAL frame in that locale,
 * not a guessed one. Keep this list in step with the shipped catalogues under
 * `src/i18n/catalogues/`.
 */
/*
 * Read off the catalogue directories rather than written out, the same reason
 * `THEME_IDS` reads the registry: a hand-kept list goes stale the day a locale
 * ships and then quietly makes it unreviewable. `import.meta.glob` is Vite's,
 * and Storybook runs this file through Vite, so the keys are the locale
 * directories under `src/i18n/catalogues/` at build time.
 */
const LOCALE_IDS = Object.keys(
	import.meta.glob("../src/i18n/catalogues/*/ui.settings.json"),
)
	.map((p) =>
		p.replace("../src/i18n/catalogues/", "").replace("/ui.settings.json", ""),
	)
	.sort((a, b) => a.localeCompare(b));

/**
 * The locale frame, applied to every story, mirroring `ThemeFrame`.
 *
 * `useLayoutEffect` so the store moves in the same commit as the render: a
 * `useEffect` would let the first painted frame show the previous locale's
 * strings, which a screenshot run is fast enough to catch.
 */
const LocaleFrame = ({
	locale,
	children,
}: {
	locale: string;
	children: ReactNode;
}) => {
	/*
	 * Set the locale before the children below render, so a story that calls `t()`
	 * inline reads the requested locale on its VERY FIRST paint.
	 *
	 * WHY FIRST RENDER ONLY, and why in the body at all. Two failed shapes, both
	 * measured:
	 *  - a `useLayoutEffect` is too late: children render before their parent's
	 *    effects run, so an inline `t()` would paint the previous locale (English
	 *    under an `?args=locale:ru` request);
	 *  - a guarded body write (`if (currentLocale() !== locale)`) does not help and
	 *    is not what the effect below uses: on the interactive arg-change path the
	 *    store still holds the OLD locale, so the guard is true, the write proceeds
	 *    during render, and React still warns "Cannot update a component while
	 *    rendering a different component"; where the guard would be false, the
	 *    store's `setState` has already no-opped, so the guard buys nothing.
	 *
	 * The ref gate writes exactly once, on mount, and hands every later change
	 * (the arg moving, or a story's bridge stub answering `capabilities` with a
	 * fixed `language`) to the layout effect + subscription below, which run
	 * outside render and therefore cannot warn.
	 */
	const seeded = useRef(false);
	if (!seeded.current) {
		seeded.current = true;
		setLocale(locale);
	}

	/*
	 * Every later locale move, outside render: the requested value on an arg
	 * change, and a STICKY re-assert against a story whose own bridge stub answers
	 * `capabilities` with a fixed `language` (the language-door story returns "en"),
	 * which `useI18nLocaleSync` would otherwise apply over the pin. The
	 * subscription re-asserts only on real drift, so it cannot spin.
	 */
	useLayoutEffect(() => {
		setLocale(locale);
		return subscribeLocale(() => {
			if (currentLocale() !== locale) setLocale(locale);
		});
	}, [locale]);

	return <>{children}</>;
};

/**
 * THE CHROME FRAME: one story arg that puts the document in a platform's chrome
 * geometry, so a shell frame can be captured at the macOS lane the product
 * actually ships instead of at `--chrome-strip-h: 0`.
 *
 * WHY IT IS AN ARG AND NOT A STORY DECORATOR. The lane, the sidebar pad and the
 * route body are shell decisions; a story that wants the 32px strip must not
 * re-spell the attributes the app's `main.tsx` writes. This is the one writer
 * in Storybook, and it writes exactly the four facts `useWindowChrome` writes
 * (mode, platform, leading, trailing) plus fullscreen=false. The CSS derives
 * `--chrome-strip-h: 32px` from that pair, so the frame measures the same
 * variable the window does.
 *
 * DRIVEN BY `?args=chrome:mac32`; `native` clears the attributes so every
 * existing story keeps the geometry it had before this existed.
 */
const CHROME_ATTRS = [
	"chromeMode",
	"chromePlatform",
	"chromeLeading",
	"chromeTrailing",
	"chromeFullscreen",
] as const;

const ChromeFrame = ({
	chrome,
	children,
}: {
	chrome: string;
	children: ReactNode;
}) => {
	useLayoutEffect(() => {
		const root = document.documentElement;
		if (chrome !== "mac32") return;
		root.dataset.chromeMode = "integrated";
		root.dataset.chromePlatform = "mac";
		root.dataset.chromeLeading = "false";
		root.dataset.chromeTrailing = "false";
		root.dataset.chromeFullscreen = "false";
		return () => {
			for (const name of CHROME_ATTRS) delete root.dataset[name];
		};
	}, [chrome]);
	return <>{children}</>;
};

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		/* The backgrounds addon paints one fixed colour behind the story, which
		   under a light theme is a dark slab the product never shows. The frame
		   below paints `bg-canvas` instead, so the ground follows the theme. */
		backgrounds: { disable: true },
	},
	/* Declared at preview level so EVERY story has the arg, which is both what
	   puts the control in the panel and what lets the capture script drive a
	   theme through `?args=theme:<id>`. Storybook drops a URL arg a story has
	   not declared, which is how six story files came to ignore it. */
	argTypes: {
		theme: { control: { type: "select" }, options: THEME_IDS },
		locale: { control: { type: "select" }, options: LOCALE_IDS },
		glass: { control: { type: "select" }, options: ["off", "on"] },
		glassIntensity: { control: { type: "range", min: 0, max: 100, step: 1 } },
		chrome: { control: { type: "select" }, options: ["native", "mac32"] },
	},
	args: {
		theme: DEFAULT_THEME,
		locale: DEFAULT_LOCALE,
		glass: "off",
		glassIntensity: 80,
		chrome: "native",
	},
	decorators: [
		(Story, context) => {
			const queryClient = queryClientFor(context.id);
			const theme = (context.args.theme as ThemeName) ?? DEFAULT_THEME;
			const locale =
				(context.args.locale as string | undefined) ?? DEFAULT_LOCALE;
			const glass = context.args.glass === "on";
			const glassIntensity = Number(context.args.glassIntensity ?? 80);
			const chrome = (context.args.chrome as string | undefined) ?? "native";
			const storyOwnsGlass = Boolean(context.parameters?.glass) && !glass;
			const muiTheme = getTheme(theme).theme;

			return (
				<QueryClientProvider client={queryClient}>
					<MemoryRouter>
						<PostHogProvider
							apiKey={config.VITE_PUBLIC_POSTHOG_KEY}
							options={{
								api_host: config.VITE_PUBLIC_POSTHOG_HOST,
								autocapture: false,
								capture_pageview: false,
							}}
						>
							<FeatureFlagProvider>
								<AuthProviders
									googleClientId={config.VITE_GOOGLE_CLIENT_ID}
									microsoftClientId={config.VITE_MICROSOFT_CLIENT_ID}
									microsoftTenantId={config.VITE_MICROSOFT_TENANT_ID}
								>
									<MuiThemeProvider theme={muiTheme}>
										<CssBaseline />
										<GlassFrame
											glass={glass}
											glassIntensity={glassIntensity}
											ownsGlass={storyOwnsGlass}
											theme={theme}
										>
											<ThemeFrame theme={theme}>
												<LocaleFrame locale={locale}>
													{/*
													 * RADIX'S DIRECTION COMES FROM THIS CONTEXT, NOT FROM `<html dir>`: a
													 * menu's content is portalled out of the subtree that inherits the root
													 * attribute, so without this provider every portalled surface measures
													 * `ltr` in Urdu and every logical inset lands on the physical wrong edge
													 * - measured on the device picker (design review round 1, D5): `ltr`,
													 * `rect 747,38 320x416` before; `rtl`, `rect 537.5,38 320x416` after.
													 * The app mounts the same provider around `App` in `main.tsx`, inside its
													 * router. Here it sits INSIDE `LocaleFrame`, so the locale store is
													 * already written when this provider reads it and the first frame is not
													 * one frame of LTR.
													 */}
													<LocaleDirectionProvider>
														<ChromeFrame chrome={chrome}>
															<Story />
														</ChromeFrame>
													</LocaleDirectionProvider>
												</LocaleFrame>
											</ThemeFrame>
										</GlassFrame>
										<ThemedToastContainer
											duration={context.parameters.toastDuration}
										/>
									</MuiThemeProvider>
								</AuthProviders>
							</FeatureFlagProvider>
						</PostHogProvider>
					</MemoryRouter>
				</QueryClientProvider>
			);
		},
	],
};

/**
 * The fixture's React Query environment, built from the policy the app SHIPS
 * and stated in the two places a capture rig differs from a window.
 *
 * Design round 4 (D1) measured the refusal story as a submit that never
 * settles: `Saving…` for minutes, an empty toast region, no field marker, no
 * rejection in the console. Driven with the real library (React Query 5.73.3,
 * the story's own 409 envelope, the real `createSessionVariable`), the ways a
 * mutation comes to rest are these - and a mutation that is PAUSED never rests
 * at all: `onError` never runs, so the hook's toast never appears, and the
 * caller's `await onSubmit(...)` never returns, so the dialog's own catch - the
 * sentence beside the Name field - never runs either. That is the measured
 * shape, symptom for symptom.
 *
 * ```
 * client                          environment              result
 * bare `new QueryClient()`        online, hidden tab       rejects (1 op issued)
 * bare `new QueryClient()`        offline blip, hidden tab NEVER SETTLES (0 ops)
 * bare `new QueryClient()`        offline blip, visible    rejects (1 op)
 * the shipped policy              online, hidden tab       NEVER SETTLES (1 op)
 * the shipped policy              offline blip, hidden tab NEVER SETTLES (1 op)
 * the shipped policy              focus stated, offline    rejects (2 ops)
 * ```
 *
 * Two independent causes, and the fixture has to remove both.
 *
 * 1. `networkMode`. The client used to be `new QueryClient()`, whose defaults
 *    are React Query's, not the app's. `query-client.ts` says in its own words
 *    why that is not a neutral choice - "a verification surface has to be able
 *    to CONSTRUCT this policy rather than approximate it" - and the one that
 *    matters here is `mutations.networkMode: "always"`. React Query's default
 *    is `"online"`, which parks a mutation - without so much as issuing the
 *    request: 0 ops above - while `onlineManager` reports offline.
 *    `onlineManager` follows real `online`/`offline` window events, so a blip
 *    of the host's own network stack parks it, which is also why the symptom
 *    appeared in a different pair of themes each round.
 *
 * 2. Focus, which is not about the client at all - and this is the part that
 *    makes cause 1's correction necessary rather than sufficient. The only
 *    thing that lifts a paused mutation is
 *
 *        focusManager.isFocused() && (networkMode === "always" || online)
 *
 *    (`retryer.canContinue`), and `isFocused()` is `document.visibilityState
 *    !== "hidden"` unless it was set. A capture tab is a background tab by
 *    construction (UX round 4, M1), so it reads UNFOCUSED - while the app ships
 *    `mutations.retry: 1`, so every refusal is retried after a one-second sleep
 *    that checks exactly that condition first. Under the shipped policy in this
 *    rig the fixture's single 409 therefore parks on its own retry, for the
 *    page's life: the "online, hidden tab -> NEVER SETTLES" row above, with the
 *    request already issued and the response already parsed. Production never
 *    sees it, because a window the user is looking at is visible.
 *
 *    So the fixture states the one environment fact the rig cannot provide and
 *    production always has. AGENTS.md already asks for this on live harnesses
 *    - "force focus with CDP `Emulation.setFocusEmulationEnabled(true)` - and
 *    say which you did" - and this is that statement for the Storybook rig,
 *    made at import time so it is in place before any story mounts. It moves
 *    React Query's own signal only: no CSS `:focus`, no rendering. It is also
 *    what keeps `refetchOnWindowFocus` from firing on the manager tab's
 *    visibility changes, which the rig can otherwise deliver mid-frame and
 *    which no production window does while a dialog is open.
 *
 * The client is keyed by the story's own id rather than built inside the
 * decorator's render, because React Query binds a mutation to the cache that
 * created it: a client rebuilt on a decorator re-render - Storybook re-invokes
 * the render on context and arg updates - leaves every in-flight mutation and
 * refetch on a cache nothing is observing any more, and the promise
 * `mutateAsync()` handed back belongs to the abandoned one. One client per
 * story is stable across those re-renders and two stories still cannot see each
 * other's cache, which is the isolation the per-render client was accidentally
 * providing.
 */
focusManager.setFocused(true);

const queryClients = new Map<string, QueryClient>();
const queryClientFor = (storyId: string): QueryClient => {
	let client = queryClients.get(storyId);
	if (!client) {
		client = new QueryClient({ defaultOptions: defaultQueryOptions });
		queryClients.set(storyId, client);
	}
	return client;
};

export default preview;
