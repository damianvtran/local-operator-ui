import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `sidebar-docking`: the user's open/closed preference, driven through the
 * built app's real keyboard and pointer controls at wide, 1023 and 800px.
 *
 * The base tree runs these SAME bytes as the negative control: its first narrow
 * reading is the forced strip and its first Cmd/Ctrl+B is the overlay sheet, so
 * the expectation fails before the head-only matrix continues. The head tree
 * must instead dock, collapse to the strip on a real chord/pointer press, and
 * preserve the stored 320px preference while only its drawn width is capped.
 *
 * Populated content is required. The scene refuses an offline/empty boot rather
 * than photographing a spinner and calling it docking evidence. Viewport changes
 * use Chromium's device-metrics pipeline (the existing driver cannot resize the
 * native hidden BrowserWindow); the recorded CSS viewport is therefore the size
 * being asserted, never the native window's launch bounds. Process-restart and
 * native-window resize coverage remain independent QA's matrix, not a claim here.
 */

const PREFERENCE_KEY = "ui-preferences-storage";
const SIDEBAR = "[data-sidebar-shell], [data-sidebar-strip]";
const CHAT = '[data-tour-tag="chat-column"]';
const RAIL = "[data-panel-rail]";
const SHEET = "[data-sidebar-sheet]";
const SYNTHETIC_QUESTION = "Synthetic sidebar docking question";
const SYNTHETIC_ANSWER = "from the mock provider";
const CONSOLE_ERROR = /error|failed|uncaught|exception/i;

const rect = (element) => {
	if (!element) return null;
	const box = element.getBoundingClientRect();
	return {
		x: Math.round(box.x),
		y: Math.round(box.y),
		width: Math.round(box.width),
		height: Math.round(box.height),
		right: Math.round(box.right),
		bottom: Math.round(box.bottom),
	};
};

/** Read the boxes and preference, without writing either. */
const GEOMETRY = `(() => {
	const rect = ${rect.toString()};
	let preferences = null;
	try {
		preferences = JSON.parse(localStorage.getItem(${JSON.stringify(PREFERENCE_KEY)}))?.state ?? null;
	} catch {
		preferences = null;
	}
	const sidebar = rect(document.querySelector(${JSON.stringify(SIDEBAR)}));
	const sheetCount = document.querySelectorAll(${JSON.stringify(SHEET)}).length;
	const transcript = document.querySelector('[data-lo-transcript-content]');
	return {
		viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
		document: {
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
			bodyScrollWidth: document.body?.scrollWidth ?? null,
		},
		mode: sheetCount > 0 ? 'overlay' : sidebar?.width === 56 ? 'strip' : 'docked',
		sidebar,
		chat: rect(document.querySelector(${JSON.stringify(CHAT)})),
		rail: rect(document.querySelector(${JSON.stringify(RAIL)})),
		row: rect(document.querySelector('[data-tour-tag="pane-row"]')),
		preference: preferences ? {
			collapsed: preferences.isSidebarCollapsed,
			width: preferences.chatSidebarWidth,
		} : null,
		sheetCount,
		openDialogCount: document.querySelectorAll('[role="dialog"][data-state="open"]').length,
		sessionRows: document.querySelectorAll('[data-session-row]').length,
		populated: {
			question: Boolean(transcript?.textContent?.includes(${JSON.stringify(SYNTHETIC_QUESTION)})),
			answer: Boolean(transcript?.textContent?.includes(${JSON.stringify(SYNTHETIC_ANSWER)})),
			characters: transcript?.textContent?.trim().length ?? 0,
		},
	};
})()`;

