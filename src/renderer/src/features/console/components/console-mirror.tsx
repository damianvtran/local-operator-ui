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
		setTerminal(term);
		return () => {
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
			// The capture path: the record's bytes, written once into a fresh mirror. A
			// retry re-mounts this component (the capture page keys it on the feed's
			// nonce), so the second attempt paints the same settled state rather than
			// appending a second copy of the log to the first one's.
			terminal.write(bytes);
			settledRef.current?.(terminal);
			return;
		}
		const api = window.api?.console;
		if (!api) {
			return;
		}
		let disposed = false;
		let streaming = false;
		const buffered: Uint8Array[] = [];

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
