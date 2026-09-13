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
 * **Icon: `Activity`, unchanged.** `Users` and `ListChecks` already mean a
 * specific tool in this app (`trace/tool-glyphs.ts:54-79`) and a header button
 * wearing one would read as that tool rather than as the view over both.
 *
 * **No count badge.** A badge that ticks from 2 to 3 draws the eye to something
 * the user is not going to act on, and the counts are the first thing the
 * tooltip already says.
 *
 * The one indication it does carry is the failure dot, whose rule changed with
 * the surface: see `§ 3.4` and the two ledgers below.
 */

import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Activity } from "lucide-react";
import { useState } from "react";
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
	 * `details === null` is the legacy path: no canonical session, so no session
	 * identity and no roster to show. The button is absent there rather than
	 * disabled — a disabled control for a surface the session cannot have is
	 * chrome that explains nothing.
	 */
	if (!details) return null;

	return (
		<Tooltip content={label} side="top">
			<Button
				variant="ghost"
				size="icon"
				/*
				 * `relative` for the attention dot only; the cluster's geometry is
				 * unchanged.
				 *
				 * `aria-pressed` with an explicit pressed GROUND, because the ghost
				 * variant's hover is already `bg-accent-wash` (`button.tsx`): without
				 * an override the pressed state would be indistinguishable from a
				 * pointer resting on the button, and the accent is exactly what this
				 * system spends on an active state. `text-accent` rides with the wash
				 * because the wash alone is a tint at 4.5:1-ish over the header's
				 * ground, where the accent ink is the pair the token set is authored
				 * for.
				 */
				className={cn(
					"relative",
					isRunPanelOpen && "bg-accent-wash text-accent hover:text-accent",
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
				<Activity aria-hidden={true} />
				{attention && (
					/*
					 * A single 8px `danger` dot at the button's top-right corner. It is
					 * not decoration and it is not a count: it says something needs
					 * attention and nobody has looked (§ 3.4), and it clears while the
					 * panel is open. `rounded-full` is reserved for avatars, status dots
					 * and pill badges, which is exactly what this is.
					 */
					<span
						aria-hidden={true}
						className={cn(
							"absolute -top-0.5 -right-0.5 size-2 rounded-full bg-danger",
						)}
					/>
				)}
			</Button>
		</Tooltip>
	);
};
