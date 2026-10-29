import { useEffect, useState } from "react";
import {
	type GlassScheme,
	type GlassSettings,
	type WindowGlassFacts,
	type WindowGlassState,
	glassPaintFor,
} from "../../../../shared/window-glass";

/**
 * The renderer's half of the window glass (translucency, on by default where the
 * machine supports it).
 *
 * MAIN OWNS THE SETTING (it must know it before a window exists); this file turns
 * what main says into the two things CSS can read: `data-glass` on the document
 * element (the kinds of surface that are translucent) and the `--lo-glass-*` alpha
 * custom properties. `styles/index.css` ("WINDOW GLASS") is the only consumer, and
 * it overrides ONLY the `background-color` of an element that opted in with
 * `data-glass-region`, so nothing here can repaint a card, an input or a menu.
 *
 * ABSENT MEANS THE SHIPPED LOOK. With no attribute and no variables every rule in
 * that section is dormant, which is the inactive guarantee on this side of the
 * process boundary: a launch whose glass is off (chosen or gated) runs the
 * stylesheet it always ran.
 *
 * THE SCHEME IS READ FROM THE DOCUMENT (`.dark`, written by
 * `applyThemeToDocument`) because the alpha floors differ by scheme: a dark palette
 * over a dark material and a light one over a light material have different worst
 * backdrops. The theme provider calls `syncGlassScheme` in the same layout effect
 * that applies the theme, so the alphas and the palette change in one frame.
 */

const root = (): HTMLElement => document.documentElement;

/** The `--lo-glass-*` names this module may have written, so a switch-off can clear them. */
const GLASS_VARS = [
	"--lo-glass-a-canvas",
	"--lo-glass-a-surface",
	"--lo-glass-a-elevated",
	"--lo-glass-a-row-hover",
	"--lo-glass-a-row-selected",
	"--lo-glass-a-row-work",
	"--lo-glass-a-block-veil",
	"--lo-glass-a-band-floor",
	"--lo-glass-a-lane",
	"--lo-glass-lane-tone",
	"--lo-glass-a-field",
	"--lo-glass-control-mix",
	"--lo-glass-in-surface",
	"--lo-glass-in-elevated",
] as const;

type Applied = {
	active: boolean;
	/** The scheme the alphas were derived for. The first paint takes main's
	 * persisted one (the theme has not been applied yet); every later paint reads
	 * the document, which `applyThemeToDocument` has already updated. */
	scheme: GlassScheme;
	mechanism: "vibrancy" | "background-material";
	settings: Pick<GlassSettings, "coverage" | "intensity" | "material">;
};

let applied: Applied | null = null;

export const documentScheme = (): GlassScheme =>
	root().classList.contains("dark") ? "dark" : "light";

function paint(next: Applied | null): void {
	applied = next;
	const el = root();
	if (!next || !next.active) {
		delete el.dataset.glass;
		for (const name of GLASS_VARS) el.style.removeProperty(name);
		return;
	}
	const { kinds, vars } = glassPaintFor({
		coverage: next.settings.coverage,
		intensity: next.settings.intensity,
		mechanism: next.mechanism,
		material: next.settings.material,
		scheme: next.scheme,
	});
	el.dataset.glass = kinds;
	for (const [name, value] of Object.entries(vars))
		el.style.setProperty(name, value);
}

/** The first paint, from the preload's synchronous argv fact (`null` = off). */
export function applyGlassFacts(facts: WindowGlassFacts): void {
	paint(
		facts
			? {
					active: true,
					scheme: facts.scheme,
					mechanism: facts.mechanism,
					settings: {
						coverage: facts.coverage,
						intensity: facts.intensity,
						material: facts.material,
					},
				}
			: null,
	);
}

/** A state main pushed or answered with. */
export function applyGlassState(state: WindowGlassState | null): void {
	if (!state || !state.active || state.capability.mechanism === "none") {
		paint(null);
		return;
	}
	/*
	 * A flip that needs a restart (Windows: the window was built without its
	 * material) is NOT painted: translucent CSS over an opaque OS window would be a
	 * see-through app showing a flat colour - the half-applied state the restart
	 * note exists to prevent. The reverse (a restart-pending OFF) is the branch
	 * ABOVE: it clears the paint at once, because opaque CSS over a window whose
	 * material is still on screen reads as the ordinary solid app, which is what an
	 * OFF should look like while the restart is pending (review R5).
	 */
	if (state.restartRequired && state.active) {
		return;
	}
	paint({
		active: true,
		scheme: documentScheme(),
		mechanism: state.capability.mechanism,
		settings: {
			coverage: state.settings.coverage,
			intensity: state.settings.intensity,
			material: state.settings.material,
		},
	});
}

