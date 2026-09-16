/**
 * The header trigger for the run panel (`docs/run-sidebar.md` § 3.3, § 3.4).
 *
 * **An always-on toggle.** It renders whenever the session has a model at all
 * (`details !== null`) and it no longer knows anything about the canvas, because
 * the two panes are mutually exclusive by CONSTRUCTION in the store now: opening
 * either clears the other. The old rule (`hasRunDetails && !isCanvasOpen`) was a
 * work gate and a canvas gate on a control that opened a transient popover; with
 * the panel in the right pane neither applies — the button is the way to the
 * pane, and it has to stay reachable while the pane is open, which is what makes
 * this a toggle rather than a one-way door.
 *
 * What still gates it is a DATA fact, not a work fact: with no canonical session
 * there is no `frontend` to derive from, so there is no session identity and no
 * `jobs`/`todos` stream to show. `chat-page.tsx` passes `null` on that path and
 * a legacy chat grows no button — exactly as it did before.
 *
 * **Icon: `Info`, not `Activity`.** The old glyph was a heartbeat, and a
 * heartbeat says *liveness* — the one thing this pane is not: it holds a
 * roster, a plan and the servers the session is connected to, and nothing in it
 * pulses. `Info` is this app's own word for "there is more to read here": it is
 * the mark on the transcript's info notice
 * (`canonical/canonical-transcript.tsx:476`), on the error block's information
 * line (`message-item/error-block.tsx:112`), and on the settings rows that open
 * a section (`generation-settings-section.tsx:94`,
 * `model-hosting-section.tsx:83`). It is also the one candidate that collides
 * with nothing: the table in `trace/tool-glyphs.ts:54-79` is the tool glyphs,
 * `CircleHelp` is the roster's own mark for a child whose state is unknown
 * (`run-detail-row-parts.tsx:51`), the four squares are the plan's state marks
 * (`run-detail-todos.tsx:34-39`), `FileText` is the canvas button beside this
 * one (`chat-header.tsx:212`), and `PanelRight`/`PanelRightClose` are the
 * pane's own close control in its chrome bar (`run-panel.tsx:628`) — an open
 * glyph one small arrow away from a close glyph, on screen at the same time as
 * the close control, is the one pairing worse than the heartbeat was.
 *
 * **No count badge.** A badge that ticks from 2 to 3 draws the eye to something
 * the user is not going to act on, and the counts are the first thing the
 * tooltip already says.
 *
 * **Two indications, and they are distinguished by INK rather than by shape.**
 * The dot is one 8px mark in one position, and what it is saying is which of two
 * facts it carries: `danger` for the failure ledger (§ 3.4's "something needs your
 * attention and you have not looked"), and `info` for live activity the panel is
 * not currently showing — subagents that are running while the pane is closed or
 * showing a reader. That is not a second ledger: it holds no state, has no
 * `seen`-set, and is true whenever there is an open child and no list on screen
 * to say so, which is exactly the `listOnScreen` gate the failure ledger already
 * reads. `docs/run-sidebar.md` § 3.4 and `docs/composer-activity-chips.md` § 5
 * carry the argument; the shape stays one dot because a second mark on a 32px
 * control is a decoration nobody can read, and the two meanings are one question
 * — "is there something in the pane I should look at".
 */

import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type McpServerRow,
	type RunDetails,
	acknowledgeMcpWhileShown,
	acknowledgeWhileOpen,
	hasUnseenFailure,
	hasUnseenMcpProblem,
	onScreenFailures,
	runDetailTriggerLabel,
	unseenMcpProblems,
} from "./run-detail-model";

export type RunDetailsTriggerProps = {
	/** The derived view model, or `null` when the session has none. */
	details: RunDetails | null;
	/**
	 * The MCP servers the panel will render, for the attention dot's second ledger.
	 *
	 * Passed in rather than fetched here so the trigger and the panel cannot
	 * disagree about which rows exist: the panel owns that read (§ 3.4's "the
	 * rendered slice"), and a trigger with its own copy could acknowledge a row the
	 * panel never drew. An EMPTY list is what the caller passes when the MCP section
	 * is not rendered at all — no capability, or no configured servers — and that is
	 * deliberate: a section that is not on screen must not acknowledge anything.
	 */
	mcpServers: readonly McpServerRow[];
	/**
	 * Whether the pane is currently showing the LIST (roster, plan, MCP rows).
	 *
	 * The acknowledgement needs to know which view the pane is showing, and this is
	 * the half that matters: a reader replaces the panel's body wholesale, so with a
	 * reader open neither the roster's rows nor the MCP section is rendered, and
	 * acknowledging on "the panel is open" alone marks a failure or a dropped server
	 * as seen at the moment it lands behind a reader the user is reading.
	 */
	listOnScreen: boolean;
	/**
	 * The child whose reader is open, or `null`.
	 *
	 * The reader's own child's outcome IS the page — § 5.7's "the row is on screen"
	 * in the other direction — so that one child is acknowledged while its reader is
	 * open, and no ancestor is: a breadcrumb names ancestors without showing their
	 * outcomes.
	 */
	readerChildId: string | null;
};

