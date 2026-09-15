/**
 * The renderer dev driver: the verbs a scene is written in.
 *
 * This module is the app's own code — real stores, the real router, real DOM
 * controls — reached by a test driver through `window.__loDevDriver`, which the
 * preload exposes only in an armed launch (`src/main/dev-driver.ts` owns that
 * decision; `docs/agent-driver.md` is the contract). When the bridge is absent,
 * which is every normal launch, this function returns immediately and the module
 * is a no-op: it is imported unconditionally by `main.tsx` because a conditional
 * import is a second place that would have to know whether the run is armed.
 *
 * Why verbs and not a generic "eval some JavaScript in the page": a generic hook
 * would be an unreviewable second way to do everything, and its blast radius
 * would grow with every PR — the review question "what can this reach" would
 * have no answer. Each verb below is instead one named, reviewable path, and its
 * job is to be what a reviewer would click:
 *
 * - `hello` / `state` — read what is on screen right now (route, theme, viewport,
 *   session count). Nothing is driven; this is the "where am I" call.
 * - `navigate` / `setTheme` / `press` — drive it, through the same inputs the app
 *   itself uses (the hash router's URL, the store action the settings picker
 *   calls, a DOM event on a real control).
 * - `capture` / `facts` are the preload's, not this module's: pixels come from
 *   `webContents.capturePage()` in main, which is the app photographing itself.
 *
 * What a verb must NOT become: a way to approve something on the operator's
 * behalf. Approvals are answered by the operator, and a harness that could
 * answer a gate would make every "it works" captured through it worthless.
 */

import { apiConfig } from "@shared/config";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";

/** One animation frame, so a capture sees the paint the action caused. */
function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

/*
 * Top-level so the literal is compiled once: a regex inside a function is rebuilt
 * on every call, and lint's `useTopLevelRegex` exists for exactly this shape.
 */
const LEADING_HASH = /^#/;

function currentRoute(): string {
	const hash = window.location.hash.replace(LEADING_HASH, "");
	return hash === "" ? "/" : hash;
}