export async function sceneSidebarDocking({
	cdp,
	verb,
	capture,
	check,
	note,
	wait,
	waitForCondition,
	factsOf,
	require,
	clickAt,
	pressChord,
	sidebarModifier,
	session,
}) {
	const frames = [];
	const geometry = [];
	const hello = await verb(cdp, "hello");
	const height = hello.viewport.height;
	const deviceScaleFactor = hello.viewport.devicePixelRatio;
	const facts = await factsOf(cdp);
	check(
		"the docking scene runs in a hidden, unfocused native window",
		facts.windowMode === "headless" &&
			facts.visible === false &&
			facts.focused === false,
		JSON.stringify(facts),
	);

	const resize = async (width) => {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor,
			mobile: false,
		});
		await wait(350);
		const actual = await cdp.evaluate(
			"({ width: innerWidth, height: innerHeight, devicePixelRatio })",
		);
		check(
			`the CSS viewport reached ${width}px`,
			actual.width === width,
			JSON.stringify(actual),
		);
	};

	const read = async (label) => {
		const reading = await cdp.evaluate(GEOMETRY);
		geometry.push({ label, ...reading });
		note(`${label} geometry`, JSON.stringify(reading));
		return reading;
	};

	const frame = async (label) => {
		const shot = await capture(cdp, label);
		frames.push(shot);
		note("frame", JSON.stringify({ label, ...shot }));
		check(
			`${label} is a settled, toast-free frame`,
			shot.stable === true && shot.toastFree === true,
			JSON.stringify(shot),
		);
		return shot;
	};

	const expectLayout = async (
		label,
		{ mode, width, collapsed, captureFrame = true },
	) => {
		/* The stability wait can finish an animated width transition. Measure after it
		 * so the assertions and JSON describe the same settled layout as the PNG. */
		if (captureFrame) await frame(label);
		const reading = await read(label);
		check(
			`${label}: ${mode} is drawn from collapsed=${collapsed}`,
			reading.mode === mode &&
				reading.sidebar?.width === width &&
				reading.preference?.collapsed === collapsed,
			`mode=${reading.mode} width=${reading.sidebar?.width} preference=${JSON.stringify(reading.preference)}`,
		);
		check(
			`${label}: no sidebar overlay sheet or dialog opened`,
			reading.sheetCount === 0 && reading.openDialogCount === 0,
			`sheet=${reading.sheetCount} dialogs=${reading.openDialogCount}`,
		);
		check(
			`${label}: the stored 320px width was not rewritten`,
			reading.preference?.width === 320,
			JSON.stringify(reading.preference),
		);
		check(
			`${label}: no horizontal document overflow`,
			reading.document.scrollWidth <= reading.viewport.width &&
				reading.document.bodyScrollWidth <= reading.viewport.width,
			`scroll=${reading.document.scrollWidth}/${reading.document.bodyScrollWidth} viewport=${reading.viewport.width}`,
		);
		check(
			`${label}: populated conversation remains mounted; a drawn list has rows`,
			reading.populated.question &&
				reading.populated.answer &&
				(reading.mode === "strip" || reading.sessionRows > 0),
			JSON.stringify({
				sessionRows: reading.sessionRows,
				populated: reading.populated,
			}),
		);
		return reading;
	};

	const chord = () =>
		pressChord(cdp, {
			key: "b",
			code: "KeyB",
			virtualKeyCode: 66,
			modifiers: sidebarModifier,
		});

	const diagnostics = async () => {
		const consoleErrors = cdp.console.filter((line) =>
			CONSOLE_ERROR.test(line),
		);
		const networkFailures = cdp.failed.map((failure) => ({ ...failure }));
		const requests = [...new Set(cdp.requests.map((request) => request.url))];
		writeFileSync(
			join(hello.outDir, "sidebar-docking-evidence.json"),
			`${JSON.stringify({ geometry, frames, console: cdp.console, consoleErrors, networkFailures, requests }, null, 2)}\n`,
		);
		note(
			"renderer diagnostics",
			JSON.stringify({
				consoleEntries: cdp.console.length,
				consoleErrors,
				networkFailures,
				requestCount: requests.length,
			}),
		);
		check(
			"no renderer console errors during docking",
			consoleErrors.length === 0,
			JSON.stringify(consoleErrors),
		);
		check(
			"no failed network requests during docking",
			networkFailures.length === 0,
			JSON.stringify(networkFailures),
		);
	};

	try {
		await verb(cdp, "navigate", "/chat");
		await verb(cdp, "setTheme", "localOperatorDark");
		await verb(cdp, "setSidebarWidth", { width: 320 });
		const catalogue = await waitForCondition(
			cdp,
			`Boolean(document.querySelector('[data-session-row=${JSON.stringify(session)}] [data-chat-row]'))`,
			20_000,
		);
		require("the isolated fixture populates the sidebar", catalogue.ok, JSON.stringify(
			catalogue,
		));
		const opened = await verb(cdp, "navigate", `/chat/${session}`);
		note("synthetic session navigation", JSON.stringify(opened));
		const populated = await waitForCondition(
			cdp,
			`(() => {
				const text = document.querySelector('[data-lo-transcript-content]')?.textContent ?? '';
				return text.includes(${JSON.stringify(SYNTHETIC_QUESTION)}) && text.includes(${JSON.stringify(SYNTHETIC_ANSWER)});
			})()`,
			30_000,
		);
		if (!populated.ok) {
			note(
				"transcript preflight failure details",
				JSON.stringify(
					await cdp.evaluate(`(() => ({
						route: location.hash,
						transcript: document.querySelector('[data-lo-transcript-content]')?.textContent ?? null,
						log: document.querySelector('[role="log"]')?.textContent ?? null,
						body: document.body.innerText.slice(0, 5000),
					}))()`),
				),
			);
			await capture(cdp, "sidebar-docking-preflight-failure-dark");
		}
		require("the isolated fixture populates the real transcript", populated.ok, JSON.stringify(
			populated,
		));

		await expectLayout("sidebar-docking-1380-expanded-dark", {
			mode: "docked",
			width: 320,
			collapsed: false,
		});

		await resize(1023);
		await expectLayout("sidebar-docking-1023-expanded-dark", {
			mode: "docked",
			width: 320,
			collapsed: false,
		});

		/* Real keyboard: expanded -> collapsed preference, never a narrow sheet. */
		await chord();
		await wait(250);
		const keyboardCollapsed = await expectLayout(
			"sidebar-docking-1023-keyboard-collapsed-dark",
			{ mode: "strip", width: 56, collapsed: true },
		);
		if (
			keyboardCollapsed.mode === "overlay" ||
			keyboardCollapsed.preference?.collapsed !== true
		) {
			note(
				"base negative control reproduced",
				"the narrow chord opened the legacy overlay instead of writing the collapsed preference; head-only checks are not applicable to this tree",
			);
			return frames;
		}

		/* Real keyboard back to the dock, then the two real pointer controls. */
		await chord();
		await wait(250);
		await expectLayout("sidebar-docking-1023-keyboard-expanded-dark", {
			mode: "docked",
			width: 320,
			collapsed: false,
		});
		await clickAt(cdp, '[aria-label="Collapse sidebar"]');
		await wait(250);
		await expectLayout("sidebar-docking-1023-pointer-collapsed-dark", {
			mode: "strip",
			width: 56,
			collapsed: true,
		});

		/* The collapsed preference follows the resize; the pointer docks at 800. */
		await resize(800);
		await expectLayout("sidebar-docking-800-collapsed-dark", {
			mode: "strip",
			width: 56,
			collapsed: true,
		});
		await clickAt(cdp, '[aria-label="Expand sidebar"]');
		await wait(250);
		const narrow = await expectLayout("sidebar-docking-800-expanded-dark", {
			mode: "docked",
			width: 276,
			collapsed: false,
		});
		check(
			"800px dock + chat floor + rail tile the viewport exactly",
			narrow.sidebar?.width === 276 &&
				narrow.chat?.width === 480 &&
				narrow.rail?.width === 44 &&
				narrow.chat.x + narrow.chat.width <= narrow.viewport.width,
			JSON.stringify({
				sidebar: narrow.sidebar,
				chat: narrow.chat,
				rail: narrow.rail,
				viewport: narrow.viewport,
			}),
		);

		await verb(cdp, "setTheme", "localOperatorLight");
		await expectLayout("sidebar-docking-800-expanded-light", {
			mode: "docked",
			width: 276,
			collapsed: false,
		});
		await verb(cdp, "setTheme", "localOperatorDark");

		/* Widening restores the stored width, proving the 276px cap was render-only. */
		await resize(1380);
		await expectLayout("sidebar-docking-1380-restored-dark", {
			mode: "docked",
			width: 320,
			collapsed: false,
		});

		/*
		 * The independent canvas fit-yield still wins at 1023, where the strip lets
		 * the canvas dock but a 320px sidebar does not. It must not rewrite the
		 * preference, and closing the canvas must restore the user's dock.
		 */
		await resize(1023);
		const documentPath = join(hello.outDir, "sidebar-canvas-yield.md");
		writeFileSync(
			documentPath,
			"# Synthetic canvas yield\n\nOwned fixture content; no operator file is read.\n",
		);
		await verb(cdp, "openCanvasDocument", { path: documentPath });
		const canvas = await waitForCondition(
			cdp,
			"document.querySelector('[data-tour-tag=\"canvas-dock\"]')?.getAttribute('data-canvas-mode') === 'docked'",
			15_000,
		);
		require("the canvas reached the docked mode that requires the sidebar yield", canvas.ok, JSON.stringify(
			canvas,
		));
		await expectLayout("sidebar-docking-1023-canvas-yield-dark", {
			mode: "strip",
			width: 56,
			collapsed: false,
		});
		await clickAt(cdp, '[data-panel-rail-item="canvas"]');
		const closed = await waitForCondition(
			cdp,
			"document.querySelector('[data-tour-tag=\"canvas-dock\"]') === null",
			15_000,
		);
		require("the canvas closed through its real rail control", closed.ok, JSON.stringify(
			closed,
		));
		await expectLayout("sidebar-docking-1023-canvas-restored-dark", {
			mode: "docked",
			width: 320,
			collapsed: false,
		});
		return frames;
	} finally {
		await diagnostics();
	}
}