export const RunDetailsTrigger = ({
	details,
	mcpServers,
	listOnScreen,
	readerChildId,
}: RunDetailsTriggerProps) => {
	const isRunPanelOpen = useUiPreferencesStore((state) => state.isRunPanelOpen);
	const setRunPanelOpen = useUiPreferencesStore(
		(state) => state.setRunPanelOpen,
	);
	const triggerRef = useRef<HTMLButtonElement>(null);
	/*
	 * CLOSING RETURNS FOCUS HERE (`§ 3.5`, `§ 9`; round 1, U1-2/Q5).
	 *
	 * The trigger is what opens the pane, so it is where a keyboard user's place
	 * is once the pane is gone — and without this the ✕ left focus on `<body>`:
	 * the button the press landed on unmounts with the pane, and the browser drops
	 * focus rather than restoring it. `Escape` bound where this button's focus can
	 * reach (the pane's document listener) fixes the same finding's other half.
	 *
	 * The refocus is CONDITIONAL, and the condition is the whole reason this is a
	 * reader-worthy four lines: only a close that TOOK the focus does the trigger
	 * claim it back. Focus on `<body>` is the signature of a control that
	 * unmounted under the pointer, and focus inside the pane is a close driven
	 * from the pane's own keys; focus anywhere else means the user pressed
	 * something else on the way here (the canvas button that swaps the slot), and
	 * yanking it back to this button would undo their own click.
	 */
	const wasOpen = useRef(isRunPanelOpen);
	useEffect(() => {
		const was = wasOpen.current;
		wasOpen.current = isRunPanelOpen;
		if (!was || isRunPanelOpen) return;
		const active = document.activeElement;
		const lostInPane =
			active === null ||
			active === document.body ||
			(active instanceof Element &&
				active.closest("[data-run-panel-pane]") !== null);
		if (lostInPane) triggerRef.current?.focus();
	}, [isRunPanelOpen]);

	/*
	 * The two acknowledgement ledgers, both owned here because this is the surface
	 * the dot lives on.
	 *
	 * ONE DOT, TWO LEDGERS. A failed child and a broken MCP server are different
	 * facts with the same claim — "something needs your attention and you have not
	 * looked" — and one 8px dot cannot say which. It does not have to: pressing the
	 * button is the only action the dot offers, and the panel that opens names both
	 * facts in its own sections. Two dots on one 32px control would be a
	 * decoration nobody can read, and a numeric badge is refused above.
	 *
	 * They keep SEPARATE sets rather than one, because a job id and a server name
	 * are both strings in the same shape: `SeenFailures`/`SeenMcpProblems` are
	 * separate values of one type so neither ledger can acknowledge the other's
	 * rows (`run-detail-model.ts`).
	 */
	const [seen, setSeen] = useState<ReadonlySet<string>>(
		() => new Set<string>(),
	);
	const [seenMcp, setSeenMcp] = useState<ReadonlySet<string>>(
		() => new Set<string>(),
	);

	/*
	 * `§ 3.4`: while the pane is showing the LIST, every failed child whose row is
	 * in the rendered slice — and every problem server the section renders — is
	 * acknowledged, continuously. While it is closed, nothing is; while it is
	 * showing a READER, nothing is except the child that reader is showing.
	 *
	 * Written during RENDER rather than in an effect, which is the one thing here
	 * worth reading twice. An effect runs after paint, so a failure arriving while
	 * the list is shown would light the dot for a frame and then clear it — a
	 * visible flicker whose cause is not on screen. Updating state during render of
	 * the same component is React's documented pattern for exactly this (derived
	 * state that must be current before the paint), and both acknowledgements hand
	 * back the SAME set when they add nothing, so the ordinary render — nothing new,
	 * pane closed — is a no-op that does not re-render at all.
	 */
	if (details && listOnScreen) {
		const next = acknowledgeWhileOpen(onScreenFailures(details), seen);
		if (next !== seen) setSeen(next);
	}
	/*
	 * The reader's own child, on its own: its outcome is the page being read. Only
	 * that one id — the breadcrumb's ancestors are named, not shown.
	 */
	if (readerChildId) {
		const next = acknowledgeWhileOpen([readerChildId], seen);
		if (next !== seen) setSeen(next);
	}
	if (listOnScreen) {
		/*
		 * The MCP ledger's own rule, and its own set: `prune, then union` (§ 7.3),
		 * so a server acknowledged while broken and later repaired can announce
		 * itself again instead of staying silent forever.
		 */
		const nextMcp = acknowledgeMcpWhileShown(mcpServers, seenMcp);
		if (nextMcp !== seenMcp) setSeenMcp(nextMcp);
	}

	const mcpProblems = unseenMcpProblems(mcpServers, seenMcp).length;
	const label = runDetailTriggerLabel(details, seen, {
		open: isRunPanelOpen,
		mcpProblems,
	});
	const attention =
		(details ? hasUnseenFailure(details, seen) : false) ||
		hasUnseenMcpProblem(mcpServers, seenMcp);
	/*
	 * The activity term, and it is live state rather than a third ledger: the
	 * question is "is something running that this pane is not showing you", asked
	 * of the derived model at render time. The whole gate is `!listOnScreen` — the
	 * same term the failure ledger uses two paragraphs up — so the dot goes out the
	 * moment the pane paints the list, with nothing to acknowledge and nothing to
	 * remember. A `seen`-set here would be a copy of state that already exists, and
	 * it would go stale the moment a child settled without the user looking.
	 *
	 * SUBAGENTS only, never jobs, and that asymmetry is deliberate: a background
	 * `eval` may legitimately run for hours, so a jobs-driven dot would mean "a long
	 * job exists" on a session nobody has touched since yesterday, while a running
	 * child means "something is happening now". The jobs count still reaches the
	 * user — through the tooltip above and the composer's chips below — and a dot
	 * that is always lit is a dot nobody reads.
	 */
	const activity =
		details !== null && !listOnScreen && details.openChildren > 0;

	/*
	 * `details === null` is the legacy path: no canonical session, so no session
	 * identity and no roster to show. The button is absent there rather than
	 * disabled — a disabled control for a surface the session cannot have is
	 * chrome that explains nothing.
	 */
	if (!details) return null;

	return (
		<Tooltip content={label} side="top">
			<Button
				ref={triggerRef}
				variant="ghost"
				size="icon"
				/*
				 * `relative` for the attention dot only; the cluster's geometry is
				 * unchanged.
				 *
				 * `aria-pressed` with an explicit pressed GROUND, and its own HOVER
				 * ground beside it. The ghost variant's hover is already
				 * `bg-accent-wash`, which made "a pointer resting on this button" and
				 * "this pane is open" the same pixels — the press was legible only
				 * from the glyph's ink, so the wash could not mean "open" and nothing
				 * else. Hover therefore takes the NEUTRAL ground step the roster rows
				 * already use (`bg-elevated`), and `accent-wash` + `text-accent` is
				 * left to mean the pressed state alone. `text-accent` rides with the
				 * wash because the wash alone is a tint at 4.5:1-ish over the header's
				 * ground, where the accent ink is the pair the token set is authored
				 * for; the hover steps the ink to full `ink` for the same reason on the
				 * neutral ground.
				 *
				 * `hover:text-accent` is overridden in the pressed branch so that a
				 * pointer resting on the OPEN button keeps the pressed ink rather than
				 * stepping to `ink` — and `hover:bg-accent-wash` is overridden beside it
				 * for the same reason, which is the half that was missing first time
				 * (design review round 2, D2-1). Overriding only the ink left the
				 * PRESSED GROUND to `hover:bg-elevated`: the wash meant "open" at rest
				 * and "a pointer is here" under hover, so the ordinary gesture of
				 * opening the pane replaced the state's own ground the moment the
				 * pointer stayed where it was. Both halves of the pressed appearance
				 * now survive hover, so the four states are four grounds — `canvas`
				 * closed at rest, `elevated` closed hovered, `accent-wash` open, and
				 * `accent-wash` open hovered, which is the point rather than a
				 * collision.
				 */
				className={cn(
					"relative hover:bg-elevated hover:text-ink",
					isRunPanelOpen &&
						"bg-accent-wash text-accent hover:bg-accent-wash hover:text-accent",
				)}
				aria-pressed={isRunPanelOpen}
				aria-label={label}
				onClick={() => setRunPanelOpen(!isRunPanelOpen)}
				/*
				 * Inert hook for the stories and for whatever drives this next. The
				 * label is derived — it carries counts and flips with the pane — so it
				 * is the wrong thing to select on, and an element a capture rig cannot
				 * find is an element it photographs shut.
				 */
				data-run-panel-trigger=""
			>
				<Info aria-hidden={true} />
				{(attention || activity) && (
					/*
					 * A single 8px dot at the button's top-right corner, in one of two inks
					 * (the docblock above says which and why). It is not decoration and it is
					 * not a count: `danger` says something needs attention and nobody has
					 * looked (§ 3.4); `info` says the session is working while the pane is not
					 * showing it. Both clear by themselves — the failure ledger clears while
					 * the panel is open, the activity ink clears the moment the list is on
					 * screen. `rounded-full` is reserved for avatars, status dots and pill
					 * badges, which is exactly what this is.
					 *
					 * `aria-hidden`, and no clause is added to the accessible name for the
					 * activity case: the label ALREADY carries the child clause whenever there
					 * is an open child (`runDetailTriggerLabel`, which spells the state the
					 * mark shows — `running`, `queued` or `paused`), so a spoken word here
					 * would be the same fact twice — while the failure case has no such clause
					 * and is precisely why the dot is the only statement that one makes.
					 */
					<span
						aria-hidden={true}
						data-run-panel-dot=""
						className={cn(
							"absolute -top-0.5 -right-0.5 size-2 rounded-full",
							attention ? "bg-danger" : "bg-info",
						)}
					/>
				)}
			</Button>
		</Tooltip>
	);
};
