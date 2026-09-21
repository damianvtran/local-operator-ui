import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	TERMINAL_FONT_SIZE,
	measureCell,
	readTerminalTheme,
	terminalFontFamily,
} from "@shared/themes/terminal-theme";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { type FC, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The pane's terminal: a MIRROR of a surface main owns.
 *
 * Design: `docs/design/ui-console-tab.md` 6.1 (the pane), 8.1/8.2 (the grid is
 * main's and a view never sets it), 8.5 (what a pane does when the grid and the box
 * disagree), 10.3 (the subscription: replay, then stream), 12.2 (the blip's
 * clearing rule), 13.3 (the capture view pins the DOM renderer).
 *
 * IT MIRRORS AND NEVER AUTHORITATES. The pty, the byte log and the terminal of
 * record all live in main (§3(a), §7.1); this component paints what it is sent and
 * reports two facts about itself — where its content box is, and how wide one of
 * its cells is. It never calls `addon-fit`, and it never decides `cols`/`rows`:
 * main computes the grid from this component's own report and hands the answer
 * back (§8.2), and `cols`/`rows` below are that answer, applied verbatim. That is
 * the whole of why a hidden surface cannot oscillate (§8.3): this component is not
 * mounted when nothing is displayed, so nothing reports a rect, so nothing
 * recomputes.
 *
 * REPLAY THEN STREAM IS ONE CALL, NOT A READ THAT RACES A SUBSCRIBE (§10.3): the
 * listener is installed BEFORE `subscribe` resolves, and frames that arrive while
 * the response is in flight are buffered and written after the replay. The other
 * order — subscribe, then read — is how a terminal loses the bytes the process
 * printed in the gap, which on a slow reply is a visible hole in the middle of a
 * build log.
 *
 * WEBGL IS NOT LOADED, DELIBERATELY, IN EITHER MODE. The capture view must pin the
 * DOM renderer because a WebGL canvas cannot be read back (§13.2's measured trap:
 * `toDataURL` on the xterm WebGL canvas returned a blank PNG, byte-identical with
 * `preserveDrawingBuffer` both ways). Pinning it in BOTH hosts is the smaller
 * system: one renderer means the pane and a capture of it cannot disagree about
 * where a glyph landed, and the capture path's own pin stops being a special case
 * that a later change can quietly drop. `console-mirror.test.mjs` asserts that no
 * canvas appears under `.xterm-screen`, which is what the DOM renderer's absence of
 * one proves.
 */
export interface ConsoleMirrorProps {
	/** The `con:` handle this mirror is showing. A change to it remounts (the pane
	 * keys this component on the surface), so one mirror holds one subscription. */
	surface: string;
	/** Whether the pane is actually on screen. A hidden pane reports
	 * `visible: false` and no grid is derived from it (§8.2/8.3). */
	visible: boolean;
	/** The grid main decided for this surface, applied as given (§8.2 step 3). */
	cols: number;
	rows: number;
	/** The pane's report to main (§8.2 step 1): its content box, its measured cell,
	 * whether it is displayed, and the theme it is painting. */
	onReport?: (report: {
		contentRect: { x: number; y: number; width: number; height: number };
		cellWidth: number;
		cellHeight: number;
		visible: boolean;
		theme: string;
	}) => void;
	/** Interactive (the pane) or a one-frame reconstruction (the capture view). */
	mode?: "interactive" | "capture";
	/** Called when main reports this surface's process exited, so the pane can say
	 * so without waiting for its next listing (§12.3's rung 1 is the fact). */
	onExit?: (exitCode: number) => void;
	/** Called once the terminal has written its first bytes, for the capture path,
	 * which photographs a settled frame rather than a blank one (§13.3). */
	onSettled?: (terminal: Terminal) => void;
	/**
	 * Bytes to paint instead of subscribing to a surface (the capture view).
	 *
	 * THE CAPTURE VIEW CANNOT USE THE CONSOLE BRIDGE, and that is a decision rather
	 * than a gap: main's console IPC namespace authorizes the app's OWN window's
	 * main frame, so a renderer that exists to be photographed is not an authorized
	 * sender — deliberately, because the capture view has no business reading, typing
	 * into or resizing a surface. Main feeds it the record's bytes over its own
	 * one-way channel, which is also what keeps the frame a function of exactly
	 * `(bytes, grid, theme, font, renderer)` (§13.3's determinism requirement).
	 */
	bytes?: Uint8Array;
	className?: string;
}

/** Decode the base64 a `console-output` frame or a replay carries. */
const decodeBytes = (base64: string): Uint8Array => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
};