function describeElement(element: Element | null): string | null {
	if (!element) return null;
	const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
	return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""} "${name.trim().slice(0, 60)}"`;
}

/**
 * Drive a real control by dispatching the event sequence a pointer produces.
 *
 * The point is to reach the app's own handlers, the way running a scene needs to
 * (open a panel, switch a tab), NOT to prove a control is clickable: these are
 * synthetic DOM events from inside the page, so they bypass the browser's hit
 * testing and its input pipeline. `scripts/click-proof.mjs` exists for the other
 * question and dispatches through CDP for exactly that reason. The hit test is
 * still reported here (and `pressed` says whether the element's own box really
 * receives the point) because a scene that silently pressed something invisible
 * would produce frames that do not mean what the scene claims.
 */
function pressAt(element: Element): {
	hitTest: boolean;
	hit: string | null;
	rect: { x: number; y: number; width: number; height: number };
} {
	const rect = element.getBoundingClientRect();
	const x = rect.left + rect.width / 2;
	const y = rect.top + rect.height / 2;
	const hit = document.elementFromPoint(x, y);
	const hitTest = hit !== null && (hit === element || element.contains(hit));
	const eventInit: MouseEventInit = {
		bubbles: true,
		cancelable: true,
		composed: true,
		button: 0,
		buttons: 1,
		clientX: x,
		clientY: y,
		view: window,
	};
	element.dispatchEvent(
		new PointerEvent("pointerdown", {
			...eventInit,
			pointerId: 1,
			isPrimary: true,
		}),
	);
	element.dispatchEvent(new MouseEvent("mousedown", eventInit));
	element.dispatchEvent(
		new PointerEvent("pointerup", {
			...eventInit,
			buttons: 0,
			pointerId: 1,
			isPrimary: true,
		}),
	);
	element.dispatchEvent(
		new MouseEvent("mouseup", { ...eventInit, buttons: 0 }),
	);
	element.dispatchEvent(new MouseEvent("click", { ...eventInit, buttons: 0 }));
	return {
		hitTest,
		hit: describeElement(hit),
		rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
	};
}

function requireString(payload: unknown, what: string): string {
	if (typeof payload !== "string" || payload === "") {
		throw new Error(`${what} must be a non-empty string`);
	}
	return payload;
}

async function waitForRoute(path: string, timeoutMs = 10_000): Promise<string> {
	const started = Date.now();
	while (currentRoute() !== path) {
		if (Date.now() - started > timeoutMs) {
			throw new Error(`route did not become ${path} (it is ${currentRoute()})`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	await nextFrame();
	return currentRoute();
}

export function installDevDriver(): string[] {
	const bridge = window.__loDevDriver;
	if (!bridge?.armed) return [];

	return bridge.install({
		/** Where the driver is, right now, in the app's own terms. */
		hello: () => ({
			armed: true,
			outDir: bridge.outDir,
			title: document.title,
			route: currentRoute(),
			href: window.location.href,
			theme: useUiPreferencesStore.getState().themeName,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
				devicePixelRatio: window.devicePixelRatio,
			},
			visibilityState: document.visibilityState,
			hasFocus: document.hasFocus(),
			// The renderer's own baked API base: the harness asserts nothing is
			// listening there, because a driver run that reached a live backend
			// could put real data in a frame that is about to be pasted into a PR.
			apiBaseUrl: apiConfig.baseUrl,
			userAgent: navigator.userAgent,
		}),

		/** The state the verbs write into, so a scene can report what it changed. */
		state: () => {
			const preferences = useUiPreferencesStore.getState();
			const sessions = useCanonicalSessionsStore.getState();
			return {
				route: currentRoute(),
				theme: preferences.themeName,
				commandPaletteOpen: preferences.isCommandPaletteOpen,
				canvasOpen: preferences.isCanvasOpen,
				runPanelOpen: preferences.isRunPanelOpen,
				activeSessionId: sessions.activeSessionId,
				sessionCount: sessions.sessions.length,
				onboardingVisible: Boolean(
					document.querySelector("[data-onboarding-modal]"),
				),
			};
		},

		/** Navigate the way the URL does — `HashRouter` reads this hash. */
		navigate: async (payload) => {
			const path = requireString(payload, "navigate path");
			if (!path.startsWith("/")) {
				throw new Error(`navigate path must start with "/" (got "${path}")`);
			}
			window.location.hash = `#${path}`;
			return { route: await waitForRoute(path) };
		},

		/** The settings picker's own action, so a theme change is the change a user makes. */
		setTheme: async (payload) => {
			const name = requireString(payload, "theme name");
			useUiPreferencesStore.getState().setTheme(name as never);
			await nextFrame();
			const applied = document.documentElement.getAttribute("data-theme");
			return {
				theme: useUiPreferencesStore.getState().themeName,
				dataTheme: applied,
			};
		},

		/**
		 * Press a control, waiting for it to exist.
		 *
		 * The wait is part of the verb rather than something a scene does before
		 * calling it: routes here are lazy-loaded (`React.lazy` + `Suspense`), so
		 * "the screen is on the route" and "the control is in the DOM" are
		 * different moments, and a scene that raced them would report a missing
		 * control for a screen that simply had not painted yet.
		 *
		 * Errors when nothing matches, so a scene cannot pass by pressing nothing;
		 * the hit test travels back with the result.
		 */
		press: async (payload) => {
			const request =
				typeof payload === "string"
					? { selector: payload }
					: (payload as { selector: unknown; timeoutMs?: unknown });
			const selector = requireString(request?.selector, "press selector");
			const timeoutMs =
				typeof request?.timeoutMs === "number" ? request.timeoutMs : 10_000;
			const started = Date.now();
			let element: Element | null = null;
			while (element === null) {
				element = document.querySelector(selector);
				if (element !== null) break;
				if (Date.now() - started > timeoutMs) {
					throw new Error(
						`nothing matches ${selector} after ${timeoutMs}ms of waiting`,
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			const result = pressAt(element);
			await nextFrame();
			return { selector, target: describeElement(element), ...result };
		},
	});
}
