/**
 * Evidence harness: the Console pane's OPEN, in a browser, one moment per page load.
 *
 * WHY A HARNESS AND NOT THE APP. The claim the frames have to settle is what the
 * operator SEES between pressing the console trigger and having a terminal — and the
 * design round's finding (D1) was that the committed set had no frame in that window at
 * all: the one frame that followed the press was already settled. A second Electron boot
 * on this host was refused by the round's own host rule (load ~100, ~1-4 GB free, one
 * launch at a time), and the app is not what decides this: the pane's state machine is,
 * and it is the shipped component that is mounted here.
 *
 * WHAT IS REAL AND WHAT IS NOT, because these frames are worthless if a reader cannot
 * tell. Real: the shipped `ConsolePane`, the shipped `useConsoleSession`, the shipped
 * `ConsoleMirror` painting through a real xterm DOM renderer, the shipped store, the
 * shipped themes, and the pane's real geometry at a pinned box. Not real: `window.api`
 * is a scripted bridge, so there is no pty and the prompt in the `created` frame is bytes
 * REPLAYED through the bridge's subscribe path rather than a shell's own output. The
 * frames are evidence about the pane's STATES and their order — the half a review could
 * not see — and they are not evidence that a program runs; that is QA's live cell.
 *
 * ONE MOMENT PER PAGE LOAD, driven by `?step=`, rather than a script that clicks. The
 * capture path in this repository is the browser tool and a README runbook (the
 * draft-splash rig's own raw-CDP capture is retired), and a URL is the one control a
 * browser tool can be relied on to deliver: each frame is a fresh page in the same state,
 * so a frame cannot be a leftover of the previous step. `?step=` also means the moment is
 * pinned by construction rather than by how fast the shutter was.
 *
 *   ?step=waiting   the user has pressed, the create is in flight and answers NEVER
 *   ?step=created   the create answered and the surface is in the listing
 *   ?step=failed    the create was refused (the state design round 1, U2 is about)
 *
 * See docs/evidence/console-pane-fit/README.md for the exact commands and for what each
 * frame does and does not prove.
 */

import { ConsolePane } from "@features/console/components/console-pane";
import {
	DEFAULT_CONSOLE_PANEL_WIDTH,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
/*
 * THE APP'S OWN FACE, exactly the way `console-capture.tsx` loads it. The app's stylesheet
 * comes in through the harness's own CSS file, because that is where Tailwind's `@source`
 * has to sit (see `console-open-evidence.css`); the fonts are imported here, where the
 * renderer entry imports them too, so the face is in place before the sheet that measures
 * it applies.
 */
import "@assets/fonts/fonts.css";
import "./console-open-evidence.css";

/** The conversation the pane is scoped to; nothing else in this page depends on it. */
const SESSION = "session-frame-test";

const step =
	new URLSearchParams(window.location.search).get("step") ?? "waiting";

/** One surface, in the shape main publishes (§10.2). */
const surfaceRow = () => ({
	surface: "con:1:1",
	session_id: SESSION,
	origin: "user",
	command: "zsh",
	argv_tail: "",
	cwd: "/Users/damian",
	cols: 100,
	rows: 30,
	running: true,
	exit_code: null,
	last_activity: 1,
	live: true,
	agent_owned: false,
	secure: false,
	retain: true,
	displayed: true,
});

/**
 * A prompt, as the bytes the mirror replays.
 *
 * UTF-8-safe base64 for the same reason the pane's stories carry the helper: `btoa`
 * throws outside Latin-1, and a prompt is ASCII here but the next person to edit this
 * may try a box-drawing character.
 */
const bytes = (text: string): string => {
	const encoded = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of encoded) binary += String.fromCharCode(byte);
	return btoa(binary);
};
const PROMPT = bytes("\u001b[38;5;114mdamian@mac\u001b[0m ~ % ");

const listing = { available: true, reason: null, detail: null };

