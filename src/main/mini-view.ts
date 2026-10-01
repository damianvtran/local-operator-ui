/**
 * The mini view's window: creation, sizing, positioning and dismissal.
 *
 * WHAT THIS MODULE MAY NOT DO, and why it is worth stating before anything
 * else: it contains NO call that raises a window — no show, no showInactive,
 * no focus, no maximize. Presentation goes through `window-raise.ts`, the one
 * module in the main process allowed to call them, so the launch mode's policy
 * is applied at a single gate and `scripts/window-mode.test.mjs` (which scans
 * every module under `src/main` for that family, comments included) can keep
 * proving it. This file's own `summon` therefore ends in
 * `presentMiniView(window, show, …)`, and the `show` it hands over is the
 * LAUNCH PLAN's: a run that resolved `inactive` or `headless` cannot present
 * this window even if one somehow existed, which is what makes "an agent run
 * cannot show it" structural rather than a convention.
 *
 * WHY THE WINDOW IS CREATED ONCE, HIDDEN, AT APP READY (design D6/§G.1). The
 * hotkey must answer on the first press, and a window created at that moment
 * would pay its renderer's whole boot in the interaction; the design's measured
 * cost model accepts one extra hidden renderer for the app's life instead
 * (risk K6 — measured in the PR's evidence). The window exists only in a
 * `normal` launch: `index.ts` creates it under that condition alone, so every
 * rig-shaped run stays byte-for-byte the app it was.
 *
 * DISMISSAL IS NOT A RAISE. `hide()` puts the window away without touching any
 * of the four banned calls — hide is not "present" — and the four named
 * reasons (`escape`, `blur`, `sent`, `error-dismiss`) arrive over IPC so the
 * renderer's own acts (Esc, losing focus, the sent flash, the error's dismiss)
 * can each say which one they were.
 *
 * AN ACCIDENTAL CLOSE HIDES INSTEAD. A frameless utility window is still
 * closable through the app menu's close item (Cmd+W), and a destroyed mini
 * view would be a silently dead hotkey — the exact failure class this feature's
 * design forbids. So `close` is intercepted while the view is live and turned
 * into a hide; `dispose()` (the quit path) stands the interception down so the
 * app can close it for real.
 */

import {
	BrowserWindow,
	type IpcMainEvent,
	type IpcMainInvokeEvent,
	app,
	ipcMain,
	screen,
} from "electron";
import {
	MINI_VIEW_DISMISS,
	MINI_VIEW_HEIGHT,
	MINI_VIEW_MAX_HEIGHT,
	MINI_VIEW_PAINTED,
	MINI_VIEW_RESIZE,
	MINI_VIEW_SUMMONED,
	MINI_VIEW_WIDTH,
	type MiniViewSummonedPayload,
	isMiniViewDismissReason,
	isMiniViewResizePayload,
} from "../shared/mini-view";
import { windowChromeArgumentFor } from "../shared/window-chrome";
import type { WindowChromeMode } from "../shared/window-chrome";
import { telemetryArgument } from "./telemetry-launch";
import type { WindowShow } from "./window-mode";
import { type RaiseReport, presentMiniView } from "./window-raise";

/**
 * The mini document, derived from the trusted renderer URL.
 *
 * The SAME two shapes the console capture's derivation documents (its own
 * module, `console/capture-url.ts`, is this function's precedent and carries
 * the full rationale): a built or packaged run hands over a `file:` URL ending
 * in `index.html` — the mini document is its sibling — while a dev run hands
 * over electron-vite's origin, where the document is APPENDED. Treating the two
 * as one shape is how a dev run silently loads the app's own `index.html`
 * instead, which answers no measurement at all.
 */
const INDEX_DOCUMENT_SUFFIX = /\/?index\.html(\?.*)?$/;

/** A trailing slash on a dev-server origin, so the document is appended once. */
const TRAILING_SLASH = /\/$/;

export const MINI_DOCUMENT = "mini.html";

export function miniViewUrlFor(rendererUrl: string): string {
	return INDEX_DOCUMENT_SUFFIX.test(rendererUrl)
		? rendererUrl.replace(INDEX_DOCUMENT_SUFFIX, `/${MINI_DOCUMENT}`)
		: `${rendererUrl.replace(TRAILING_SLASH, "")}/${MINI_DOCUMENT}`;
}

export interface MiniView {
	/** The window itself, for callers that need geometry facts (the driver). */
	window: BrowserWindow;
	/**
	 * The hotkey's whole behaviour: hide when already up, otherwise place under
	 * the cursor and present through `window-raise.ts`.
	 */
	toggle(): void;
	/** Put the window away without presenting anything. */
	hide(): void;
	/** The quit path: stand the close interception down and destroy the window. */
	dispose(): void;
}

