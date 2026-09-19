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

import { canvasDocumentForPath } from "@features/chat/utils/canvas-document";
import { getFileTypeFromPath } from "@features/chat/utils/file-types";
import { READ_ENCODING, viewerFor } from "@features/chat/utils/viewer-routing";
import { apiConfig } from "@shared/config";
import {
	panelIdentityFor,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";

/** One animation frame, so a capture sees the paint the action caused. */
function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

/** Consecutive quiet frames that count as settled; three span roughly 50ms. */
const SETTLED_FRAMES = 3;

/**
 * How long the settle is given before a frame is declared not-evidence.
 *
 * WHY A FRAME-COUNT WAIT NEEDS A TIME BOUND AT ALL: the loop below waits for
 * `SETTLED_FRAMES` consecutive frames with no running transition, which is a count
 * of FRAMES and not a duration — so how long it takes is set by this machine's
 * frame interval rather than by the app. On an idle box that interval is ~16ms and
 * the wait costs the transition it follows (`--duration-fast: 120ms` here) plus
 * those three frames; measured on this machine at load average 109, five
 * `--scene states` runs settled in 150-167ms. The tail can be longer, and the
 * failure it would cause is the expensive kind: a settle that gives up FAILS the
 * scene (`renderer-driver.mjs` refuses the frame on `settleTimedOut`), so a slow
 * moment on a loaded machine would be reported as a product defect.
 *
 * So the bound is deliberately LOOSE — ~20x the settle measured above and 25x the
 * app's own longest transition — and its only cost is that an animation which
 * genuinely never ends is declared after three seconds instead of one. Widened
 * from 1000ms for exactly that reason: this figure is a headroom decision, not a
 * measurement of the app. What the bound must NOT do is stay silent about what it
 * caught, which is what `describeRunningTransition` below is for.
 */
const SETTLE_TIMEOUT_MS = 3000;

/** A running `CSSTransition` and nothing else — see the note on the loop below. */
function isRunningTransition(animation: Animation): animation is CSSTransition {
	return (
		animation instanceof CSSTransition && animation.playState === "running"
	);
}

/**
 * Say WHICH element did not settle and what it looked like when we gave up.
 *
 * WHY THIS EXISTS: the bound above used to report only that it had expired, which
 * leaves a reader unable to tell a product defect (something animating forever)
 * from a machine that was simply busy, and unable to find the element at all. The
 * transition's own property and the target's computed value for it are what make
 * the next step possible — they are the same two facts a person would read off the
 * frame, except they are available even when the animation moved between the
 * capture and the complaint.
 *
 * Property names come from the animation registry, so the value is only read for a
 * plain property name; anything else (a shorthand CSSOM cannot resolve, or a target
 * that has left the document) is reported as unreadable rather than guessed at.
 */
function describeRunningTransition(animation: CSSTransition): string {
	const effect = animation.effect;
	const target = effect instanceof KeyframeEffect ? effect.target : null;
	const property = animation.transitionProperty;
	const readable = /^[a-z-]+$/.test(property);
	const value =
		readable && target instanceof Element
			? getComputedStyle(target).getPropertyValue(property).trim() || "(empty)"
			: "(unreadable)";
	return `${property || "(unnamed property)"} on ${describeElement(target) ?? "an element no longer in the document"} = ${value}`;
}

/**
 * Wait for the app's own CSS transitions to finish, and say how long that took.
 *
 * Why two animation frames are not enough for the verbs that change colour. A
 * theme change is not a repaint: the rail and the sidebar rows carry
 * `transition-colors duration-fast` (`--duration-fast: 120ms`), so a frame taken
 * one `nextFrame()` later is a frame OF that transition. Measured, two
 * `--scene states` runs on the same build: `chat-dark.png` came out byte-identical
 * both times (nothing transitions when the theme is set to the one already
 * active) while `chat-light.png` was 80963 B one run and 80225 B the next, with
 * the whole difference inside the rail's active item and its centre pixel still
 * holding the old palette's colour. A committed evidence frame has to be a state
 * the app settles into, not a blend no user sees and no later run can reproduce.
 *
 * Why ONE clean frame was still not enough (`SETTLED_FRAMES` above), and this is
 * also measured rather than defensive: the theme action makes React re-render the
 * rail and the sidebar, so some of their transitions start a frame or two after
 * the ones the class change began, and a single clean check can land in the gap
 * between the two. Two `--scene states` runs on Electron 44.3.0 differed in
 * `chat-light.png` — and only there — by the rail's active pill (srgb(122,133,124))
 * and the banner's `Retry` (srgb(132,129,123)), each about 46% of the way from the
 * dark values (srgb(26,40,30) / srgb(29,26,21)) to the settled light ones
 * (srgb(233,241,233) / srgb(250,248,242)): one shared transition, caught
 * half-way, in a run whose settle reported `timedOut: false` after 175ms.
 *
 * Only `CSSTransition` counts. The app animates other things (pulses, spinners,
 * layout), and waiting on those would mean a scene whose timing is decided by an
 * animation that never ends — which is why the loop also gives up after
 * `SETTLE_TIMEOUT_MS` and reports it rather than spinning. A caller that gets
 * `timedOut: true` knows the frame may be mid-flight AND which transitions were
 * still running (each with the target and that property's computed value at that
 * moment, `describeRunningTransition`); the driver FAILS the scene on that answer
 * and prints them, rather than noting it beside the frame.
 */
async function settleCssTransitions(
	timeoutMs = SETTLE_TIMEOUT_MS,
): Promise<{ waitedMs: number; timedOut: boolean; pending: string[] }> {
	const started = performance.now();
	let quiet = 0;
	for (;;) {
		await nextFrame();
		const waitedMs = Math.round(performance.now() - started);
		const running = document.getAnimations().filter(isRunningTransition);
		quiet = running.length === 0 ? quiet + 1 : 0;
		if (quiet >= SETTLED_FRAMES) {
			return { waitedMs, timedOut: false, pending: [] };
		}
		if (waitedMs > timeoutMs) {
			return {
				waitedMs,
				timedOut: true,
				pending: running.map(describeRunningTransition),
			};
		}
	}
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
	stack: (string | null)[];
	disabled: boolean | null;
	rect: { x: number; y: number; width: number; height: number };
} {
	const rect = element.getBoundingClientRect();
	const x = rect.left + rect.width / 2;
	const y = rect.top + rect.height / 2;
	const hit = document.elementFromPoint(x, y);
	const hitTest = hit !== null && (hit === element || element.contains(hit));
	/*
	 * WHAT THE REPORT MUST CARRY WHEN A HIT TEST FAILS, learned from a scene that
	 * failed only on someone else's machine. `elementFromPoint` alone cannot
	 * distinguish "nothing is there" from "the element is there and is not taking
	 * the pointer right now", and the second is a real state this app has: a
	 * `disabled` control is `pointer-events: none` in this design system, so the
	 * topmost element at its centre is its PARENT, while a synthetic
	 * `dispatchEvent` still reaches it and the press works. The scene reported
	 * only `hit: div ""`, which is why two rounds of readers could not tell a
	 * broken control from a broken instrument. So the stack and the disabled flag
	 * come back with the verdict.
	 */
	const stack = document
		.elementsFromPoint(x, y)
		.slice(0, 4)
		.map((node) => describeElement(node));
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
		stack,
		/*
		 * Read AFTER the dispatch, deliberately: the point of the field is what the
		 * control looks like to the NEXT press, and a control whose disabled window is
		 * ~11ms (this row's, for the length of a forced check) is reported in the state
		 * that made the hit test fail rather than the one it has by the time a human
		 * would look. Safe on React 18.3.1, where the synthetic dispatch is not
		 * synchronously re-entering the state machine from inside this function.
		 */
		disabled: element instanceof HTMLButtonElement ? element.disabled : null,
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
				/*
				 * The third occupant of the right slot, and the one a scene drives by
				 * PRESSING the header's trigger rather than by writing the store: a pane
				 * that is open in the store but has no trigger, or a trigger that does not
				 * open the pane, are different defects and only a press can tell them
				 * apart (`renderer-driver.mjs`'s `browser-pane` scene).
				 */
				browserPaneOpen: preferences.isBrowserPaneOpen,
				browserPanelWidth: preferences.browserPanelWidth,
				activeSessionId: sessions.activeSessionId,
				sessionCount: sessions.sessions.length,
				/*
				 * The wizard's own dialog carries this attribute
				 * (`features/onboarding/components/onboarding-dialog.tsx`). Not
				 * `role="dialog"`: every modal in the app renders that, so the probe would
				 * report whichever dialog is open as the first-run wizard - which is how a
				 * scene that means to assert the wizard owns the window could pass with the
				 * palette open instead.
				 */
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

		/**
		 * The settings picker's own action, so a theme change is the change a user makes.
		 *
		 * Settles the colour transition it starts before answering (see
		 * `settleCssTransitions`), because every caller of this verb is about to
		 * capture a frame and a frame of a 120ms transition is not the palette it
		 * changed to.
		 */
		setTheme: async (payload) => {
			const name = requireString(payload, "theme name");
			useUiPreferencesStore.getState().setTheme(name as never);
			await nextFrame();
			const applied = document.documentElement.getAttribute("data-theme");
			const settled = await settleCssTransitions();
			return {
				theme: useUiPreferencesStore.getState().themeName,
				dataTheme: applied,
				settledAfterMs: settled.waitedMs,
				settleTimedOut: settled.timedOut,
				/*
				 * The transitions still running when the bound expired, named — the
				 * driver prints these beside its FAIL so a timed-out settle says which
				 * element did not settle and what it looked like rather than only that
				 * something did not. Empty on every settled answer.
				 */
				settlePending: settled.pending,
			};
		},

		/**
		 * Read one element's painted box, WITHOUT touching it.
		 *
		 * WHY A SCENE NEEDS THIS AND `press` CANNOT SERVE. A hover is browser state: it
		 * is set by the pointer being over an element, not by an event that element is
		 * handed, so a `group-hover` reveal cannot be produced by dispatching anything
		 * - and the pointer a scene moves has to be the REAL one, through the driver's
		 * own input pipeline (CDP `Input.dispatchMouseEvent`), which lives on the other
		 * side of this bridge. What the driver cannot work out for itself is where the
		 * element IS: the app's layout is its own, and the driver has no evaluation
		 * channel by design (see the module note).
		 *
		 * So this verb answers the one question that leaves: the box, in CSS pixels,
		 * with the same hit test `press` reports, and it deliberately does not click,
		 * focus or scroll anything. A verb that moved the pointer itself would be a
		 * second way to hover, and the point of the split is that the pointer stays the
		 * driver's.
		 */
		measure: async (payload) => {
			const request =
				typeof payload === "string"
					? { selector: payload }
					: (payload as { selector: unknown; timeoutMs?: unknown });
			const selector = requireString(request?.selector, "measure selector");
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
			const rect = element.getBoundingClientRect();
			const centre = {
				x: Math.round(rect.left + rect.width / 2),
				y: Math.round(rect.top + rect.height / 2),
			};
			const hit = document.elementFromPoint(centre.x, centre.y);
			return {
				selector,
				target: describeElement(element),
				centre,
				rect: {
					x: Math.round(rect.x),
					y: Math.round(rect.y),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				},
				hitTest: hit !== null && (hit === element || element.contains(hit)),
				/*
				 * WHETHER THE ELEMENT HAS THE KEYBOARD, which is a question scenes have to
				 * be able to ask and no other verb can answer: the focus fixes of UX round 1
				 * (U3: a refusal must leave the SAFE action holding it, U5/U9: a control that
				 * unmounts must hand it to its successor) are only claims until something
				 * reads `document.activeElement`. Additive, so a scene that does not ask is
				 * unaffected.
				 */
				focused: element === document.activeElement,
				inViewport:
					rect.top >= 0 &&
					rect.left >= 0 &&
					rect.bottom <= window.innerHeight &&
					rect.right <= window.innerWidth,
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

		/**
		 * Put a local file in the canvas, on the pane this app is showing.
		 *
		 * WHY THIS VERB HAS TO EXIST. Every other verb drives something the app puts
		 * on screen by itself, and the canvas's documents view has no such path in a
		 * driver run: its tiles come from a conversation's TRANSCRIPT (which needs a
		 * reachable backend and a session whose messages mention a path), one of the
		 * two controls that open a file directly is an OS dialog (`⌘O`), and the
		 * other - the create-file dialog - renders only under an agent id the pane
		 * takes from a session. So the gesture this stands in for is the one a
		 * reviewer actually makes: a click on a Files-grid tile. It is built out of
		 * the same pieces that handler uses - `probeFiles` for the mtime and the
		 * size, the `READ_ENCODING`/`viewerFor` table for whether this viewer reads
		 * its own bytes, `readFile` for the text kinds, `canvasDocumentForPath` for
		 * the document - and it is deliberately NOT a second copy of the click
		 * handler's branching: what a scene needs from it is a document with the
		 * right facts on it, not the toasts and the OS fallbacks that belong to a
		 * human's click.
		 *
		 * The draft is staged through the store action the New chat row calls, and
		 * that IS a substitution rather than a press: the row's own gesture takes the
		 * `session_catalogue` capability gate, which cannot open in a run with no
		 * backend - and without a pane identity there is no conversation for the
		 * document to belong to, so a canvas with nothing open is all a scene could
		 * photograph.
		 *
		 * It answers with what it opened, so a scene asserts the document the panel
		 * was handed rather than assuming it.
		 */
		openCanvasDocument: async (payload) => {
			const request = payload as { path?: unknown; title?: unknown } | null;
			const path = requireString(request?.path, "canvas document path");
			const title =
				typeof request?.title === "string" ? request.title : undefined;
			const [probe] = await window.api.probeFiles([path]);
			if (!probe || !probe.exists || !probe.isFile) {
				throw new Error(`no file at ${probe?.resolved ?? path}`);
			}
			const document = canvasDocumentForPath(path, {
				title,
				type: getFileTypeFromPath(path),
				availability: "present",
				sizeBytes: probe.sizeBytes ?? undefined,
				lastAgentModified: probe.mtimeMs ?? undefined,
				readMtimeMs: probe.mtimeMs ?? undefined,
			});
			const encoding = READ_ENCODING[viewerFor(path, document.type) ?? "code"];
			if (encoding === "utf-8" || encoding === "base64") {
				const result = await window.api.readFile(document.path, encoding);
				if (!result.success) {
					throw new Error(`could not read ${document.path}`);
				}
				document.content = result.data;
			}
			const sessions = useCanonicalSessionsStore.getState();
			const conversationId =
				panelIdentityFor(sessions.activeDraftKey, sessions.activeSessionId) ??
				sessions.stageDraft();
			useUiPreferencesStore.getState().setCanvasOpen(true);
			useCanvasStore.getState().addFileAndSelect(conversationId, document);
			await nextFrame();
			return {
				conversationId,
				documentId: document.id,
				readMtimeMs: document.readMtimeMs ?? null,
				contentLength: document.content.length,
				encoding,
			};
		},
	});
}
