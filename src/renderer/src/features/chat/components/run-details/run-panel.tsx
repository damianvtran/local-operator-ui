/**
 * The run panel: the right pane's second mode (`docs/run-sidebar.md` § 3, § 5.6, § 7).
 *
 * A sibling of the canvas rather than a popover over it, because the operator's
 * ask was for a pane that SWAPS with the canvas and stays readable BESIDE the
 * transcript. The canvas is a document pane; this is the live view over the
 * session's delegated work, which is the sentence the retired popover already
 * carried and the reason a taller, resizable pane is worth having.
 *
 * What lives here rather than in the body:
 *
 * - **The 40px `sunken` chrome bar**, the canvas's own pattern at the same
 *   height and on the same ground, so the two panes read as two modes of one
 *   slot. Its left half is the reader's (a back control and the breadcrumb, which
 *   IS the title — the pane has no visible one, for the reason the canvas removed
 *   its own); its right half is the pane's (a close button, and the reader's
 *   navigation controls).
 * - **The reader's position**, which is the lineage PATH over `parent_job_id`
 *   (`§ 5.5`) rather than a visit-history stack: a path needs no separate state,
 *   cannot go stale, and makes the breadcrumb and "back" agree by construction.
 *   It is walked over `details.lineage` — every `task` row — not over the roster,
 *   which is the members alone (`§ 4`): a walk that could only see members would
 *   stop at the first level and take the ancestors, the peer stepper and the
 *   `N children` control with it.
 * - **The scroll owner**: the roster area in the roster view, the transcript in
 *   the reader view, never both. Two nested scrollers is the defect the old
 *   popover's `min(60vh, 480px)` ceiling existed to avoid.
 * - **The Escape ladder** (`§ 3.5`), bound on the DOCUMENT while the pane is
 *   open and guarded to a press that came from inside the pane or from the
 *   trigger, stopping propagation so the window-level Escape that cancels a
 *   pending session open cannot act on the same press. It is not bound on this
 *   container because the trigger lives in the header, OUTSIDE it: a ladder
 *   bound here can never see a key pressed on the trigger, which is the state
 *   the trigger's own click leaves focus in (round 1, U1-2).
 *
 * It does NOT own `isRunPanelOpen`: that is global and persisted (§ 3.5), like
 * the canvas's own flag, so switching conversations keeps the pane open on the
 * new session's data while the reader resets — a child belongs to one session's
 * lineage, and a reader pointed at another session's child is not a state
 * anything should be able to reach.
 */

import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { Button, Tooltip } from "@shared/components/ui";
import { scrollRegionToTop } from "@shared/lib/scroll";
import { cn } from "@shared/lib/utils";
import type { RunPanelSection } from "@shared/store/ui-preferences-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, PanelRightClose } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopChildTranscriptPage } from "../../../../../../shared/desktop-session-contract";
import { RunChildReader } from "./run-child-reader";
import {
	type McpServerRow,
	type RunDetails,
	type SubagentRow,
	isOpenChildStatus,
} from "./run-detail-model";
import { RunDetailsPanel } from "./run-details-panel";
import type { McpRemedyControls } from "./use-mcp-remedy";

export type RunPanelProps = {
	details: RunDetails;
	mcpServers: readonly McpServerRow[];
	/**
	 * Whether the read carries an operation that is still running. Passed through to
	 * the MCP section, which disables every other row's control while it does (code
	 * review round 1, finding 5: the lock covers servers this pane has no row for).
	 */
	mcpGrantRunning: boolean;
	/** The pane's MCP remedy controls, threaded to the MCP section (`chat-page`). */
	mcpRemedy: McpRemedyControls;
	/** The canonical session id the reader's route is addressed with. */
	sessionId: string | null;
	/** Per-child pulse counters, from the canonical session stream (`§ 5.3`). */
	pulses: Readonly<Record<string, number>>;
	/** Whether `subagent_transcript` negotiated (`§ 10.2`). */
	childrenOpenable: boolean;
	/**
	 * The child whose reader is open, or `null` for the roster view.
	 *
	 * CONTROLLED rather than local state, and that is `§ 3.4`'s requirement rather
	 * than tidiness: the trigger's attention dot has to know whether the list is on
	 * screen, and only the component that renders BOTH the trigger and this pane
	 * can answer that. So the view state lives one level up (`chat-content.tsx`)
	 * and is reported to the trigger from there.
	 */
	readerChildId: string | null;
	onReaderChildChange: (id: string | null) => void;
	/**
	 * The pane's own width, in pixels — the pane's geometry, threaded to the
	 * sections whose tallies are budgeted against it (`§ 8`, `tallyBudget`).
	 *
	 * Passed DOWN rather than read from the store in the sections: the pane is
	 * sized by the value `chat-content.tsx` puts on the wrapper's `width` and
	 * `minWidth`, and a section that read the preference itself could disagree
	 * with the pane it is drawn in.
	 */
	paneWidth: number;
	/**
	 * A child page to paint instead of fetching one, for the story set.
	 *
	 * Threaded through the pane because the pane is what mounts the reader; the app
	 * never supplies it, and `RunChildReader` documents why the seam exists.
	 */
	previewPage?: DesktopChildTranscriptPage | null;
	onClose: () => void;
};