/**
 * The mini window's GROUND, painted by the window itself before any document
 * has rendered.
 *
 * WHY IT EXISTS AT ALL. A frameless window on macOS paints WHITE under an
 * unpainted document, and the shipped defect this answers was exactly that: the
 * popup opened as a blank white rounded card (each new renderer read a swapped
 * bundle through a stale main process, so its first load never committed). The
 * show-after-ready handshake below is the primary guard - this is the belt for
 * the frame between `show()` and the compositor's first frame, and it is the
 * dark theme's own canvas ground rather than a new colour.
 */
export const MINI_VIEW_GROUND = "#22201c";

/**
 * How long presentation waits for the renderer's first-commit signal.
 *
 * The signal is the guard that matters; this is what stops a load that never
 * commits (a mangled bundle, a renderer that died before paint, a document that
 * fails to parse) from leaving a summons unanswered. On expiry the error card is
 * loaded and shown instead of the blank window.
 */
export const MINI_VIEW_PAINT_TIMEOUT_MS = 1500;

/**
 * What a summon should do, given the plan and the renderer's readiness.
 *
 * PURE, and exported for the same reason `miniViewUrlFor` is: it is the whole
 * decision, and the harness can drive every arm without constructing a window
 * (the electron stub deliberately does not fake one). `wait` is the state the
 * shipped build was missing - it presented whenever the plan said it could,
 * with no idea whether the document behind it had painted anything.
 */
export type MiniViewPresentation = "present" | "wait" | "error-surface";

export function miniViewPresentationFor(input: {
	show: WindowShow;
	painted: boolean;
	timedOut: boolean;
}): MiniViewPresentation {
	// A plan that may not present never waits: nothing is going to be shown, so
	// there is no blank card to prevent and no reason to hold a timer.
	if (input.show !== "focus") return "present";
	if (input.painted) return "present";
	if (input.timedOut) return "error-surface";
	return "wait";
}

/**
 * The load-failure card: a static document, dark, one honest sentence.
 *
 * HELD IN MAIN, as a `data:` URL, deliberately. Every other surface in this app
 * is a bundle the renderer must parse - and the failure this card answers is
 * precisely "the renderer could not produce a document", so a card that needed
 * its own bundle could fail with it. It carries no script (nothing to be blocked
 * by a CSP, nothing to throw) and no external fetch: `did-finish-load` on it is
 * the only readiness it needs.
 */