export const ConsoleMirror: FC<ConsoleMirrorProps> = ({
	surface,
	visible,
	cols,
	rows,
	mode = "interactive",
	onExit,
	onReport,
	onSettled,
	bytes,
	className,
}) => {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [terminal, setTerminal] = useState<Terminal | null>(null);
	/** The pane's report callback, read through a ref so the observer is installed
	 * once per terminal while still calling the latest closure. */
	const reportRef = useRef<ConsoleMirrorProps["onReport"] | null>(null);
	reportRef.current = onReport ?? null;
	const exitRef = useRef(onExit);
	const settledRef = useRef(onSettled);
	exitRef.current = onExit;
	settledRef.current = onSettled;

	/*
	 * The terminal itself, created once per mount and disposed with it.
	 *
	 * Every option here is a decision rather than a default:
	 *
	 *  - `scrollback: 5000` MATCHES THE RECORD'S OWN (design 7.2), and that equality
	 *    is what makes the replay honest. The mirror replays up to the log's 4 MiB
	 *    cap, and a mirror keeping less than main's record would silently drop the
	 *    oldest lines of a reconstruction while showing the newest — a pane that
	 *    looks complete and is not.
	 *  - `theme` is resolved from the document's computed roles (not passed as
	 *    `var()`, which xterm's colour parser cannot read) and re-resolved on a
	 *    theme switch below.
	 *  - `fontFamily`/`fontSize` come from `terminal-theme.ts` so the face the pane
	 *    paints is the same one `measureCell` measured for main's grid arithmetic.
	 *  - `allowProposedApi` is what `@xterm/addon-unicode11` needs to install its
	 *    width provider. The provider is worth it and the alternative is not
	 *    neutral: xterm's built-in tables are Unicode 6, under which an emoji is one
	 *    cell wide in a modern terminal's world of two, so every emoji-bearing line
	 *    drifts by a column — which the design round's torture stream contains on
	 *    purpose.
	 *  - `cursorBlink` is on for the pane and off for a capture, where a blinking
	 *    cursor would make the frame a function of when it was taken and break the
	 *    determinism §13.3 requires of a capture.
	 */
	useLayoutEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const term = new Terminal({
			scrollback: 5000,
			theme: readTerminalTheme(),
			fontFamily: terminalFontFamily(),
			fontSize: TERMINAL_FONT_SIZE,
			allowProposedApi: true,
			cursorBlink: mode === "interactive",
			disableStdin: mode === "capture",
			convertEol: false,
			scrollOnUserInput: true,
		});
		term.loadAddon(new Unicode11Addon());
		term.unicode.activeVersion = "11";
		term.open(host);

		/*
		 * COPY, ON TWO PATHS, and both are needed (UX round 2, U5).
		 *
		 * A terminal you cannot copy out of is not finished, and the pane had no copy
		 * path at all: a drag painted `xterm-selection` boxes and ⌘C did nothing — no
		 * `copy` event fired and the clipboard stayed empty, because nothing in this
		 * feature (and no Edit-menu role) had wired one.
		 *
		 * PATH ONE is the chord, through xterm's own hook: `attachCustomKeyEventHandler`
		 * runs BEFORE the terminal encodes a key, and returning false is what stops it
		 * being sent to the program. That matters on Linux and Windows, where Ctrl+C is
		 * BOTH copy and SIGINT — so the chord is claimed only when there IS a selection,
		 * and a Ctrl+C with nothing selected still reaches the shell as an interrupt,
		 * which is the behaviour a terminal user expects and would notice immediately if
		 * it were taken away. On macOS the copy chord is ⌘C and ⌃C stays the interrupt,
		 * so the two never compete.
		 *
		 * PATH TWO is the `copy` event itself, for every other route into it: a context
		 * menu, a native accelerator if one is ever added, or the browser's own
		 * selection copying. It is the standard xterm recipe and it is harmless when it
		 * never fires.
		 */
		const copySelection = (): string => term.getSelection() ?? "";
		/*
		 * WHICH KEY COPIES IS A PLATFORM QUESTION, AND GETTING IT WRONG COSTS THE
		 * INTERRUPT (UX round 3, U7 — measured 3/3 in the built app: with a selection,
		 * `sleep 5` kept running and no prompt returned; with none, `^C` arrived
		 * normally).
		 *
		 * The first version claimed Ctrl+C whenever a selection existed, on every
		 * platform, "because Ctrl+C is both copy and SIGINT on Linux and Windows". That
		 * reasoning is right about those platforms and WRONG about macOS, where the copy
		 * chord is ⌘ and ⌃C is the interrupt — so on a Mac a selection silently took the
		 * interrupt away from a running program. A terminal that cannot be interrupted
		 * while text happens to be selected is broken in the way that matters most, so
		 * the branch is now gated exactly as the sentence always claimed: ⌘C copies on
		 * darwin, and ⌃C copies elsewhere.
		 *
		 * The platform test is the one this app already uses for its own shortcuts
		 * (`sidebar-navigation.tsx`, `undo-manager.ts`: `navigator.platform` upper-cased
		 * and searched for `MAC`) rather than a second way of asking.
		 */
		const isMacPlatform = (): boolean =>
			navigator.platform.toUpperCase().indexOf("MAC") >= 0;
		const copyChord = (event: KeyboardEvent): boolean => {
			const key = event.key?.toLowerCase();
			if (key !== "c") return true;
			const chord = isMacPlatform()
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey;
			if (!chord || event.altKey) return true;
			const selection = copySelection();
			// NO SELECTION: not ours. Ctrl+C falls through to the pty as `\x03`.
			if (!selection) return true;
			void navigator.clipboard?.writeText(selection).catch(() => {});
			return false;
		};
		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") return true;
			return copyChord(event);
		});
		const onCopy = (event: ClipboardEvent) => {
			const selection = copySelection();
			if (!selection) return;
			event.clipboardData?.setData("text/plain", selection);
			event.preventDefault();
		};
		host.addEventListener("copy", onCopy);

		setTerminal(term);
		return () => {
			host.removeEventListener("copy", onCopy);
			setTerminal(null);
			term.dispose();
		};
	}, [mode]);

	/*
	 * The subscription: replay, then stream (§10.3).
	 *
	 * The buffer is the point. `subscribe` answers with the bytes already in the log
	 * and the offset live frames resume from, and frames can arrive between the
	 * request and its answer; writing them in arrival order would put the newest
	 * output BEFORE the history it follows. They are held here and flushed after the
	 * replay, in the order main emitted them.
	 */
	useEffect(() => {
		if (!terminal) return;
		if (bytes) {
			/*
			 * A FEED IS A FRESH TERMINAL, and that is the invariant the whole offscreen
			 * capture rests on (Q-11): the frame is a function of the record alone —
			 * `(bytes, grid, theme, font, renderer)` — so bytes from one surface must
			 * never land on a grid that already holds another's. `reset()` is the first
			 * half of the guarantee and it is here rather than only in the caller,
			 * because a caller that forgets to re-key this component would otherwise
			 * append the new record to the old one and hand back a union of two surfaces
			 * — which is exactly what shipped: measured, 212 rows for a 1-line surface
			 * captured after an 8-line one, three different surfaces returning
			 * byte-identical frames.
			 *
			 * The capture page also keys this component on the feed's own nonce, so a new
			 * feed mounts a new terminal; this reset is the half that holds when the key
			 * does not change.
			 */
			terminal.reset();
			/*
			 * THE SETTLE IS THE WRITE'S OWN COMPLETION, NOT A FRAME COUNT (QA round 4's Q-13).
			 *
			 * `write` takes a callback that fires when the data has been PARSED into the
			 * terminal, and the settle used to be "two animation frames after the call" — a
			 * proxy that is right for a prompt and wrong for a large record. Measured: a
			 * 3.9-8 MB record came back as a blank frame on 1 of 5, 2 of 5 and 1 of 5
			 * back-to-back captures of the same surface, because the shutter could beat the
			 * parse. A verdict about CONTENT must not move with the scheduler, which is the
			 * same rule Q-6 and Q-7 were fixed under, applied to the other end of the same
			 * path: there the predicate stopped asking about bytes, and here the handshake
			 * stops asking about frames.
			 */
			terminal.write(bytes, () => settledRef.current?.(terminal));
			return;
		}
		const api = window.api?.console;
		if (!api) {
			return;
		}
		let disposed = false;
		let streaming = false;
		const buffered: Uint8Array[] = [];

		/*
		 * THE HUMAN'S KEYSTROKES, and this line is the whole of the pane's input path
		 * (§10.5, §13.4).
		 *
		 * `onData` IS THE REAL ENCODER, and the design says so in one sentence: "human
		 * typing needs no encoder we own: the mirror's `@xterm/xterm` DOM handler
		 * produces bytes for a real keystroke". So the pane sends what xterm produced —
		 * `\r` for Enter, `\x7f` for Backspace, `\x1b[A` for Up, `\x03` for Ctrl-C —
		 * and `console_keys` is deliberately NOT on this path: that namespace is the
		 * AGENT's named-key vocabulary (§10.5's encoder, which exists because
		 * `@xterm/headless` cannot encode). Routing the pane through it would add a
		 * second encoder to the one path the design says needs none, and the two would
		 * drift the moment a key's spelling changed.
		 *
		 * `paste` IS LEFT TO XTERM, which is not an omission: xterm wraps pasted text in
		 * `\x1b[200~ … \x1b[201~` itself, and only when the program enabled
		 * `modes.bracketedPasteMode` (its own `bracketedPasteMode` state) — so the guard
		 * is already in the bytes by the time they arrive here, and main's `paste` flag
		 * (which wraps only when the RECORD's mode says so, §10.5) is for the agent path
		 * where no terminal is in the loop. Sending `paste: true` from the pane would
		 * double-wrap.
		 *
		 * A REFUSED WRITE IS SWALLOWED, deliberately: a surface can be closed between
		 * the keystroke and the call, and a rejected promise per character would be an
		 * unhandled rejection for a state the pane's own listing already shows.
		 */
		const offData = terminal.onData((data) => {
			void api.input(surface, data).catch(() => {});
		});
		/*
		 * NOTHING IS WIRED TO `onBinary`, and that is a boundary rather than an
		 * oversight: the preload's `console-input` carries TEXT (`input(surface,
		 * text)`, one argument because that is the shape §10.5's "human typing needs
		 * no encoder" needs), and a byte sequence sent through it would be encoded as
		 * UTF-8 on the way to the pty — a decode step that changes 8-bit input into
		 * something else. Reaching that path needs a preload channel that carries
		 * bytes, which is PR A's wire and not this pane's; and the pane does not
		 * enable the mode that raises it. Recorded here so the next reader finds the
		 * reason rather than a second, quieter way of sending input. */

		const offOutput = api.onOutput((payload) => {
			if (payload.surface !== surface) return;
			const bytes = decodeBytes(payload.bytes_base64);
			if (streaming) terminal.write(bytes);
			else buffered.push(bytes);
		});
		const offExit = api.onExit((payload) => {
			if (payload.surface !== surface) return;
			exitRef.current?.(payload.exit_code);
		});

		void api
			.subscribe(surface, 0)
			.then((replay) => {
				if (disposed) {
					void api.unsubscribe(surface).catch(() => {});
					return;
				}
				if (replay.replay_base64) {
					terminal.write(decodeBytes(replay.replay_base64));
				}
				streaming = true;
				for (const bytes of buffered.splice(0)) terminal.write(bytes);
				settledRef.current?.(terminal);
			})
			.catch(() => {
				// A surface that cannot be subscribed to is a surface main no longer
				// has (it was closed, or the app restarted and only history remains).
				// The pane's own listing is what decides which state to render, so this
				// path shows nothing rather than inventing a terminal to show.
				streaming = true;
				buffered.length = 0;
			});

		return () => {
			disposed = true;
			offOutput();
			offExit();
			offData.dispose();
			void api.unsubscribe(surface).catch(() => {});
		};
	}, [terminal, surface, bytes]);

	/*
	 * THE GRID, APPLIED AS MAIN ANSWERED IT (§8.2 step 3).
	 *
	 * A mirror that sized itself from its own box would be the second authority the
	 * design forbids, and the two would disagree for exactly as long as main's
	 * clamped answer differs from a raw `floor(px / cell)` — which is every pane
	 * narrower than the 40-column floor or wider than the 500-column ceiling
	 * (§8.5). So this effect only ever copies a number it was given.
	 */
	useEffect(() => {
		if (!terminal || cols <= 0 || rows <= 0) return;
		if (terminal.cols === cols && terminal.rows === rows) return;
		terminal.resize(cols, rows);
	}, [terminal, cols, rows]);

	/*
	 * THE THEME, THE RECT AND THEIR ONE OBSERVER.
	 *
	 * TWO THINGS FOLLOW THE DOCUMENT rather than a React value, and the reason is
	 * the same for both:
	 *
	 *  - xterm holds its palette as PARSED colours rather than as CSS, so a
	 *    `data-theme` swap on the document is invisible to it until the resolved
	 *    theme is assigned again. Reading that in an effect keyed on the store's
	 *    `themeName` looks equivalent and is not: `ThemeProvider` publishes the
	 *    attribute in its OWN layout effect, and a child's layout effect runs first,
	 *    so a theme change would reach this component while the attribute still held
	 *    the previous palette — one frame of the old colours, every switch. A
	 *    `MutationObserver` on the attribute fires after it lands, which is
	 *    precisely when the computed roles are the new ones.
	 *  - main's grid arithmetic wants the pane's measured cell and content box
	 *    (§8.2 step 1), reported on mount, on resize and on a font change. A font
	 *    change arrives as the same kind of document mutation (a theme carries the
	 *    face's metrics with it in this app), so one observer covers both.
	 *
	 * The rect is the CONTENT BOX in viewport coordinates, which is the space main
	 * crops the displayed-pane capture in (§13.2's first row) and the space the grid
	 * wants. It is measured with `getBoundingClientRect` rather than taken from
	 * `ResizeObserver`'s own box, because the observer's entry has no origin and the
	 * crop needs one.
	 */
	useEffect(() => {
		if (!terminal) return;
		const host = hostRef.current;
		if (!host) return;
		const applyTheme = () => {
			terminal.options.theme = readTerminalTheme();
		};
		const send = () => {
			const report = reportRef.current;
			if (!report) return;
			const rect = host.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			const cell = measureCell(terminalFontFamily(), TERMINAL_FONT_SIZE);
			report({
				contentRect: {
					x: rect.left,
					y: rect.top,
					width: rect.width,
					height: rect.height,
				},
				cellWidth: cell.cellWidth,
				cellHeight: cell.cellHeight,
				visible,
				theme: useUiPreferencesStore.getState().themeName,
			});
		};
		const refresh = () => {
			applyTheme();
			send();
		};
		refresh();
		const resize = new ResizeObserver(send);
		resize.observe(host);
		const theme = new MutationObserver(refresh);
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "class"],
		});
		return () => {
			resize.disconnect();
			theme.disconnect();
		};
	}, [terminal, visible]);

	return (
		<div
			ref={hostRef}
			className={cn("h-full w-full overflow-hidden", className)}
			/*
			 * The mirror is not a control: it holds no border of its own and takes no
			 * focus ring. Its ground is the terminal's own (`sunken`, §9) and the
			 * keystrokes it forwards are the program's, which is why the pane's own
			 * chrome — header, list, states — is where every app control in this slot
			 * lives.
			 */
			data-tour-tag="console-mirror"
		/>
	);
};