/**
 * Re-derive the alphas after the palette's scheme changed, and tell main so the
 * OS material's tone is pinned to it. Called from the theme provider's layout
 * effect; a no-op when glass is off, so the default path adds no IPC.
 */
export function syncGlassScheme(): void {
	if (!applied || !applied.active) return;
	paint({ ...applied, scheme: documentScheme() });
	void window.api?.windowGlass?.reportScheme?.(documentScheme());
}

/**
 * Subscribe the DOCUMENT to main's pushes, once, at startup.
 *
 * The paint must not depend on the Settings page being mounted: main pushes a new
 * state when the OS "Reduce transparency" switch flips (the window must go opaque
 * at once, wherever the user is), and a state applied only by a hook that lives in
 * Settings would leave the CSS translucent over an OS window that has gone
 * opaque - text on a flat colour that was designed for glass. Found by driving the
 * real app: a state written while another page was showing never reached the CSS.
 */
export function subscribeGlassPaint(): () => void {
	const api = window.api?.windowGlass;
	if (!api) return () => {};
	/*
	 * SUBSCRIBE FIRST, THEN CONVERGE (QA round 2, Q-1). The launch gate is
	 * deliberately optimistic: Electron reports `disabled_software` for the GPU
	 * until the first `gpu-info-update`, so a window can be built translucent and
	 * main can drop the capability BEFORE this document's listener exists. A
	 * push-only subscription then misses that state and the renderer paints glass
	 * forever while main answers `active:false` (measured on the built app with
	 * `--disable-gpu-compositing`). Listening first closes the gap for later
	 * pushes; the report answer and one `get` catch the state that landed before
	 * the listener did. IPC messages from main arrive in the order main handled
	 * them, so a later push still wins over either answer.
	 */
	const off = api.onState((next) => applyGlassState(next));
	const applyAnswer = (next: WindowGlassState | null): void => {
		if (next) applyGlassState(next);
	};
	/*
	 * The one capability fact only the renderer has (`criterion: detect then
	 * decide`, renderer half). Sent even when glass is off at this instant: the
	 * answer decides whether a LATER enable is allowed, and main starts undecided
	 * so the first frame is never blocked by waiting for this message. A renderer
	 * without `CSS` (a test host, not Electron) reports nothing rather than a
	 * false negative.
	 */
	if (typeof CSS !== "undefined")
		void api
			.reportRenderer?.({
				backdropFilter: CSS.supports("backdrop-filter: blur(1px)"),
			})
			.then(applyAnswer, () => {});
	/* The authoritative state at boot, for a drop that beat the subscription. */
	void api.get?.().then(applyAnswer, () => {});
	return off;
}

/** The Settings row's view of the glass: the state, and a setter that applies the answer. */
export function useWindowGlass(): {
	state: WindowGlassState | null;
	set: (patch: Partial<GlassSettings>) => Promise<void>;
} {
	const [state, setState] = useState<WindowGlassState | null>(null);
	useEffect(() => {
		const api = window.api?.windowGlass;
		if (!api) return;
		let cancelled = false;
		void api.get().then((next) => {
			if (!cancelled) setState(next);
		});
		/* The paint is `subscribeGlassPaint`'s; this only mirrors the state for the row. */
		const off = api.onState((next) => setState(next));
		return () => {
			cancelled = true;
			off();
		};
	}, []);
	const set = async (patch: Partial<GlassSettings>): Promise<void> => {
		const next = await window.api?.windowGlass?.set(patch);
		if (!next) return;
		setState(next);
		applyGlassState(next);
		/* The scheme the material is pinned to follows the palette; say it once on
		 * the first enable, when main has no report yet. */
		void window.api?.windowGlass?.reportScheme?.(documentScheme());
	};
	return { state, set };
}