/** The rows that launched from the same parent, in the WIRE's own order.
 *
 * The authoritative sibling order, deliberately not the roster's presentation
 * order: the roster is a priority slice with a cap, and a stepper walking that
 * would skip the children the cap hid and change step as the slice moved. The
 * TUI makes the same choice and says why (`app.py:24187-24215`): a list that
 * loses the selected node's position oscillates over the first two children.
 */
const siblingsOf = (
	rows: readonly SubagentRow[],
	row: SubagentRow,
): SubagentRow[] =>
	rows.filter((candidate) => candidate.parentJobId === row.parentJobId);

/** The child's own children, in the same authoritative order. */
const childrenOf = (
	rows: readonly SubagentRow[],
	row: SubagentRow,
): SubagentRow[] =>
	rows.filter((candidate) => candidate.parentJobId === row.id);

export const RunPanel = ({
	details,
	mcpServers,
	mcpGrantRunning,
	mcpRemedy,
	sessionId,
	pulses,
	childrenOpenable,
	paneWidth,
	readerChildId,
	onReaderChildChange,
	previewPage = null,
	onClose,
}: RunPanelProps) => {
	const openChildId = readerChildId;
	/**
	 * The pane's own root, for the Escape ladder's guard: a press belongs to the
	 * pane when its target is inside this element (or is the trigger, which is
	 * deliberately outside it — see the document listener below).
	 */
	const sectionRef = useRef<HTMLElement>(null);
	/*
	 * The disclosure's state, hoisted here from the roster so a drill-in and back
	 * does not collapse the list under the reader (`§ 4`: it lasts "for as long as
	 * the panel is open on that session"). It still resets when the panel closes,
	 * because this component unmounts with it.
	 */
	const [rosterExpanded, setRosterExpanded] = useState(false);
	/*
	 * The degraded state's action (`§ 10.5`). `canUpdateBackend` is the same guard
	 * the compatibility banner uses for the same button — the updater is a main-
	 * process capability and a browser build has none — so the control appears only
	 * where it can work, and `Retry` covers the case where it cannot: a backend that
	 * came up since the capabilities were read.
	 */
	const [updatingBackend, setUpdatingBackend] = useState(false);
	const [updateBackendError, setUpdateBackendError] = useState<string | null>(
		null,
	);
	const queryClient = useQueryClient();
	const canUpdateBackend = Boolean(window.api?.updater?.updateBackend);
	const retryCapabilities = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: desktopKeys.capabilities });
	}, [queryClient]);
	const updateBackend = useCallback(async () => {
		setUpdatingBackend(true);
		setUpdateBackendError(null);
		try {
			await window.api.updater.updateBackend();
			retryCapabilities();
		} catch {
			setUpdateBackendError("The backend update could not start.");
		} finally {
			setUpdatingBackend(false);
		}
	}, [retryCapabilities]);
	/** One line above the roster when a child could not be opened at all. */
	const [unopenable, setUnopenable] = useState(false);
	/*
	 * The header's own facts, cached so they survive the child leaving
	 * `frontend.jobs` (a settled child is swept minutes later, `§ 5.2`). The row the
	 * reader was OPENED FROM is deliberately not recorded any more: the lineage
	 * walk below gives `leaveReader` a better answer — the nearest ancestor that is
	 * actually a row — where a single id could only ever name the page the user
	 * landed on (round 2, Q2-1/U2-1).
	 */
	const cachedRow = useRef<SubagentRow | null>(null);

	const openRow = useMemo(
		() =>
			openChildId
				? (details.lineage.find((row) => row.id === openChildId) ?? null)
				: null,
		[details.lineage, openChildId],
	);
	// The roster's live row while it is present, else whatever the panel opened
	// with: a swept child keeps its facts instead of blanking its own header.
	if (openRow) cachedRow.current = openRow;
	const row = openRow ?? (openChildId ? cachedRow.current : null);

	/*
	 * The path, walked over `parent_job_id` (`§ 5.5`). The guard is not
	 * decoration: the wire's lineage comes from the runtime's own graph, and a
	 * cycle there would hang this walk rather than mis-draw it.
	 */
	const path = useMemo(() => {
		if (!row) return [] as SubagentRow[];
		const byId = new Map(details.lineage.map((entry) => [entry.id, entry]));
		const chain: SubagentRow[] = [];
		const seen = new Set<string>();
		let cursor: SubagentRow | undefined = row;
		while (cursor && !seen.has(cursor.id)) {
			seen.add(cursor.id);
			chain.unshift(cursor);
			cursor = cursor.parentJobId ? byId.get(cursor.parentJobId) : undefined;
		}
		return chain;
	}, [details.lineage, row]);

	/*
	 * Leaving the reader entirely (`§ 5.5`): the roster replaces the child's page.
	 * Focus returns to the row it came from — one rAF later, because the roster has
	 * to paint before its button can take focus — and the unopenable note is
	 * cleared, since it describes a child the reader has now left.
	 *
	 * WHICH row is the whole of round 2's Q2-1/U2-1. The child the reader was
	 * opened FROM is not always a roster row: a grandchild, and every page reached
	 * by descending (the `N child` control, a crumb, a peer stepper, all of which
	 * call `openChild`), has no row by design (`§ 4`). The query then returned null,
	 * `?.focus()` was a no-op, and focus fell to `<body>` — where the ladder's own
	 * guard refused every later press, so the pane could not be closed with
	 * `Escape` at all. The home for those pages is the nearest ancestor that IS a
	 * row — walking up the reader's own path, which is why `path` is a dependency
	 * here — and the trigger is the fallback when even that is not on screen (a row
	 * behind `Show N more` is a member without a rendered row). Focus is never left
	 * to land wherever it likes: the one outcome this may not have is `<body>`.
	 */
	const leaveReader = useCallback(() => {
		onReaderChildChange(null);
		setUnopenable(false);
		requestAnimationFrame(() => {
			const row = [...path]
				.reverse()
				.map((entry) =>
					document.querySelector<HTMLButtonElement>(
						`[data-run-panel-row="${CSS.escape(entry.id)}"] button`,
					),
				)
				.find((element) => element !== null);
			(
				row ??
				document.querySelector<HTMLButtonElement>("[data-run-panel-trigger]")
			)?.focus();
		});
	}, [onReaderChildChange, path]);

	/*
	 * BACK: one level UP the lineage, and out of the pane at the first level
	 * (`§ 5.5`, `§ 3.5`).
	 *
	 * The two-rung rule is the document's own, implemented rather than
	 * approximated: the reader's path is `session -> child -> ... -> current`, so
	 * while there is a parent to land on, back is that parent's page; at the first
	 * level there is no step left inside the reader and back leaves the pane, the
	 * same exit the ✕ and the breadcrumb's root crumb take. Before this rule the
	 * control left the reader from ANY depth, which is why it disagreed with the
	 * breadcrumb — the crumb popped one level from the same state (round 1,
	 * Q6/U1-3).
	 *
	 * `Escape` is deliberately NOT this (`leaveReader`, below): the TUI separates
	 * "up one level" (`p` = parent) from "leave the mode" (`esc` = `_leave`,
	 * `subagent_view.py:3423-3424`), and the desktop's two controls follow it.
	 */
	const back = useCallback(() => {
		const parent = path.length > 1 ? path[path.length - 2] : null;
		if (parent) {
			/*
			 * A level up, NOT through `openChild`: that records the row the reader was
			 * opened FROM, and a step up the lineage is not a new open — the return
			 * path after it is still the row the user started from. Focus needs no
			 * help here either: the reader is keyed by the child, so the parent's page
			 * mounts afresh and takes focus into its own body (`§ 8`).
			 */
			setUnopenable(false);
			onReaderChildChange(parent.id);
			return;
		}
		/*
		 * The first level. The pane closes, and the trigger takes focus back — which
		 * is the trigger's own effect rather than a call here, because this button
		 * unmounts with the pane and a `focus()` on a detached node is a no-op.
		 */
		setUnopenable(false);
		onClose();
	}, [onClose, onReaderChildChange, path]);

	const openChild = useCallback(
		(id: string) => {
			cachedRow.current = null;
			setUnopenable(false);
			onReaderChildChange(id);
		},
		[onReaderChildChange],
	);

	/*
	 * `§ 3.5`'s ladder, bound on the DOCUMENT while the pane is open and GUARDED
	 * to a press that actually belongs to it: one that came from inside this
	 * section, or from the trigger.
	 *
	 * Why not on the container, which is where it used to be: the trigger lives in
	 * the header, outside this subtree (`section.contains(trigger) === false`), so
	 * the state the trigger's own click produces — focus on the button, pane open,
	 * list on screen — could not be left with Escape at all, and `⌘[` was equally
	 * dead from there (round 1, U1-2/Q5). A ladder bound where the trigger's focus
	 * cannot reach is a promise the surface does not keep.
	 *
	 * Why not unguarded on the window: the composer is a live text field in this
	 * layout, and Escape belongs to it. The guard names the two places a press can
	 * come from, so a key pressed in the textarea is not this pane's to answer —
	 * and it is a test of the EVENT TARGET rather than of `activeElement`, because
	 * a synthetic key event carries its own target.
	 *
	 * `stopPropagation` is what keeps the window-level Escape (which cancels a
	 * pending session open, `chat-page.tsx`) from acting on the same press: a
	 * listener on `document` is on the way to `window`, so stopping here is enough.
	 *
	 * `⌘[`/`Ctrl+[` is the platform's own back gesture (`§ 5.5`) and takes the back
	 * RULE; `Escape` takes the leave-the-view rule. Both are keyboard chords rather
	 * than bare letters because the composer is live: the TUI's `p`/`c`/`r` would
	 * have to be stolen from a focused text field, which is why its single-letter
	 * keys are controls here.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!target) return;
			const fromTrigger = target.closest("[data-run-panel-trigger]") !== null;
			const inPane = sectionRef.current?.contains(target) ?? false;
			/*
			 * A press carrying no element of its own — `<body>`, which is where focus
			 * lands when it is lost — still belongs to the pane while the pane is open
			 * (round 2, Q2-1/U2-1). Leave the reader without a row to focus (below) and
			 * the next press arrives from `<body>`; a guard that names only the trigger
			 * and the section then refuses the one key the design promises there.
			 */
			const onDocument =
				target === document.body || target === document.documentElement;
			const mine = fromTrigger || inPane;
			/*
			 * ESCAPE IS THE PANE'S FROM ANYWHERE WHILE IT IS OPEN (QA round 1's
			 * Q2). The contract lists this pane ABOVE the composer's turn
			 * interrupt, and the two disagreed about the case that matters: with
			 * the pane open and focus in the composer, the press used to
			 * interrupt the turn and leave the pane open - one press acting on
			 * the lower rung and the higher one silently doing nothing.
			 *
			 * Scoped to Escape and to an UNCLAIMED press. A layer inside this
			 * pane (a tooltip, a select) still wins, because it preventDefaults
			 * from the capture phase and this flag is false for it; and the
			 * single-letter keys above stay scoped to the pane, the trigger and
			 * `<body>`, because those are the pane's own controls and stealing
			 * them from a focused field is what its docblock refuses.
			 */
			const escapeFromAnywhere =
				event.key === "Escape" && !event.defaultPrevented;
			if (!mine && !onDocument && !escapeFromAnywhere) return;
			/*
			 * `defaultPrevented` is how a layer INSIDE the pane claims the press first —
			 * Radix's `DismissableLayer` preventDefaults BEFORE it dismisses, from a
			 * CAPTURE-phase listener on the document (`react-dismissable-layer`'s
			 * `handleKeyDown`, `{ capture: true }`), so the bail below is what used to
			 * leave a press eaten by a layer nothing in this pane opens deliberately: the
			 * only dismissable layers here are the TOOLTIPS on the pane's own chrome and
			 * the trigger. When the press came FROM that chrome it is still the pane's to
			 * answer — round 2's D9 measured the first `Escape` after a reader dismissing
			 * a tooltip and the pane staying open. A press from `<body>` that something
			 * else has already claimed stays deferred, and so does anything outside the
			 * pane. If a menu or a select is ever added inside this pane, THIS is the rule
			 * that has to be revisited: its own `Escape` is a press whose target is in
			 * here.
			 */
			if (event.defaultPrevented && !mine) return;
			if (
				event.key === "[" &&
				(event.metaKey || event.ctrlKey) &&
				openChildId
			) {
				event.preventDefault();
				event.stopPropagation();
				back();
				return;
			}
			if (event.key !== "Escape") return;
			event.stopPropagation();
			/*
			 * The reader: leave it, at any depth (`leaveReader`), because Escape is the
			 * TUI's `esc` and that key leaves the MODE rather than stepping up one
			 * level. At the roster there is nothing left to leave, so the pane closes —
			 * the rung that could not fire from the trigger before this binding.
			 */
			if (openChildId) {
				leaveReader();
				return;
			}
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [back, leaveReader, onClose, openChildId]);

	/*
	 * Switching conversations resets the reader (`§ 3.5`). Keyed on the session
	 * identity rather than on a prop of the reader, because the child ids are the
	 * session's and a reader left pointing at one after the session changed would
	 * be reading a conversation that is no longer on screen.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on session change only
	useEffect(() => {
		onReaderChildChange(null);
		setUnopenable(false);
		cachedRow.current = null;
	}, [sessionId]);

	/*
	 * The composer's plan chip, consumed once (`docs/composer-status-tabs.md` § 5.2).
	 *
	 * The chip names a destination INSIDE this pane, so the request is a transient
	 * one in the store that owns the pane's placement, and the pane is what acts on
	 * it: ensure the LIST is showing, bring the plan into view, and retire the
	 * request. It is not a toggle and it must not depend on hidden pane state —
	 * the chip carries no `aria-pressed` for exactly that reason.
	 */
	const revealRequest = useUiPreferencesStore((state) => state.runPanelReveal);
	const clearReveal = useUiPreferencesStore(
		(state) => state.clearRunPanelReveal,
	);
	/*
	 * The sections a reveal request can name, held as one ref each. The LOOKUP is
	 * what the request goes through (below), so a section can be added to
	 * `RunPanelSection` and named here without the effect growing a branch per
	 * section — and a request for a section that is NOT on screen (a plan that left
	 * the wire between the press and this effect, or a chip whose rows settled under
	 * the user's finger) resolves to nothing and is retired, which is the behaviour
	 * this path already had for its one section.
	 */
	const bodyRef = useRef<HTMLDivElement | null>(null);
	const todosSectionRef = useRef<HTMLElement | null>(null);
	const subagentsSectionRef = useRef<HTMLElement | null>(null);
	const jobsSectionRef = useRef<HTMLElement | null>(null);
	const wakesSectionRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!revealRequest) return;
		/*
		 * A reader replaces the body wholesale and the plan is not on screen inside
		 * one, so a reader is left first and the request is held: closing it changes
		 * `openChildId`, this effect runs again on that render, and by then the list
		 * — and the section's ref — are mounted. Retiring the request here instead
		 * would consume it without ever doing what it asked.
		 */
		if (openChildId) {
			onReaderChildChange(null);
			return;
		}
		/*
		 * A `Record` over the union rather than a chain of ternaries, and that is a
		 * correctness property and not a style choice (agent review round 1, m2): as
		 * a chain, the last arm is a catch-all, so a FOURTH member of
		 * `RunPanelSection` would compile and silently scroll the jobs section for a
		 * destination that has no section of its own. Here the omission is a type
		 * error, and the reader can see at a glance that every destination the store
		 * can hold has a section.
		 */
		const sectionRefs: Record<
			RunPanelSection,
			RefObject<HTMLElement | null>
		> = {
			todos: todosSectionRef,
			subagents: subagentsSectionRef,
			jobs: jobsSectionRef,
			wakes: wakesSectionRef,
		};
		const target = sectionRefs[revealRequest.section].current;
		const region = bodyRef.current;
		if (target && region) {
			/*
			 * The REGION moves and nothing else, which is PR #207's subject and the
			 * operator-reported defect it exists to delete: `scrollIntoView` walks
			 * every scrolling ancestor, and in this layout the chat column's slot row
			 * is scrollable at the widths where the pane does not fit beside the
			 * column, so the reveal slid the whole frame — measured at 108px at
			 * 1024x673 and 221px at 800x600 — and this branch adds two more triggers
			 * for it. `scrollRegionToTop` assigns the pane's own `scrollTop` instead
			 * (`shared/lib/scroll.ts` carries the measurements and the reasoning).
			 *
			 * Instant, never smooth: `branding.md` § 5 reserves motion for entrances,
			 * and a pane that animated its own scroll under a reader would move text
			 * they are already looking at. Focus deliberately does NOT move (`§ 9`: a
			 * pane is part of the page, and the user pressing this chip is in the
			 * composer, usually mid-sentence), and an assignment to `scrollTop` takes
			 * no focus with it.
			 *
			 * It CLAMPS like every scroll assignment: when the content below the
			 * target is shorter than the region, the browser stops at the region's own
			 * maximum and the section lands as close to the head as the region allows
			 * (QA round 1's Q1, observed as `scrollTop 447 === maxScroll 447` for the
			 * Jobs chip on a short wire). That is the pane's honest behaviour and the
			 * record states it, rather than claiming every reveal ends at the head.
			 */
			scrollRegionToTop(region, target);
		}
		/*
		 * Retired either way: a request whose section is not in this pane (todos that
		 * left the wire between the press and this effect) has nothing to scroll to,
		 * and holding it would let a later mount of another session's pane act on it.
		 * The nonce is passed rather than cleared unconditionally, so this effect
		 * cannot consume a NEWER request than the one it ran for.
		 */
		clearReveal(revealRequest.nonce);
	}, [revealRequest, openChildId, onReaderChildChange, clearReveal]);

	const siblings = row ? siblingsOf(details.lineage, row) : [];
	const index = row ? siblings.findIndex((entry) => entry.id === row.id) : -1;
	const previous = index > 0 ? siblings[index - 1] : null;
	const next =
		index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
	const children = row ? childrenOf(details.lineage, row) : [];
	/**
	 * The descend control's two strings, and the reason they are derived rather
	 * than typed at the call site: the name says the ACTION and the count (`§ 8`),
	 * the label says the count alone, and `1 children` was one hard-coded plural
	 * in the label of a control whose own tooltip two lines above it agreed with
	 * neither (round 1, U1-6, Q8). Both come off ONE count, so they cannot drift.
	 */
	const childControlName = `Open ${children.length} child subagent${
		children.length === 1 ? "" : "s"
	}`;
	const childControlLabel = `${children.length} child${
		children.length === 1 ? "" : "ren"
	}`;

	return (
		/*
		 * `tabIndex={-1}` so the container can hold focus without entering the tab
		 * order; the ROLE is the canvas's own precedent — a named `region` rather
		 * than a dialog, because this is in-flow content and not a modal the user has
		 * to dismiss before touching anything else. The ladder is NOT bound here: see
		 * the document listener above for why the trigger's focus cannot reach a
		 * handler on this subtree, and `sectionRef` for what the guard tests.
		 */
		<section
			ref={sectionRef}
			/*
			 * The pane's own marker, read by the trigger's close-focus rule
			 * (`run-details-trigger.tsx`) to tell "the pane took the focus with it"
			 * from "the user pressed something else". A data attribute rather than
			 * the `aria-label`, because a name is copy and this is a hook.
			 */
			data-run-panel-pane=""
			aria-label="Run details"
			tabIndex={-1}
			className={cn("flex h-full flex-col bg-surface")}
		>
			{/*
			 * `bg-sunken`, the canvas's ground for this bar and the same 40px, so the
			 * two panes read as one slot with two modes. `shrink-0` because the body
			 * below owns the remaining height and the bar must not lose a pixel of
			 * its declared size to a flex deficit.
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 bg-sunken px-2",
				)}
			>
				<div className={cn("flex min-w-0 items-center gap-1")}>
					{row ? (
						<>
							<Tooltip content="Back">
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Back"
									onClick={back}
								>
									{/*
									 * `ChevronLeft`, not `Undo2`: in this app `Undo2` is the REVERT
									 * glyph (`backend-setting-row.tsx`) and the directional chevron is
									 * what every back affordance uses (`sidebar-navigation`,
									 * `inline-edit`, `compact-pagination`). Left is also the direction
									 * this pane's breadcrumb runs.
									 */}
									<ChevronLeft aria-hidden="true" />
								</Button>
							</Tooltip>
							{/*
							 * The breadcrumb IS the title (`§ 5.2`): the root crumb is the
							 * panel itself — pressing it closes the panel, after one back
							 * from the first level — and each crumb after it is one level of
							 * the lineage. A `<nav>` because it is navigation, and the current
							 * crumb is marked rather than linked.
							 */}
							<nav
								aria-label="Subagent path"
								className={cn(
									"flex min-w-0 items-center gap-1 overflow-hidden",
								)}
							>
								<button
									type="button"
									onClick={onClose}
									className={cn(
										"shrink-0 truncate rounded-sm px-1 text-meta text-ink-muted hover:text-ink",
									)}
								>
									Run details
								</button>
								{/*
								 * The ancestors are CAPPED and the current node takes the rest.
								 *
								 * Both used to be plain `truncate` in one flex row, which starved the
								 * segment that matters: measured in `reader-nested`, the ancestor
								 * took 166px while `Verify t…` got 49px — about eight characters,
								 * the smallest share on the line. `§5.2` makes the breadcrumb the
								 * reader's title (the pane has no visible one), so the current node
								 * is the one that must be legible and the ancestors can shorten to
								 * the leading words that distinguish them. `max-w-32` is the same
								 * cap the roster gives its model segment, for the same reason: a
								 * qualifier shortens before the subject does.
								 *
								 * A CAP is not a guarantee, which is what the shrink terms are for
								 * (review round 2's open residual risk). Capped-but-unshrinkable
								 * ancestors — the first cut of the cap left them `shrink-0` — are
								 * `max-w-32` each, so a lineage of depth 3 costs 3 × 136px before the
								 * current node or the root crumb draws anything: more than the whole
								 * 40px bar at the pane's 320px floor, with the ancestors unable to
								 * give any of it back. Allowing them to shrink (`min-w-0`, no
								 * `shrink-0`) and giving the current node a floor (`min-w-24`, about
								 * fourteen characters at `text-meta`) makes the depth-3 case degrade the way the depth-2 case was designed to:
								 * the ancestors shorten toward their leading words and the title
								 * keeps a legible share at every depth. `reader-deep-floor` is the
								 * frame that proves it at the floor, since no amount of reasoning
								 * about flex is a picture.
								 */}
								{path.map((crumb, crumbIndex) => {
									const current = crumbIndex === path.length - 1;
									return (
										<span
											key={crumb.id}
											className={cn(
												"flex items-baseline gap-1",
												current ? "min-w-24 flex-1" : "max-w-32 min-w-0",
											)}
										>
											<span aria-hidden="true" className={cn("text-ink-dim")}>
												/
											</span>
											<button
												type="button"
												aria-current={current ? "page" : undefined}
												onClick={() => openChild(crumb.id)}
												className={cn(
													"truncate rounded-sm px-1 text-meta",
													current
														? "min-w-0 flex-1 text-left text-ink"
														: "min-w-0 text-ink-muted hover:text-ink",
												)}
												title={crumb.label}
											>
												{crumb.label}
											</button>
										</span>
									);
								})}
							</nav>
						</>
					) : (
						<span className={cn("px-1 text-meta text-ink-dim")}>
							Run details
						</span>
					)}
				</div>
				<div className={cn("flex shrink-0 items-center gap-0.5")}>
					{row && (
						<>
							{children.length > 0 && (
								/*
								 * The descend control (`§ 5.5`), named for the count rather than with
								 * an arrow, because an unlabelled chevron beside the peer stepper is
								 * three arrows with two meanings.
								 *
								 * Both strings are derived from ONE count: the accessibible name says
								 * the action and the count (`Open 1 child subagent`, `§ 8`), and the
								 * visible label says the count alone, pluralised. The label on its own
								 * read `1 children` and carried no name the action could be heard in
								 * (round 1, U1-6 and Q8).
								 */
								<Tooltip content={childControlName}>
									<Button
										variant="ghost"
										size="sm"
										className={cn("text-meta text-ink-muted")}
										aria-label={childControlName}
										onClick={() => openChild(children[0].id)}
									>
										{childControlLabel}
									</Button>
								</Tooltip>
							)}
							{siblings.length > 1 && (
								<>
									<Tooltip content="Previous subagent">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Previous subagent"
											disabled={!previous}
											onClick={() => previous && openChild(previous.id)}
										>
											<ChevronLeft aria-hidden="true" />
										</Button>
									</Tooltip>
									<Tooltip content="Next subagent">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Next subagent"
											disabled={!next}
											onClick={() => next && openChild(next.id)}
										>
											<ChevronRight aria-hidden="true" />
										</Button>
									</Tooltip>
								</>
							)}
						</>
					)}
					<Tooltip content="Close run details">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Close run details"
							onClick={onClose}
							data-tour-tag="close-run-panel-button"
						>
							<PanelRightClose aria-hidden="true" />
						</Button>
					</Tooltip>
				</div>
			</div>

			{row ? (
				<RunChildReader
					/*
					 * Keyed by the child so a hop REPLACES the reader rather than
					 * re-rendering it in place: the body, the scroll position and the
					 * brief's expander all belong to one child (`§ 11`, risk 7 — the TUI
					 * resets the scroll only on a new job, and the same rule has to hold
					 * here or a reader lands mid-transcript).
					 */
					key={row.id}
					row={row}
					sessionId={sessionId}
					/*
					 * The child-scoped attachment scope, gated on the SAME capability the
					 * transcript route negotiated under: this reader's page is read over
					 * `subagents.transcript`, its images come from that route family's
					 * attachment twin, and a backend that advertises one and not the other
					 * does not exist. `childrenOpenable` is false without the capability, and
					 * a null scope leaves a digest row on the honest unavailable note rather
					 * than issuing a request on faith.
					 */
					attachmentScope={
						childrenOpenable && sessionId && row.childSessionId
							? { sessionId, childId: row.childSessionId }
							: null
					}
					pulse={pulses[row.id] ?? 0}
					live={isOpenChildStatus(row.status)}
					/*
					 * The reader's clock anchors (`useChildRowClock`): the instants THIS model
					 * was measured at, so the header's elapsed ticks from the same pinned
					 * clock the roster's rows do — a running child's page used to sit on the
					 * label the wire last published while the roster beside it ticked
					 * (round 1, Q3).
					 */
					measuredAtMs={details.measuredAtMs}
					measuredAtRealMs={details.measuredAtRealMs}
					previewPage={previewPage}
					onUnopenable={() => {
						onReaderChildChange(null);
						setUnopenable(true);
					}}
				/>
			) : (
				/*
				 * The scroll owner, and NO tab stop of its own.
				 *
				 * Every row inside it is a real button, so the region is reachable and
				 * operable by keyboard through its own content, and the Escape ladder
				 * binds on the section above: focusing a row puts the ladder in reach. A
				 * bare `tabIndex` here would add a stop that announces a container and
				 * does nothing when it is pressed — the transcript's own scroller needs
				 * one because it pages on keydown, and this one does not page at all.
				 */
				<div
					ref={bodyRef}
					className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain")}
				>
					{/*
					 * `§ 10.5`'s one quiet line, and its ACTION. A lit row that opens
					 * nothing is worse than a quiet one, and a state whose explanation is
					 * missing is the "not a hidden failure" half of that section — so the
					 * line names the situation and offers the same remedy the app's other
					 * gated surfaces offer: the updater, when this build has one, plus the
					 * capability re-read for the case where the backend came up since.
					 *
					 * The two controls are the compatibility banner's own, with the same
					 * labels and the same `window.api.updater.updateBackend` call rather
					 * than a second update path — a second path is a second place for the
					 * confirmation, the failure copy and the restart advice to be wrong.
					 */}
					{!childrenOpenable && details.subagents.length > 0 && (
						<div
							className={cn(
								"flex flex-col gap-2 px-3 pt-2 pb-1 text-meta text-ink-muted",
							)}
						>
							<p>
								Opening a subagent's conversation needs a newer Local Operator
								backend. Update the backend and restart the app.
							</p>
							<div className={cn("flex items-center gap-2")}>
								{canUpdateBackend && (
									<Button
										variant="secondary"
										size="sm"
										disabled={updatingBackend}
										onClick={updateBackend}
									>
										{updatingBackend ? "Updating" : "Update backend"}
									</Button>
								)}
								<Button variant="outline" size="sm" onClick={retryCapabilities}>
									{/*
									 * `outline`, not `ghost`: the ghost variant has no ground and no
									 * border at rest, so this remedy rendered as the bare word `Retry`
									 * three pixels under the sentence it answers — reading as a label
									 * rather than as the one thing to press. `outline` is the variant
									 * that exists for "a secondary action on a quiet surface" and it
									 * carries the `border-control` floor, so the action reads as an
									 * action beside `Update backend` without competing with it.
									 */}
									Retry
								</Button>
								{updateBackendError && (
									<span className={cn("text-danger")}>
										{updateBackendError}
									</span>
								)}
							</div>
						</div>
					)}
					{unopenable && (
						<p className={cn("px-3 pt-2 text-meta text-ink-muted")}>
							That subagent's conversation could not be opened.
						</p>
					)}
					<RunDetailsPanel
						details={details}
						mcpServers={mcpServers}
						mcpGrantRunning={mcpGrantRunning}
						mcpRemedy={mcpRemedy}
						childrenOpenable={childrenOpenable}
						onOpenChild={openChild}
						rosterExpanded={rosterExpanded}
						onToggleRosterExpanded={() => setRosterExpanded(true)}
						paneWidth={paneWidth}
						todosSectionRef={todosSectionRef}
						subagentsSectionRef={subagentsSectionRef}
						jobsSectionRef={jobsSectionRef}
						wakesSectionRef={wakesSectionRef}
					/>
				</div>
			)}
		</section>
	);
};