const installBridge = () => {
	let surfaces: unknown[] = [];
	window.api = {
		console: {
			state: async () => ({ ...listing, surfaces }),
			createSurface: async () => {
				if (step === "waiting") return new Promise(() => {});
				if (step === "failed")
					throw new Error(
						"Error invoking remote method 'console-create-surface': Error: console_unavailable: the pty could not be started (spawn_failed)",
					);
				surfaces = [surfaceRow()];
				return { surface: "con:1:1" };
			},
			subscribe: async () => ({ replay_base64: PROMPT, from_byte: 0 }),
			unsubscribe: async () => {},
			input: async () => {},
			keys: async () => {},
			onOutput: () => () => {},
			onExit: () => () => {},
			onReveal: () => () => {},
			onStateChanged: () => () => {},
			setContentRect: async (
				_surface: string,
				report: { contentRect: { height: number }; cellHeight: number },
			) => {
				/*
				 * §8.2 STEP 3, RESTATED BECAUSE THIS PAGE HAS NO MAIN PROCESS. The pane reports
				 * its box and main derives the grid — `rows = floor(contentRect.height /
				 * cellHeight)` (`src/main/console/host.ts`) — and a harness that answers with the
				 * surface's birth grid instead would photograph a pane main has not resized yet:
				 * a terminal thirty rows tall inside a forty-six row box, with the rest of the
				 * pane empty. That is not the state this frame is about, so the stub answers the
				 * line main answers, from the cell the pane measured.
				 */
				if (surfaces.length > 0) {
					const rows = Math.max(
						10,
						Math.floor(report.contentRect.height / report.cellHeight),
					);
					surfaces = [{ ...surfaceRow(), rows }];
				}
				return { ...listing, surfaces };
			},
			openPane: async () => {},
			closePane: async () => {},
		},
	} as unknown as typeof window.api;
};

/*
 * The pane's box, so a frame here can be read against the frames taken from the
 * application. The WIDTH is the store's own default — imported rather than typed, the way
 * the pane's stories fixed it after their own finding — and the HEIGHT is the box the app
 * measured for the pane at 1380x900 (`docs/evidence/console-pane-fit/after-geometry.json`,
 * `hostHeight` 791), so the fit in a frame here is the fit in a frame there.
 */
const BOX_HEIGHT = 791;

/*
 * The build stamp a reader needs to know which tree produced the frame, and which box it
 * was given: printed into the off-canvas readback rather than painted over the product
 * surface. Written AFTER the first paint, from the box that actually laid out — a number
 * typed here would be a claim, and the point of a readback is that it is a reading.
 */
const probe = document.createElement("pre");
probe.id = "probe";
document.body.append(probe);

installBridge();
createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<div
			id="pane-box"
			className="flex h-full flex-col overflow-hidden"
			style={{ width: DEFAULT_CONSOLE_PANEL_WIDTH, height: BOX_HEIGHT }}
		>
			<ConsolePane sessionId={SESSION} onClose={() => undefined} />
		</div>
	</StrictMode>,
);

/*
 * The readback is written LATE AS WELL AS EARLY, and that is a correction the first
 * capture needed: a single `requestAnimationFrame` fired before the pane's box had laid
 * out (and, on a backgrounded tab, before the viewport had a size), so the frame was right
 * and the numbers beside it said "not laid out". A reading that is wrong exactly when a
 * reader leans on it is worse than no reading, so it is re-taken on a timer and on resize.
 */
const writeProbe = () => {
	const box = document.getElementById("pane-box")?.getBoundingClientRect();
	probe.textContent = [
		`step=${step}`,
		`pane box=${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "not laid out"}`,
		`viewport=${window.innerWidth}x${window.innerHeight}`,
		`dpr=${window.devicePixelRatio}`,
		// The caret is not a pixel a reader can check at frame scale, so it is read: where
		// the keyboard actually is, which is the half of the open this frame is about.
		`activeElement=${document.activeElement?.className || document.activeElement?.tagName}`,
		`hasFocus=${document.hasFocus()} helperPresent=${Boolean(document.querySelector("textarea.xterm-helper-textarea"))} helperFocused=${document.activeElement === document.querySelector("textarea.xterm-helper-textarea")}`,
	].join("\n");
};
requestAnimationFrame(writeProbe);
for (const delay of [400, 1200, 2500]) setTimeout(writeProbe, delay);
window.addEventListener("resize", writeProbe);

/*
 * THE USER'S PRESS, raised exactly where the header raises it (`chat-content.tsx`): the
 * store's request, which is the one thing that makes an open an OPEN rather than a
 * mount. It is deferred a frame so the pane is mounted and has read the listing first,
 * which is the order the app is in when a person presses the trigger.
 */
requestAnimationFrame(() =>
	useUiPreferencesStore.getState().requestConsoleOpen(SESSION),
);
