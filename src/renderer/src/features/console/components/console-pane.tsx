import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	isConsoleUnseen,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { Bot, Lock, LockOpen, PanelRightClose, Plus } from "lucide-react";
import { type FC, useEffect, useMemo, useState } from "react";
import { useConsoleBlipPulse } from "../hooks/use-console-attention";
import { useConsoleSession } from "../hooks/use-console-session";
import {
	consoleOpenAction,
	pickActiveSurface,
	surfaceTitle,
	surfacesForSession,
} from "../model/console-surfaces";
import { ConsoleMirror } from "./console-mirror";
import {
	ConsoleEmpty,
	ConsoleEndedBar,
	ConsoleLoading,
	ConsoleNotice,
	ConsoleSecureBar,
	ConsoleUnavailable,
} from "./console-states";

/**
 * The console: the FOURTH occupant of the conversation's right slot.
 *
 * Design: `docs/design/ui-console-tab.md` 6.1 (the pane, its lens and its width),
 * 6.2 (recall on a session switch), 6.4 (the pty's lifetime is the surface's, never
 * the pane's), 6.5 (provenance: the surface's own command, and the agent marker the
 * browser's strip uses), 7.3 (the ended state), 9.4 (the pane's chrome is the app's
 * and the terminal's colours stay inside the mirror), 12.2 (the blip and when it is
 * cleared).
 *
 * IT IS THE SLOT'S FOURTH MODE, NOT A ROUTE AND NOT A TOGGLE THAT LOSES THE
 * SESSION. Everything the three existing occupants do, this one does the same way:
 * one name in `claimRightSlot`'s union (so opening it closes its siblings by
 * construction), one width preference the divider drags, one `{isOpen && …}` block
 * in `chat-content.tsx`, and one trigger in the header cluster. There is no
 * `/console` route, because a route has no session — and a console whose identity
 * depended on which route was open would be a second place the "which surface am I
 * looking at" question is answered.
 *
 * THE PANE IS REMOUNTED ON A SESSION SWITCH (`chat-page.tsx` keys the session panel
 * on `identity`), so the pane must be able to re-attach with its history intact.
 * That is not a nicety and it is not free: the lens lives in the STORE
 * (`consoleActiveSurface`) rather than in this component, the mirror subscribes on
 * mount and replays the surface's retained bytes before it streams (§7.1: the log
 * and the core never stopped while the pane was away), and §6.2's three cases —
 * another session's surfaces, back to the first session's still-running ones, and
 * the surface an agent opened — are all the same mechanism: the registry is keyed
 * by session and the pane filters by it.
 *
 * WHAT THIS COMPONENT NEVER DOES: it never resizes a surface (the mirror reports
 * measurements and main decides — §8), it never signals a pty on unmount (§6.4:
 * there is no path from "pane unmounts" to "pty receives a signal", which is what
 * makes "keeps running while the tab is closed" true rather than accidental), and
 * it never reads a keystroke for the app's benefit (§11.4: human input goes from
 * the mirror to the pty master and nowhere else).
 */
export interface ConsolePaneProps {
	/** The conversation this pane is scoped to, or `null` on a draft. */
	sessionId: string | null;
	onClose: () => void;
}