export function miniViewErrorSurfaceHtml(): string {
	return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Quick send</title>
<style>
	:root { color-scheme: dark; }
	html, body { margin: 0; height: 100%; background: ${MINI_VIEW_GROUND}; }
	body { display: flex; align-items: center; padding: 0 16px;
		font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		color: #c2bcb0; }
	p { margin: 0; }
	strong { font-weight: 600; color: #ef8078; }
</style></head>
<body><p><strong>Quick send could not open.</strong> Try the hotkey again, or restart Local Operator if it keeps failing.</p></body></html>`;
}

export interface MiniViewOptions {
	/** The mini document's URL (`miniViewUrlFor`'s answer). */
	url: string;
	/** The app's preload script; the mini document uses the same one. */
	preloadPath: string;
	/** The LAUNCH PLAN's show policy — the final gate on presentation. */
	show: WindowShow;
	/**
	 * The launch's chrome mode, for the synchronous argv facts the preload reads.
	 *
	 * The mini document needs them for one visible thing: the header's keycap
	 * spells the chord per platform (`⌘⌥⇧Space` against `Ctrl+Alt+Shift+Space`), and
	 * that spelling comes from `windowChrome.facts().platform`. Without the
	 * argument the preload falls back to its `linux` default and every platform
	 * reads `Ctrl+Alt+Shift+Space` — which is what the first evidence run of the
	 * `mini-view` scene showed (design §I.3).
	 */
	chromeMode: WindowChromeMode;
	/** The `[window-raise]` line's sink. */
	report?: RaiseReport;
}

export function createMiniView(options: MiniViewOptions): MiniView {
	const window = new BrowserWindow({
		width: MINI_VIEW_WIDTH,
		height: MINI_VIEW_HEIGHT,
		/*
		 * Sized in content, not window, terms, and the content size is now the
		 * BASE of a measured range rather than the whole story: the restyle's
		 * chrome (previews, the readings strip, the picker sheet) asks for more
		 * through `MINI_VIEW_RESIZE` below, and this call is what makes the
		 * page's viewport the number every frame is captured at.
		 */
		useContentSize: true,
		show: false,
		/* The dark ground under an as-yet-unpainted document; see MINI_VIEW_GROUND. */
		backgroundColor: MINI_VIEW_GROUND,
		// A composer that floats over other apps carries no frame of its own:
		// the app's own rows are the entire surface, and the one sanctioned
		// elevation step is the card's ground.
		frame: false,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		/*
		 * Windows/Linux: a utility surface must not take a taskbar slot. macOS
		 * has no equivalent and ignores the flag.
		 */
		skipTaskbar: process.platform !== "darwin",
		/*
		 * macOS: a panel may float over a full-screen app's Space, which is the
		 * design's risk-K2 mitigation; on the other platforms the option does
		 * not exist and is omitted rather than passed as a no-op.
		 */
		...(process.platform === "darwin" ? { type: "panel" as const } : {}),
		title: "Quick send",
		webPreferences: {
			preload: options.preloadPath,
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
			// The window may be hidden for hours between summons, and a page
			// Chromium believes nobody is looking at is throttled; the mini
			// view's own boot and any live preview must keep real time.
			backgroundThrottling: false,
			/*
			 * The argv the preload reads SYNCHRONOUSLY, and both entries are
			 * deliberate: the chrome facts because the keycap's spelling (⌘⌥⇧
			 * against Ctrl+Alt+Shift) is a first-frame fact with no IPC round trip to
			 * wait for — the main window composes the same entry through
			 * `windowChromeArgumentFor` — and an EXPLICIT telemetry `off` because
			 * this window mounts no telemetry surface at all (§D.1), and the
			 * renderer's contract is that silence is never read as "on".
			 */
			additionalArguments: [
				windowChromeArgumentFor(process.platform, options.chromeMode),
				telemetryArgument(false),
			],
		},
	});

	if (process.platform === "darwin") {
		/*
		 * Summonable from any Space, including over another app's full-screen
		 * window (§C.2). Set once at creation rather than at each summon: the
		 * policy is a property of the window, and re-applying it inside a show
		 * path would be the presentation logic this module keeps out.
		 */
		window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	/*
	 * THE READINESS LATCH (see `MINI_VIEW_PAINTED`). `painted` is per LOAD, not
	 * per window: a reload (the evidence scene does one, and a future update
	 * would) must not inherit the previous document's readiness.
	 */
	let paintedForLoad = false;
	let paintTimer: NodeJS.Timeout | null = null;
	let paintWaiters: Array<() => void> = [];

	const settlePaint = (ready: boolean): void => {
		if (paintTimer !== null) {
			clearTimeout(paintTimer);
			paintTimer = null;
		}
		paintedForLoad = ready;
		const waiting = paintWaiters;
		paintWaiters = [];
		for (const resolve of waiting) resolve();
	};

	/** The card that stands in when no document can: dark, static, unscriptable. */
	const showErrorSurface = (): void => {
		if (disposed || window.isDestroyed()) return;
		settlePaint(false);
		void window.loadURL(
			`data:text/html;charset=utf-8,${encodeURIComponent(miniViewErrorSurfaceHtml())}`,
		);
		/*
		 * PRESENTED ON ITS OWN LOAD, and only if the plan allows presentation at all
		 * (`presentMiniView` is the one sanctioned raise). The card is main's own
		 * string, so there is no bundle left to fail - which is the entire point of
		 * holding it here rather than shipping it.
		 */
		window.webContents.once("did-finish-load", () => {
			if (disposed || window.isDestroyed()) return;
			positionForCursorDisplay();
			presentMiniView(window, options.show, {
				trigger: "mini-view",
				report: options.report,
			});
			if (options.show === "focus") {
				window.webContents.send(MINI_VIEW_SUMMONED, {
					at: Date.now(),
				} satisfies MiniViewSummonedPayload);
			}
		});
	};

	window.webContents.on("did-start-loading", () => {
		paintedForLoad = false;
	});
	/*
	 * A LOAD THAT FAILED IS A WINDOW WITH NOTHING IN IT. `did-fail-load` covers the
	 * ordinary cases (a missing file, a refused scheme); `render-process-gone`
	 * covers the renderer that died before or after it painted - the shipped
	 * white-card report was a mangled load through a stale main process, which may
	 * or may not raise `did-fail-load` at all, so the paint timeout below is the
	 * backstop that does not depend on either signal firing.
	 */
	window.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
			if (!isMainFrame) return;
			options.report?.(
				`[mini-view] load failed (${errorCode} ${errorDescription}) for ${validatedURL}; showing the error card`,
			);
			showErrorSurface();
		},
	);
	window.webContents.on("render-process-gone", (_event, details) => {
		options.report?.(
			`[mini-view] renderer gone (${details.reason}); showing the error card`,
		);
		showErrorSurface();
	});

	void window.loadURL(options.url);

	/*
	 * THE MEASURED RESIZE (design R2's mechanism). The frame is the only thing
	 * that can measure its own content, so it sends what it needs and this
	 * handler is the only thing that may grant it: the height is clamped to
	 * [base, `MINI_VIEW_MAX_HEIGHT`] and to the display's work area (minus a
	 * margin), the WIDTH never moves, and the TOP EDGE is held so growth goes
	 * downward from where the summon put the window. If a growth would cross
	 * the work area's bottom the window is lifted just enough to fit.
	 *
	 * Fire-and-forget (`ipcMain.on`): the renderer re-measures on every layout
	 * settle and there is no answer to await; the clamp is this side's, and a
	 * request that changes nothing is a no-op rather than a round trip.
	 */
	const onResize = (event: IpcMainEvent, payload: unknown): void => {
		if (
			window.isDestroyed() ||
			event.sender !== window.webContents ||
			event.senderFrame !== window.webContents.mainFrame
		) {
			return;
		}
		if (!isMiniViewResizePayload(payload)) return;
		const area = screen.getDisplayMatching(window.getBounds()).workArea;
		/* The margin keeps a fully grown frame off the work area's edges. */
		const ceiling = Math.max(
			MINI_VIEW_HEIGHT,
			Math.min(MINI_VIEW_MAX_HEIGHT, area.height - 64),
		);
		const height = Math.max(
			MINI_VIEW_HEIGHT,
			Math.min(Math.round(payload.height), ceiling),
		);
		const bounds = window.getContentBounds();
		if (bounds.height === height) return;
		window.setContentSize(MINI_VIEW_WIDTH, height);
		const bottom = bounds.y + height;
		if (bottom > area.y + area.height) {
			window.setPosition(
				bounds.x,
				Math.max(area.y, area.y + area.height - height),
			);
		}
	};
	/*
	 * NO `removeListener` BEFORE THE `on`: `onResize` is a fresh closure per creation,
	 * so its identity never matched a predecessor's (reviewer N2 - the line could
	 * not do what it read as doing). `dispose()` below is what actually removes it,
	 * and it is reached by every path that tears a mini view down.
	 */
	ipcMain.on(MINI_VIEW_RESIZE, onResize);

	/*
	 * THE FIRST-COMMIT SIGNAL, from the frame's own mount (see MINI_VIEW_PAINTED).
	 * Sender-guarded like every other channel here: only the mini document's own
	 * main frame may declare it painted.
	 */
	const onPainted = (event: IpcMainEvent): void => {
		if (
			window.isDestroyed() ||
			event.sender !== window.webContents ||
			event.senderFrame !== window.webContents.mainFrame
		)
			return;
		settlePaint(true);
	};
	ipcMain.on(MINI_VIEW_PAINTED, onPainted);

	let disposed = false;

	function hide(): void {
		if (disposed || window.isDestroyed()) return;
		window.hide();
		/*
		 * THE FOCUS-RETURN CONTRACT (§C.3), macOS only. If anything else of
		 * this app is still on screen, hiding the mini view leaves ordering to
		 * the OS. With no window left visible, `app.hide()` is what returns
		 * focus to the app the operator was in before the summon — the "get out
		 * of the way" half. Windows/Linux cannot restore the previous
		 * foreground window through Electron, which the design documents as a
		 * known limitation rather than faking it.
		 */
		if (process.platform === "darwin") {
			const anyOtherVisible = BrowserWindow.getAllWindows().some(
				(candidate) =>
					candidate !== window &&
					!candidate.isDestroyed() &&
					candidate.isVisible(),
			);
			if (!anyOtherVisible) app.hide();
		}
	}

	/*
	 * Close means hide while the view is live — see the module docstring for
	 * the silently-dead-hotkey failure this prevents. During the quit descent
	 * `disposed` is set first, so the app's own close is not intercepted.
	 */
	window.on("close", (event) => {
		if (disposed) return;
		event.preventDefault();
		hide();
	});

	function authorize(event: IpcMainInvokeEvent): void {
		if (
			window.isDestroyed() ||
			event.sender !== window.webContents ||
			event.senderFrame !== window.webContents.mainFrame
		) {
			throw new Error("This window cannot dismiss the mini view.");
		}
	}

	/*
	 * Idempotent registration: `ipcMain.handle` throws for a channel that
	 * already has one, and a second mini view (a future caller, a hot reload)
	 * must replace the handler rather than fail on it.
	 */
	ipcMain.removeHandler(MINI_VIEW_DISMISS);
	ipcMain.handle(MINI_VIEW_DISMISS, (event, reason: unknown) => {
		authorize(event);
		if (!isMiniViewDismissReason(reason)) {
			throw new Error("Unknown dismissal.");
		}
		hide();
	});

	/**
	 * Present the window - once its document has painted, or with the card.
	 *
	 * THE HANDSHAKE (the shipped white-card fix). `presentMiniView` is called only
	 * when the renderer has signalled its first commit, so a summon can never show
	 * an unpainted window; a document that never signals is answered by the timeout,
	 * which swaps in the error card. A plan that may not present takes the
	 * `present` arm immediately: nothing is shown, so there is nothing to wait for.
	 */
	function presentWhenReady(): void {
		if (disposed || window.isDestroyed()) return;
		const decision = miniViewPresentationFor({
			show: options.show,
			painted: paintedForLoad,
			timedOut: false,
		});
		if (decision === "error-surface") {
			showErrorSurface();
			return;
		}
		if (decision === "present") {
			presentNow();
			return;
		}
		/* `wait`: the signal, or the timeout that stands the error card in. */
		paintWaiters.push(() => {
			if (
				miniViewPresentationFor({
					show: options.show,
					painted: paintedForLoad,
					timedOut: false,
				}) === "present"
			)
				presentNow();
		});
		if (paintTimer === null) {
			paintTimer = setTimeout(() => {
				paintTimer = null;
				if (
					miniViewPresentationFor({
						show: options.show,
						painted: paintedForLoad,
						timedOut: true,
					}) === "error-surface"
				)
					showErrorSurface();
			}, MINI_VIEW_PAINT_TIMEOUT_MS);
		}
	}

	/** The one presentation path: the plan's gate, then the renderer's half. */
	function presentNow(): void {
		if (disposed || window.isDestroyed()) return;
		positionForCursorDisplay();
		presentMiniView(window, options.show, {
			trigger: "mini-view",
			report: options.report,
		});
		/*
		 * The renderer's half of the summon: focus the composer, reset the "Sent"
		 * flash, settle a draft the previous hide preserved. Sent only when the plan
		 * actually allows presentation, so it can never arrive for a window nothing
		 * was allowed to raise.
		 */
		if (options.show === "focus") {
			window.webContents.send(MINI_VIEW_SUMMONED, {
				at: Date.now(),
			} satisfies MiniViewSummonedPayload);
		}
	}

	function toggle(): void {
		if (disposed) return;
		if (!window.isDestroyed() && window.isVisible()) {
			// Second press: the cheapest way out (design §C.1).
			hide();
			return;
		}
		presentWhenReady();
	}

	/**
	 * Place the window on the display under the cursor, at show time.
	 *
	 * Resolved per summon rather than once, because the display under the
	 * cursor is the one the operator is looking at (§C.2). Horizontally
	 * centred; vertically centred on the work area's top third — the launcher
	 * convention, chosen in the design because it is trivially reproducible in
	 * a still. `workArea` (not `bounds`) so the menu bar and Dock are
	 * respected, and the DIP values go straight to `setPosition` — Electron
	 * converts per display.
	 */
	function positionForCursorDisplay(): void {
		if (window.isDestroyed()) return;
		const display = screen.getDisplayNearestPoint(
			screen.getCursorScreenPoint(),
		);
		const area = display.workArea;
		/*
		 * The window's CURRENT content height, not the base: a frame grown for a
		 * preview or a sheet keeps its height across hides (the renderer
		 * reconciles it on the next summon), and centring it on the base would
		 * float it a sheet's worth too high on the display.
		 */
		const height = window.isDestroyed()
			? MINI_VIEW_HEIGHT
			: window.getContentBounds().height;
		const x = Math.round(area.x + (area.width - MINI_VIEW_WIDTH) / 2);
		const desiredY = area.y + area.height / 3 - height / 2;
		const y = Math.round(
			Math.min(Math.max(desiredY, area.y), area.y + area.height - height),
		);
		window.setPosition(x, y);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		ipcMain.removeListener(MINI_VIEW_RESIZE, onResize);
		ipcMain.removeListener(MINI_VIEW_PAINTED, onPainted);
		ipcMain.removeHandler(MINI_VIEW_DISMISS);
		if (paintTimer !== null) {
			clearTimeout(paintTimer);
			paintTimer = null;
		}
		if (!window.isDestroyed()) window.destroy();
	}

	return { window, toggle, hide, dispose };
}