export const ConsolePane: FC<ConsolePaneProps> = ({ sessionId, onClose }) => {
	/** The slot's lens. See the header comment for why this is not `useState`. */
	const stored = useUiPreferencesStore((state) => state.consoleActiveSurface);
	const setStored = useUiPreferencesStore(
		(state) => state.setConsoleActiveSurface,
	);
	const unseen = useUiPreferencesStore((state) => state.consoleUnseen);
	const clearUnseen = useUiPreferencesStore(
		(state) => state.clearConsoleUnseen,
	);
	/* The user's own open of this pane, waiting to be answered (see the store's
	 * `consoleOpenIntent` for why a request is not carried in a prop). */
	const openIntent = useUiPreferencesStore((state) => state.consoleOpenIntent);
	const clearOpenIntent = useUiPreferencesStore(
		(state) => state.clearConsoleOpenIntent,
	);
	/**
	 * A monotonic request for the terminal to take the caret, handed to the mirror.
	 *
	 * LOCAL STATE ON PURPOSE, and the reset a remount performs is the feature: the
	 * pane is remounted on a session switch (`chat-page.tsx` keys it on `identity`),
	 * so a caret request cannot outlive the open that asked for it and pull the
	 * keyboard out of another conversation's composer.
	 */
	const [focusRequest, setFocusRequest] = useState(0);
	/**
	 * Whether the open this pane is answering is still waiting for main to make a
	 * surface — the window `createSurface`'s promise exists to cover, and one the
	 * loading state above is the honest thing to show: the pane HAS been asked for a
	 * terminal and does not have one yet, so "no console in this session" and its `+`
	 * would be an answer to a question nobody is asking, with a second press in it
	 * making a second surface.
	 */
	const [creating, setCreating] = useState(false);
	/* One answer for the whole list: whether a completion is still fresh enough to
	   pulse (§12.2's two states), asked once rather than per row. */
	const blipPulsing = useConsoleBlipPulse(unseen);

	const session = useConsoleSession(sessionId);
	const surfaces = useMemo(
		() => surfacesForSession(session.snapshot, sessionId),
		[session.snapshot, sessionId],
	);
	const surface = useMemo(
		() => pickActiveSurface(session.snapshot, sessionId, stored),
		[session.snapshot, sessionId, stored],
	);
	/* Whether main says a console can exist at all (§15). Read once and used in two
	   places — the body's state choice and the header's `+` — because a `+` that is
	   offered where none can be created is the pane's own "a control with nothing to
	   act on lies". */
	const available = session.snapshot.available;

	/*
	 * The lens follows what is actually shown, and that write is what makes the
	 * recall survive a switch: the pane is unmounted while the user is in another
	 * conversation, so the only thing that can remember "this session was reading
	 * that surface" is the store.
	 */
	useEffect(() => {
		if (surface && surface.surface !== stored) setStored(surface.surface);
	}, [surface, stored, setStored]);

	/*
	 * Main is told which surface a pane is showing. It never resizes anything from
	 * this (§10.2's pane ops are a fact, not a lever): what it buys is the honest
	 * `rendered: "displayed"` value on a capture and the answer to "is anybody
	 * looking at this surface", which is the blip's clearing rule.
	 */
	useEffect(() => {
		session.showSurface(surface?.surface ?? null);
		return () => session.showSurface(null);
	}, [session.showSurface, surface?.surface]);

	/*
	 * THE BLIP'S CLEARING RULE (§12.2): cleared when the pane is displayed AND
	 * focused on that surface, which is the same visibility predicate the notifier's
	 * first rung uses — never "could a banner reach them". `document.hasFocus()` is
	 * the renderer's own answer to the window half of it, and the `focus` listener is
	 * what clears a mark when the user comes back to a window that was showing the
	 * surface all along.
	 */
	useEffect(() => {
		if (!surface) return;
		const clear = () => {
			if (document.hasFocus()) clearUnseen(surface.surface);
		};
		clear();
		window.addEventListener("focus", clear);
		return () => window.removeEventListener("focus", clear);
	}, [surface?.surface, clearUnseen, surface]);

	/*
	 * THE USER'S OPEN, ANSWERED (design 6.1; the operator's report that the pane
	 * "should not greet you with an empty state and a New console button").
	 *
	 * WHAT "OPEN" MEANS: the conversation gets a console if it has none, and the
	 * caret goes into the terminal either way, because a user who opens a console is
	 * about to type at it. `consoleOpenAction` holds the decision and its four
	 * inputs; this effect is the dispatcher and the bookkeeping.
	 *
	 * THE REQUEST IS CLEARED ONLY WHEN IT HAS BEEN ANSWERED. "Still loading" is not an
	 * answer — the read is what says whether this conversation already has a surface —
	 * so the request waits there rather than being consumed into a second surface.
	 */
	useEffect(() => {
		if (!openIntent) return;
		if (sessionId === null) {
			// A draft has no conversation to run in, so there is nowhere to put a
			// surface; the pane's own draft notice is the answer, and the request is
			// done rather than pending until a conversation appears.
			clearOpenIntent();
			return;
		}
		const action = consoleOpenAction({
			requested: true,
			loading: session.loading,
			available,
			hasSurface: surface !== null,
		});
		if (action === "none") {
			// `available: false` with the read settled is main's own "no console can
			// exist here" (§15): the pane renders that state, and the request is done.
			if (!session.loading) clearOpenIntent();
			return;
		}
		/*
		 * The surface a request creates is born with main's own defaults — the login
		 * shell, the 100x30 grid, `reveal: "none"` — exactly as the pane's `+` makes
		 * one, because two ways for a user's surface to come into being is the defect.
		 * Its working directory is main's answer for this session rather than a path
		 * guessed here: the renderer cannot see the conversation's own directory, and a
		 * second opinion about it is how a user's shell ends up somewhere they did not
		 * choose.
		 */
		if (action === "create") {
			setCreating(true);
			void session.createSurface().finally(() => setCreating(false));
		}
		setFocusRequest((value) => value + 1);
		clearOpenIntent();
	}, [
		openIntent,
		sessionId,
		session.loading,
		session.createSurface,
		available,
		surface,
		clearOpenIntent,
	]);

	if (sessionId === null) {
		return (
			<div className={cn("flex h-full flex-col bg-surface")}>
				{/* The slot's bar at the slot's height, so the pane's own bar does not move
				    between a draft and a conversation — and the CLOSE control is in it for
				    the same reason every other occupant of this slot has one: a pane the
				    user cannot close from inside is a pane they have to find the trigger
				    for, and a draft carries the control even though a draft has no session
				    for its `+` to act on. */}
				<div
					className={cn(
						"flex h-10 shrink-0 items-center justify-between gap-2 bg-sunken px-2",
					)}
					data-tour-tag="console-pane-header"
				>
					<span className={cn("shrink-0 text-meta text-ink-dim")}>Console</span>
					<Tooltip content="Close console">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Close console"
							onClick={onClose}
							data-tour-tag="console-pane-close"
						>
							<PanelRightClose aria-hidden="true" />
						</Button>
					</Tooltip>
				</div>
				<ConsoleNotice
					title="A console needs a conversation"
					detail="A console runs in a conversation's working directory, so there is nowhere to put one yet."
				/>
			</div>
		);
	}

	const body = () => {
		/*
		 * LOADING FIRST, THEN UNAVAILABLE, THEN EMPTY — and the order is load-bearing
		 * now that main ANSWERS an unavailable state rather than throwing: `available`
		 * is false in the snapshot a pane starts with, so a check on it before the
		 * loading branch would flash "the console is not available" for one frame on
		 * every mount. `session.error` is ORed in because a window that cannot reach
		 * main at all never gets an answer to read.
		 */
		if ((session.loading || creating) && surfaces.length === 0)
			return <ConsoleLoading />;
		if (!session.snapshot.available || session.error) {
			return (
				<ConsoleUnavailable
					reason={session.snapshot.reason}
					detail={session.snapshot.detail}
					message={session.error}
				/>
			);
		}
		if (!surface) {
			return (
				<ConsoleEmpty
					onCreate={session.createSurface}
					disabled={sessionId === null}
				/>
			);
		}
		return (
			<div className={cn("flex min-h-0 grow flex-col")}>
				{/* The ended banner is ABOVE the history rather than instead of it (§7.3):
				    a replayed surface shows what it printed and says that nothing is
				    running. `live: false` is the relaunch case and gets its own sentence. */}
				{!surface.running ? (
					<ConsoleEndedBar exitCode={surface.exitCode} live={surface.live} />
				) : null}
				{/*
				 * `relative` FOR THE SECURE MARKER ONLY: it is an overlay so that
				 * flipping the toggle cannot move the mirror's content box and send the
				 * running program a `SIGWINCH` (§8.2's box is the pane's content box,
				 * and a marker the user flips is not allowed to resize their program).
				 */}
				{/*
				 * `px-2` IS THE PANE'S GUTTER, ON THE TERMINAL TOO (design round 2,
				 * D12). The header's title and the strip's pills are inset by 8 px and
				 * the terminal used to start at the pane's own edge, so the width
				 * allowance was spent as a right-hand gutter of ground rather than as
				 * chrome: measured, 780 px of grid inside an 804 px pane, with column 0
				 * at x=1 against the title's x=9. One gutter, one width, and the
				 * default width (`CONSOLE_PANE_CHROME_PX`) is now exactly these two.
				 */}
				<div className={cn("relative flex min-h-0 grow flex-col px-2")}>
					{/*
					 * `key` ON THE SURFACE, and it is the re-attach rule rather than a
					 * micro-optimisation: one mirror holds one subscription and one terminal,
					 * so switching surfaces in this pane must dispose the old one — which is
					 * also what drops the old subscription in main (`unsubscribeAll` is
					 * addressed by surface) instead of leaving a stream nobody reads.
					 */}
					<ConsoleMirror
						key={surface.surface}
						surface={surface.surface}
						/* The caret, on the user's own open and never on a mount (see
						   `focusRequest` above). */
						focusRequest={focusRequest}
						/* The pane is open and this is the surface it is showing, so this
					   mirror is on screen: `visible: true` is what lets main derive a grid
					   from its report at all (§8.2/8.3). A pane that is mounted but
					   hidden — a slot being animated, a window behind another app — is not
					   a case this component can observe, and the design's answer is that
					   only a DISPLAYED pane reports, which is the mount itself. */
						visible={true}
						cols={surface.cols}
						rows={surface.rows}
						onReport={(report) =>
							session.reportContent(surface.surface, report)
						}
						onExit={() => session.refresh()}
					/>
					{surface.secure ? <ConsoleSecureBar /> : null}
				</div>
			</div>
		);
	};

	return (
		<div
			// `bg-surface`, the same ground the canvas, the run panel and the browser
			// pane take, so the four occupants of this slot read as one slot with four
			// modes (§6.1, §9.4).
			className={cn("flex h-full flex-col bg-surface")}
			data-tour-tag="console-pane"
		>
			{/*
			 * The pane's header: 40px and `bg-sunken`, the size and ground the slot's
			 * other three panes state for their own bar, so the bar does not move when
			 * the user switches mode.
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 bg-sunken px-2",
				)}
				data-tour-tag="console-pane-header"
			>
				<div className={cn("flex min-w-0 items-center gap-2")}>
					{/* The pane's title at the slot's own title step, not louder: the pane's
					    contents name it, which is the browser pane's measured D4. */}
					<span className={cn("shrink-0 text-meta text-ink-dim")}>Console</span>
					{/* The surface's own command, which §6.5 makes load-bearing: a person
					    looking at this bar and an agent reading `console_list` describe the
					    same object. Truncated rather than wrapped in a 40px bar. */}
					{surface ? (
						<span
							className={cn("truncate text-ink-muted text-mono-sm")}
							title={`${surfaceTitle(surface)}${surface.argvTail ? ` ${surface.argvTail}` : ""}`}
							data-tour-tag="console-surface-command"
						>
							{surfaceTitle(surface)}
						</span>
					) : null}
				</div>
				<div className={cn("flex shrink-0 items-center gap-1")}>
					{/* The `+` in the pane's own chrome, beside the surface list (§6.1). It
					    is present in the empty state too, where it is the control a
					    first-run user actually uses. */}
					<Tooltip
						content={
							available
								? "New console"
								: "The console is not available in this app"
						}
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="New console"
							onClick={session.createSurface}
							/* DISABLED WHEN THERE IS NOTHING TO ACT ON, which is the pane's
							   own stated principle ("a control with nothing to act on lies"):
							   in the unavailable state the `+` rendered identically to the
							   empty state's and did nothing when pressed. */
							disabled={!available}
							data-tour-tag="console-new-surface"
						>
							<Plus aria-hidden="true" />
						</Button>
					</Tooltip>
					{/* The secure-input toggle, offered only when there is a surface to make
					    secure: a control with nothing to act on is a control that lies. */}
					{surface ? (
						<Tooltip
							content={
								surface.secure
									? "Stop secure input"
									: "Secure input: stop recording this terminal"
							}
						>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={
									surface.secure ? "Stop secure input" : "Secure input"
								}
								aria-pressed={surface.secure}
								className={cn(surface.secure && "text-accent")}
								onClick={() =>
									session.setSecure(surface.surface, !surface.secure)
								}
								data-tour-tag="console-secure-toggle"
							>
								{surface.secure ? (
									<Lock aria-hidden="true" />
								) : (
									<LockOpen aria-hidden="true" />
								)}
							</Button>
						</Tooltip>
					) : null}
					{/* THE SAME EXIT AS THE SLOT'S OTHER THREE PANES: the same glyph, size
					    and tooltip in the same corner, because an icon-only control whose
					    siblings all carry a label is the one that gets mistaken for
					    something else. */}
					<Tooltip content="Close console">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Close console"
							onClick={onClose}
							data-tour-tag="console-pane-close"
						>
							<PanelRightClose aria-hidden="true" />
						</Button>
					</Tooltip>
				</div>
			</div>
			{surfaces.length > 0 ? (
				/* THE PANE'S OWN LIST, which is also its lens (§6.1's "one more control
				   in the header cluster" is the slot's trigger; this is the pane's). A row
				   per surface, the active one on `elevated`, and the two marks the design
				   fixes: the agent marker the browser's strip already uses for an
				   agent-opened tab, and the blip's dot. */
				<div
					className={cn(
						"flex shrink-0 items-center gap-1 overflow-x-auto border-hairline border-b px-2 py-1",
					)}
					role="tablist"
					aria-label="Console surfaces"
					data-tour-tag="console-surface-list"
				>
					{surfaces.map((row) => {
						const isActive = row.surface === surface?.surface;
						return (
							<button
								key={row.surface}
								type="button"
								role="tab"
								aria-selected={isActive}
								onClick={() => setStored(row.surface)}
								className={cn(
									"flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-meta",
									isActive
										? "bg-elevated text-ink"
										: "text-ink-muted hover:bg-row-hover",
								)}
								data-tour-tag="console-surface-row"
							>
								{/* The agent marker says who ELSE is using this surface, exactly
								    as the browser strip's does (§6.5's "the pane's visible marker"
								    is the human half of the provenance the listing carries) — and
								    §13.4's co-pilot cell is the second reason it can appear: an
								    agent typing into a surface the USER opened left this row
								    unchanged, because `origin` is fixed at create and never moves.
								    `lastActor` is the fact that does move, so the mark follows it
								    and the title says which of the two happened. `size-4` is the
								    browser strip's own size, taken so the same glyph in two panes
								    of one slot is one size. */}
								{row.agentOwned || row.lastActor === "agent" ? (
									/* The `title` rides a wrapper: a lucide icon is a `<svg>`, and
									   the attribute is a tooltip for a reader who wants to know
									   WHICH of the two facts this mark is reporting. */
									<span
										className={cn("flex shrink-0 items-center")}
										title={
											row.agentOwned
												? "An agent opened this console"
												: "An agent has typed into this console"
										}
									>
										<Bot
											aria-hidden="true"
											className={cn("size-4 shrink-0 text-accent")}
										/>
									</span>
								) : null}
								<span className={cn("max-w-[12rem] truncate")}>
									{surfaceTitle(row)}
								</span>
								{row.secure ? (
									<Lock
										aria-hidden="true"
										className={cn("size-3 shrink-0 text-ink-dim")}
									/>
								) : null}
								{!row.running ? (
									<span className={cn("text-ink-dim text-mono-sm")}>
										{row.exitCode === null ? "ended" : row.exitCode}
									</span>
								) : null}
								{isConsoleUnseen(unseen, row.surface) ? (
									/* The blip, on the surface's own row. TWO STATES, and the difference is
									   what the mark means: `accent` and a pulse while the completion is
									   fresh, then the resting `ink-muted` dot — the canvas button's own dot
									   colour — because an unread mark must not animate for ever (§12.2).
									   The pulse is the same 2 s opacity step the skeleton uses, and the
									   app's stylesheet caps it under `prefers-reduced-motion`, so a frozen
									   dot is the reduced-motion state rather than a missing one. */
									<span
										aria-label="Finished since you last looked"
										className={cn(
											"size-2 shrink-0 rounded-full",
											blipPulsing
												? "bg-accent animate-pulse-visible"
												: "bg-ink-muted",
										)}
										data-tour-tag="console-surface-blip"
									/>
								) : null}
							</button>
						);
					})}
				</div>
			) : null}
			<div className={cn("flex min-h-0 grow flex-col")}>{body()}</div>
		</div>
	);
};
