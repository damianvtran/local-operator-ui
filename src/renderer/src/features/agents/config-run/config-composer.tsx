/**
 * The conversational configuration surface: the composer, the run strip, and the
 * settled summary.
 *
 * THE BOX IS THE APP'S OWN COMPOSER, AND THAT IS THE BRIEF THIS FILE NOW KEEPS.
 * `docs/design/agents-inplace-shared-composer.md` (§1.5) supersedes the older
 * "must never read as one: no slash dispatch, no attachments, no draft store"
 * prohibition this header used to carry. What survives from it is the part that
 * was ever the point:
 *
 *  - the SEND PATH is unchanged — `sessions.create{purpose}` + `sessions.message`
 *    on the RUN's id, through `desktopResult` directly, so the run never becomes a
 *    canonical session row;
 *  - NOTHING TYPED HERE ENTERS THE MAIN CONVERSATION, and the box says so in one
 *    standing line — "Runs in the background. This does not appear in your
 *    conversation." — which is a permanent node the box itself describes itself
 *    with, not a placeholder;
 *  - NO ROUTE CHANGE: there is nowhere for this text to navigate to.
 *
 * What is retired is the CONTROL-SURFACE prohibition: `MessageInput` is mounted
 * here, with speech, attachments and the model/effort readings. The two command
 * write paths stay closed by PROPS rather than by the box being different — no
 * `onSlashCommand` and no `mentionsEnabled`, so `slash.available &&
 * Boolean(onSlashCommand)` is false and the picker registry is unreachable — and
 * the send carries its attachments to the wire rather than dropping them.
 *
 * NAMING (frozen across the sibling changes): a **configuration run**. Never
 * "aside", "btw" or "subagent" — the aside is an off-record model-only question
 * asked inside an open conversation, and a subagent is a child of one. This is a
 * supervised background session that WRITES the agent and team registries.
 *
 * THE STRIP IS A LIVE REGION AND NOT A SPINNER. Its state dot, its one-line step
 * and its elapsed time are the whole of the progress vocabulary: there is no
 * percentage to show and inventing one is the fake-progress failure branding §7
 * names. `Watch` opens the run's own tool rows, which is the same level of detail
 * the subagent reader shows per child.
 */

import {
	CHAT_COLUMN_CONTAINER,
	CHAT_COLUMN_INSET,
	CHAT_MEASURE,
} from "@features/chat/chat-measure";
import { draftPreviewQuery } from "@features/chat/draft-selection";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	MessageInput,
	type MessageInputHandle,
	type MessageInputProps,
} from "@shared/components/composer";
import { Button } from "@shared/components/ui/button";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ConfigRunHandle } from "./use-config-run";

/**
 * Nothing above this box is a transcript.
 *
 * THE RUN'S SURFACE IS ITS OWN STRIP, NOT A CONVERSATION (B1, §3.1): the activity
 * rows, the Watch disclosure, Stop and the settled summary all render above the
 * box, and the composer must not claim them as messages. An empty list is what a
 * mount with no transcript passes, and `transcriptless` below keeps the chat's
 * empty-pane splash off the page.
 */
const EMPTY_MESSAGES: MessageInputProps["messages"] = [];

/**
 * The id the aside sentence carries, so the box can name it in
 * `aria-describedby` (the host-notice slot hands both halves over together).
 */
const ASIDE_NOTICE_ID = "config-composer-note";

/**
 * THE BOX'S OWN LINE FOR THE DISABLED GATE (design review round 3, D9 = UX review
 * round 3, U1), shared by the two slots that can carry it.
 *
 * It DESCRIBES the surface rather than asking for a press, because the box refuses
 * every keystroke in this state — and it is deliberately NOT `run.disabledReason`:
 * the notice band is that sentence's single carrier (round 2, D7), so repeating it
 * here would put the same 66-character sentence on the card twice, 8 px apart.
 */
const DISABLED_GATE_LINE = "Configure agents by conversation";

/** Three things an operator actually asks for, as one-press examples. */
const EXAMPLES = [
	"A reviewer that only reads code",
	"Add the coder twice to release-crew",
	"A team called shipping with a manager and two coders",
];

const STATE_DOT: Record<string, string> = {
	idle: "bg-ink-dim",
	running: "bg-accent",
	stopping: "bg-warning",
	done: "bg-success",
	stopped: "bg-ink-muted",
	error: "bg-danger",
};

function StateDot({ status, pulse }: { status: string; pulse: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 shrink-0 rounded-full",
				STATE_DOT[status] ?? "bg-ink-dim",
				// Motion is a colour-adjacent signal here, never a transform: nothing
				// lifts or scales on this page, and a pulsing dot is the one animation
				// that carries meaning (work is happening).
				pulse && "animate-pulse",
			)}
		/>
	);
}

/**
 * The run's own steps, one line each, newest last.
 *
 * NO SCROLLER OF ITS OWN (it was `max-h-48 overflow-y-auto`): the whole detail
 * block is bounded and scrolls once (`DetailRegion`), and a list that scrolls
 * inside a block that scrolls is two wheel traps for one gesture. The 192 px it
 * used to allow is more than the block's cap at every window height this app
 * runs at, so it could never have scrolled on its own anyway.
 */
function RunActivity({ run }: { run: ConfigRunHandle }) {
	if (run.activity.length === 0) {
		return (
			<p className="text-meta text-ink-muted">
				Nothing to show yet — the run has not called a tool.
			</p>
		);
	}
	return (
		<ul className="space-y-1">
			{run.activity.map((row, index) => (
				<li
					// The row's own instant is its identity: a run may call the same tool
					// on the same target twice, and an index-only key would mis-reconcile.
					key={`${row.ts}:${row.verb}:${index}`}
					className="flex items-baseline gap-2 text-body-sm"
				>
					<span className="text-ink-dim tabular-nums">
						{new Date(row.ts).toLocaleTimeString([], {
							hour: "2-digit",
							minute: "2-digit",
						})}
					</span>
					<span className="text-ink">{row.verb}</span>
				</li>
			))}
		</ul>
	);
}

/**
 * THE ROW'S TRAILING GHOST BUTTON IS PULLED OUT BY ITS OWN PADDING (design review
 * round 1 D1). A ghost button has no edge, so its box was flush with the column
 * while its label ended 8 px inside it, and the bordered Stop and the box itself
 * were on the edge. `-mr-2` is the `sm` button's `px-2`: the hover ground moves
 * into the 24 px gutter (nothing there clips it - the dock has no overflow), and
 * the glyph lands on the column edge.
 */
const TRAILING_GHOST = "-mr-2";

/**
 * THE BOUND ON EVERYTHING THAT MAY GROW THE DOCK (agent review round 1 #1 =
 * design review D3).
 *
 * The status row is fixed at 28 px, and the block under it is the only part of the
 * dock whose height depends on what a run said: `run.answer` is the run's whole
 * closing message and `run.error` is a provider's own text, so unbounded they put
 * the dock at 1,012 px (a 30-line answer) and the box off screen, with the pane
 * squeezed to 24 px above it. The bound is a fraction of the WINDOW's height
 * because the budget is the window's: 10vh, floored at 3.5rem so a very short window
 * still shows a few lines and capped at 5.5rem so a tall one does not hand the dock
 * back to the run.
 *
 * What the bound does and does not promise (QA round 2, Q2). With an EMPTY box, the
 * WORST dock - this block full plus Retry's row, the only control that lives
 * beneath it - measured 278.5 px (38%) at 1024x725 and 266 px (44%) at the app's
 * 800x600 minimum. That is the whole claim: the bound caps THIS block only. The
 * box beneath it has its own, older max height, so a draft of 20 lines under the
 * same error measured 356.5 px (49%) at 1024x725 and 344 px (57%) at 800x600; the
 * dock is the sum of the two caps, and what holds there is that the last block of
 * the pane stays reachable by scrolling, not that the dock stays under a share of
 * the window. Measured in the round-2 evidence, not derived here.
 *
 * The block scrolls ITSELF rather than clamping text behind a "Show all": an error
 * must stay readable in full, and a clamp would need a second control on a row
 * that is already the densest in the page. It is a keyboard stop only while it
 * actually overflows (`useOverflowing`), so a short sentence does not add a Tab
 * stop that does nothing.
 */
const DETAIL_BOUND = "max-h-[clamp(3.5rem,10vh,5.5rem)]";

/**
 * Whether an element's content is taller than its box, kept current as the
 * element resizes. The block above changes size when the window does, when Watch
 * opens and when a run settles, and a stale answer here would either hide the only
 * way to the overflowing text (no tab stop) or leave a stop with nothing to
 * scroll. The observer is on the BOX: content growing past a box that is already
 * at its cap changes nothing the flag would not already say.
 */
function useOverflowing<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [overflowing, setOverflowing] = useState(false);
	/*
	 * NO DEPENDENCY ARRAY, ON PURPOSE: the box can stay the same size while its
	 * CHILDREN change (a settled summary replacing the live step, an error arriving
	 * in a block that was already at its cap), and a ResizeObserver on the box says
	 * nothing about that. Re-running after every render re-measures through
	 * `measure()` below, which is the only thing that sees it; rebuilding the observer
	 * is the cost, and it cannot loop because the setter bails out on an unchanged
	 * boolean (agent review round 2, nit 3).
	 */
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () =>
			setOverflowing(element.scrollHeight > element.clientHeight + 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	});
	return { ref, overflowing };
}

/**
 * The dock's detail block: bounded, and a named, focusable region only while it
 * actually overflows.
 *
 * ONE SCROLL CONTEXT FOR ALL OF IT (attached notice, refused stop, Watch, the
 * settled summary or the error text), not one per part: the parts can co-occur (a
 * refused stop above an open Watch), and a bound per part would add up to the
 * unbounded dock again. NOTHING FOCUSABLE LIVES INSIDE IT: an `overflow` box clips
 * an outline at its padding edge, and Retry (the one control that used to sit in
 * this block) is rendered BENEATH it for that reason - measured, at the cap it was
 * a 12 px sliver under the clip that a pointer user had to scroll to find.
 *
 * A scroller no key can reach is the failure the pane's own `ReadBlock` rule
 * exists to avoid, and its content is text, so without a tab stop a keyboard user
 * could not read past the cap. It is NOT a stop when everything fits, so a short
 * sentence adds no inert Tab stop.
 *
 * `empty:hidden` because a running run with nothing to say yet renders this with
 * no children, and its 8 px margin would otherwise add 4 px to the dock over idle
 * (measured: 166 -> 170).
 */
function DetailRegion({ children }: { children: ReactNode }) {
	const { ref, overflowing } = useOverflowing<HTMLDivElement>();
	return (
		<div
			ref={ref}
			tabIndex={overflowing ? 0 : undefined}
			role={overflowing ? "region" : undefined}
			aria-label={overflowing ? "Run details" : undefined}
			/*
			 * THE BOUND CUTS TEXT, SO IT SAYS SO (design review round 2 D2): measured,
			 * 72.5 px of a 1,133 px answer sliced a line through its glyphs with only a
			 * faint thumb to say more follows. `data-lo-region-cue` is the 12 px fade
			 * `index.css` draws while the region is not scrolled to its end; it is a
			 * pseudo-element, not a mask, because a mask would clip the focus ring.
			 */
			data-lo-region-cue={overflowing ? "" : undefined}
			className={cn("mb-2 overflow-y-auto empty:hidden", DETAIL_BOUND)}
		>
			{children}
		</div>
	);
}

/**
 * THE STATUS ROW: one 28 px line above the box, in every state.
 *
 * It replaces three things that were each a frame of their own — the bordered card
 * the whole composer sat in, the absolutely-positioned strip card floating over the
 * detail pane, and the `Badge`s inside them (design spec D1: the dock was 287 px of
 * a 725 px window, 177 px of which was not the input). What is left is the box
 * (the only object with a ground and a radius) and this row, which says in order of
 * priority what the run is doing, what the next request is about, or — at rest —
 * what the box is for.
 *
 * WHY ONE FIXED HEIGHT. `min-h-7` is the `size="sm"` button height, so a row that
 * swaps a sentence for Stop and Dismiss never changes height, and the box beneath
 * it never moves under the caret (the original D4). Only the error and
 * stop-refused text, which are rare and caused by the operator's own action, are
 * allowed to grow the block, and they grow it BELOW the row so the row itself keeps
 * its place.
 *
 * LEFT SIDE PRIORITY: run > about > sentence. The right side is decided
 * separately: the about label and its Clear stay while a run is live (the next
 * request is still about that row), and Watch / Stop / Dismiss sit after them, so
 * Stop is never the control that is hidden.
 *
 * THE SENTENCE IS NEVER REMOVED FROM THE DOM. The box names it in
 * `aria-describedby`, and the design brief calls it a permanent node (U4); while a
 * run owns the left side it is `sr-only` rather than unmounted, so the reference
 * cannot dangle and a screen reader still reads the standing promise.
 *
 * The run's own testid is set only while a run is showing, because the e2e drivers
 * wait on its appearance as the signal that a run exists.
 */
const STATUS_ROW = "mb-1 flex min-h-7 items-center gap-3";

/** "1 definition" / "N definitions" - the count of rows a run touched. */
const definitionsPhrase = (count: number) =>
	count === 1 ? "1 definition" : `${count} definitions`;

function ComposerStatus({
	run,
	about,
	blockedReason,
	hasDraft,
	onClearAbout,
	onDismiss,
}: {
	run: ConfigRunHandle;
	/**
	 * Why the page is refusing input, and whether the box holds a draft. TOGETHER
	 * they pick the one carrier that SAYS it on screen (agent review round 2, #1):
	 * an empty box says it as its placeholder; a draft hides the placeholder, so the
	 * row says it (idle strip) or a line under the row does (a run strip owns the
	 * row). `MessageInput` stands its own copy down for a draft (`statedByNode`) on
	 * the strength of that guarantee, so every branch below that is reached with a
	 * draft must render the sentence VISIBLY.
	 */
	blockedReason?: string | null;
	hasDraft: boolean;
	about: { kind: "agent" | "team"; name: string } | null;
	onClearAbout: () => void;
	/** Wraps `run.dismiss` so the caret lands back in the box (UX U8). */
	onDismiss: () => void;
}) {
	const [watching, setWatching] = useState(false);
	const stopRef = useRef<HTMLButtonElement>(null);
	const live = run.status === "running" || run.status === "stopping";
	const showsRun = run.enabled && run.status !== "idle";
	/*
	 * WHERE A DRAFT'S BLOCKED REASON IS VISIBLE (agent review round 2 #1). An idle
	 * strip has a sentence slot in the row; a settled, stopped or errored strip has
	 * none - the row is the run's title, time and buttons - so the reason gets a line
	 * under it. A LIVE run gets neither: its title ("Working on your request") is
	 * already the one visible statement of why the box refuses, and a second line
	 * would grow the dock 25 px over the 166 px idle height (measured 191.4) for a
	 * sentence about a state the run is already covering. The reason stays the box's
	 * `sr-only` description there, so what the reader hears is still the true state.
	 */
	const reasonInRow = Boolean(blockedReason) && hasDraft && !showsRun;
	const reasonBelowRow =
		Boolean(blockedReason) && hasDraft && showsRun && !live;

	/*
	 * Escape focuses Stop while a run is live — the accelerator the chat composer
	 * gives its own Stop. It is a FOCUS move rather than a stop: an Escape that
	 * killed a paid turn by accident is worse than one that did nothing, and the
	 * button is then one press away with the focus ring showing where it landed.
	 */
	useEffect(() => {
		if (!live) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			/*
			 * A dismissable layer owns Escape while it is open (review round 1, n1):
			 * Radix marks the key handled, and the page's discard confirmation is
			 * exactly the case where "close the dialog" must not also pull focus to
			 * a button in another card. `defaultPrevented` covers the first, and the
			 * open-dialog read covers the second.
			 */
			if (document.querySelector('[role="alertdialog"], [role="dialog"]'))
				return;
			stopRef.current?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [live]);

	const title =
		run.status === "running"
			? (run.step ?? "Working on your request")
			: run.status === "stopping"
				? "Stopping"
				: run.status === "done"
					? run.results.length > 0
						? "Finished"
						: "Finished without changing anything"
					: run.status === "stopped"
						? "Stopped"
						: run.status === "error"
							? /*
								 * TWO DIFFERENT FAILURES, TWO HEADINGS (UX review round 3,
								 * U2). "Stopped with an error" described a stopped run, and
								 * it was shown over the settle-read failure whose own body
								 * says the run FINISHED — a heading contradicting the
								 * sentence under it. The refused-stop case that shared this
								 * title no longer reaches the error state at all (U1), so
								 * the split is by what actually happened: nothing was sent
								 * (`canRetry`) versus a run that ran and then could not be
								 * read back.
								 */
								run.canRetry
								? "Stopped with an error"
								: "Finished with an error"
							: "";

	return (
		<div
			className={CHAT_MEASURE}
			data-testid={showsRun ? "config-run-strip" : undefined}
		>
			<div className={STATUS_ROW}>
				{showsRun ? (
					<div className="flex min-w-0 flex-1 items-center gap-3">
						<StateDot status={run.status} pulse={live} />
						<span
							aria-live="polite"
							className="min-w-0 truncate text-body-sm text-ink"
						>
							{title}
							{/*
							 * THE SETTLED RESULTS LINE IS SPOKEN WITH THE TITLE (UX review round 1
							 * U10). This span is the row's one live region, and text changing
							 * inside an existing region is announced where a newly mounted region
							 * is often not, so the count rides here as `sr-only` text (the visible
							 * count beside it is hidden from AT for that state, so it is read once).
							 * Only `done`: while running the count changes with every write and
							 * announcing each would talk over the run.
							 */}
							{run.status === "done" && run.touched.length > 0 ? (
								<span className="sr-only">
									{`. Configured ${definitionsPhrase(run.touched.length)}`}
								</span>
							) : null}
						</span>
						{(live || run.status === "stopped" || run.status === "done") &&
						run.elapsed !== "0s" ? (
							<span className="shrink-0 text-meta text-ink-muted tabular-nums">
								{run.elapsed}
							</span>
						) : null}
						{/* A count is a fact about the run, not a state to be badged. */}
						{run.touched.length > 0 ? (
							<span
								// "1 definition" alone has no noun context for a reader that meets it
								// out of order; the settled state is spoken by the live title instead.
								aria-hidden={run.status === "done" ? true : undefined}
								className="shrink-0 text-meta text-ink-muted"
							>
								<span className="sr-only">Configured </span>
								{definitionsPhrase(run.touched.length)}
							</span>
						) : null}
					</div>
				) : null}
				{/*
				 * THE STANDING SENTENCE, verbatim and permanent — not a placeholder and
				 * not an invitation (U4): the page already hands work to a conversation
				 * from "New chat", and without this line the reasonable reading of the
				 * box is that it does the same. `ink-dim`, the palette's own floor for
				 * secondary text (5:1 on canvas in both brand palettes): it is a
				 * footnote to the box and must not compete with the run's title.
				 */}
				{run.enabled && !reasonBelowRow ? (
					<>
						{/*
						 * THE STANDING SENTENCE, verbatim and permanent — not a placeholder and
						 * not an invitation (U4): the page already hands work to a conversation
						 * from "New chat", and without this line the reasonable reading of the
						 * box is that it does the same. `ink-dim`, the palette's own floor for
						 * secondary text (5:1 on canvas in both brand palettes): it is a
						 * footnote to the box and must not compete with the run's title.
						 *
						 * IT IS THE BOX'S DESCRIPTION ONLY WHILE THE PAGE IS NOT BLOCKED (UX
						 * review round 2, U4): "Runs in the background" is not what a refused
						 * box does, and a reader on it heard that instead of why it refuses.
						 * Blocked, the id moves to the reason's span below; this stays on screen
						 * in the empty-box state so the dock's frame does not change, and gives
						 * its place to the reason when the box holds a draft.
						 */}
						{reasonInRow ? null : (
							<span
								id={blockedReason ? undefined : ASIDE_NOTICE_ID}
								data-testid={blockedReason ? undefined : "config-composer-note"}
								className={
									showsRun
										? "sr-only"
										: "min-w-0 flex-1 truncate text-meta text-ink-dim"
								}
							>
								Runs in the background. This does not appear in your
								conversation.
							</span>
						)}
						{blockedReason ? (
							<span
								id={ASIDE_NOTICE_ID}
								data-testid="config-composer-note"
								className={
									reasonInRow
										? "min-w-0 flex-1 truncate text-meta text-ink-dim"
										: "sr-only"
								}
							>
								{/*
								 * A BLOCKED PAGE SPEAKS ONCE, AND WHERE IT CAN BE SEEN (UX review
								 * round 1 U3; agent review round 2 #1). The reason used to ride in
								 * `hostNotice.placeholder`, which the composer ALSO prints as a meta
								 * line above this row whenever the box holds a draft - the same
								 * sentence twice within 26 px - so `statedByNode` stands that copy
								 * down for a draft, and that is a promise this component keeps: with
								 * a draft the sentence is VISIBLE in exactly one place. An idle strip:
								 * here, taking the standing promise's place (nothing can be sent, so
								 * the promise about a send has nothing to say). A settled strip: the
								 * line under the row (`reasonBelowRow`); a live run: its own title. With
								 * an EMPTY box the placeholder is the visible statement, and this span is
								 * the `sr-only` description so the reader hears the reason too.
								 */}
								{blockedReason}
							</span>
						) : null}
					</>
				) : (
					// An empty flexible slot keeps the row's 28 px and its right edge; the
					// sentence itself is the paragraph BELOW the row (see `ComposerStatus`).
					<span className="flex-1" aria-hidden="true" />
				)}
				<div className="ml-auto flex shrink-0 items-center gap-1">
					{about ? (
						<>
							{/* Plain text, not an accent badge: the accent is spent on Send and the focus ring (D16). */}
							<span
								data-testid="config-composer-about"
								// The name truncates at 224 px; the full words stay reachable (UX U8).
								title={`About ${about.kind} ${about.name}`}
								className="max-w-56 truncate text-meta text-ink-muted"
							>
								About {about.kind} {about.name}
							</span>
							<Button
								variant="ghost"
								size="sm"
								// The trailing control when no run is showing: `-mr-2` (the button's
								// own `px-2`) puts its LABEL's last glyph on the column edge (D1).
								className={showsRun ? undefined : TRAILING_GHOST}
								onClick={onClearAbout}
							>
								Clear
							</Button>
						</>
					) : null}
					{showsRun && run.activity.length > 0 ? (
						<Button
							variant="ghost"
							size="sm"
							aria-expanded={watching}
							onClick={() => setWatching((open) => !open)}
						>
							{watching ? (
								<ChevronDown className="size-3.5" />
							) : (
								<ChevronRight className="size-3.5" />
							)}
							Watch
						</Button>
					) : null}
					{showsRun ? (
						live ? (
							<Button
								ref={stopRef}
								variant="secondary"
								size="sm"
								disabled={run.status === "stopping"}
								onClick={() => void run.stop()}
							>
								<Square className="size-3.5" />
								{run.status === "stopping" ? "Stopping…" : "Stop"}
							</Button>
						) : (
							<Button
								variant="ghost"
								size="sm"
								className={TRAILING_GHOST}
								onClick={onDismiss}
							>
								Dismiss
							</Button>
						)
					) : null}
				</div>
			</div>
			{run.enabled ? null : (
				/*
				 * THE DISABLED GATE'S SENTENCE WRAPS BELOW THE ROW (QA review round 1 Q2).
				 * It is the only explanation of why the box is dead and its second half is
				 * the actionable one ("Update Local Operator to ..."), so `truncate` in the
				 * row cut exactly the part that mattered at the real 476 px pane. It is the
				 * box's `aria-describedby` target in this state, with the same id and testid
				 * the in-row sentence carries when the box is enabled. 119 characters is two
				 * lines at the narrowest pane, so it needs no bound of its own.
				 */
				<p
					id={ASIDE_NOTICE_ID}
					data-testid="config-composer-note"
					className="mb-2 text-meta text-ink-dim"
				>
					{run.disabledReason}
				</p>
			)}
			{reasonBelowRow ? (
				<p
					id={ASIDE_NOTICE_ID}
					data-testid="config-composer-note"
					className="mb-2 text-meta text-ink-muted"
				>
					{blockedReason}
				</p>
			) : null}
			{showsRun ? (
				/*
				 * THE DETAIL UNDER THE ROW, IN FLOW. Watch, the settled summary, a refused
				 * stop and an error render here, between the row and the box. They are the
				 * only things that may make the dock taller than its resting height, they
				 * grow it upward (the dock is the column's last child, so the box stays
				 * where it is), and the whole block is bounded by `DETAIL_BOUND` and scrolls
				 * itself (`DetailRegion`): `run.answer` and `run.error` are free-length.
				 */
				<DetailRegion>
					{run.attached ? (
						<p className="mt-1 text-meta text-ink-muted">
							Another configuration run was already going, so this page attached
							to it. Your request was not sent — it is still in the box.
						</p>
					) : null}
					{/*
					 * THE STOP THAT DID NOT TAKE (UX review round 3, U1).
					 *
					 * A refused interrupt used to render the settled error shape: the live
					 * Stop and the elapsed time vanished, Dismiss was the only control left,
					 * and the strip said the run had stopped — while it went on writing
					 * definitions. The strip keeps its live shape in that case (Stop still
					 * pressable, the clock still running) and says what happened here, with
					 * the refusal's own reason under it when the backend gave one.
					 */}
					{run.stopError ? (
						<div
							className="mt-2 border-danger-border border-t pt-2"
							data-testid="config-stop-refused"
						>
							<p className="text-body-sm text-danger">
								The stop did not take — the run is still going.
							</p>
							<p className="mt-0.5 text-meta text-ink-muted">{run.stopError}</p>
						</div>
					) : null}
					{watching ? (
						<div className="mt-2 border-hairline border-t pt-2">
							<RunActivity run={run} />
						</div>
					) : null}
					{/*
					 * THE STOPPED CASE SAYS WHAT IT KEPT. Cancellation is not rollback: the
					 * tools write through as they go, so a stop mid-run leaves whatever it had
					 * already written, and the honest sentence is the one that says so rather
					 * than implying the machine was put back — and a stop that happened before
					 * anything was written says THAT instead (review round 1, UX nit: the kept
					 * sentence was shown over an empty result list).
					 */}
					{run.status === "stopped" ? (
						<div className="mt-2 space-y-1 border-hairline border-t pt-2 text-body-sm">
							<p className="text-ink">
								{run.results.length > 0
									? "Stopped. Changes it had already made were kept."
									: "Stopped. Nothing had been changed yet."}
							</p>
							{run.results.length > 0 ? (
								<ul className="space-y-0.5">
									{run.results.map((result) => (
										<li
											key={`${result.target.kind}:${result.target.name}`}
											className="text-ink-muted"
										>
											{result.created ? "Created " : "Changed "}
											<span className="text-ink">{result.target.name}</span>
										</li>
									))}
								</ul>
							) : null}
						</div>
					) : null}
					{run.status === "done" ? <RunSummary run={run} /> : null}
					{run.status === "error" && run.error ? (
						<div className="mt-2 border-danger-border border-t pt-2">
							<p className="text-body-sm text-danger">{run.error}</p>
						</div>
					) : null}
				</DetailRegion>
			) : null}
			{showsRun && run.status === "error" && run.error ? (
				/*
				 * `mb-2.5` (design review round 2 D3): Retry sat 4 px above the box and its
				 * focus ring (offset 1 + width 2) left 1 px, so it read as part of the box.
				 * Every other state leaves 9-10 px between the last line and the box; this
				 * row ends in a 32 px button, so the clearance has to be its own margin.
				 * The box does not move: the dock is the column's last child and grows UP.
				 */
				<div className="mb-2.5 flex items-center gap-2">
					{/*
					 * RETRY, WHEN THERE IS SOMETHING TO RETRY ON. The message-call failure is
					 * the one error the page can act on - the run exists and the text is still
					 * in the box - so the strip offers the same call again rather than telling
					 * the operator to send it themselves (review round 1, UX U10).
					 *
					 * BENEATH THE BOUNDED REGION, NOT INSIDE IT (design review round 1 D3): the
					 * error text above scrolls, and a control inside a scroller is clipped at
					 * the cap - measured, Retry was a 12 px sliver below the clip. Here it is
					 * always whole, and its outline has the dock's own room.
					 */}
					{run.canRetry ? (
						<Button
							variant="secondary"
							size="sm"
							data-testid="config-retry"
							disabled={run.starting}
							onClick={() => void run.retry()}
						>
							{run.starting ? "Sending…" : "Retry"}
						</Button>
					) : null}
					<p className="text-meta text-ink-muted">
						Nothing else was changed by this run.
					</p>
				</div>
			) : null}
		</div>
	);
}

/**
 * Exactly what changed, in the operator's words.
 *
 * WHY THIS IS NOT A SUCCESS TOAST. A configuration run writes text that future
 * sessions obey, so the change has to be NAMED where the operator can read it and
 * not only announced — and branding §7 wants a completed action as a quiet line
 * rather than a card. A run that changed nothing says that instead of showing an
 * empty list (the design's "zero touched entities" case), and an update whose
 * catalogue fields did not move says which fact it cannot see from here.
 */
function RunSummary({ run }: { run: ConfigRunHandle }) {
	if (run.results.length === 0) {
		return (
			<div className="mt-2 border-hairline border-t pt-2 text-body-sm">
				<p className="text-ink-muted">
					The run answered without changing any agent or team.
				</p>
				{/*
				 * THE ANSWER ITSELF, and the request it answers. "The run answered" is a
				 * claim the operator cannot check from here otherwise: the zero-touched
				 * case is DEFINED as "the run answered a question", and the sentence and
				 * the question were the two things missing (review round 1, UX U3).
				 */}
				{run.answer ? (
					<p className="mt-1 whitespace-pre-wrap text-ink">{run.answer}</p>
				) : null}
				{run.topic ? (
					<p className="mt-1 text-meta text-ink-muted">
						You asked: {run.topic}
					</p>
				) : null}
			</div>
		);
	}
	return (
		<div className="mt-2 space-y-1 border-hairline border-t pt-2">
			<ul className="space-y-1 text-body-sm">
				{run.results.map((result) => (
					<li key={`${result.target.kind}:${result.target.name}`}>
						<span className="text-ink">
							{result.created ? "Created " : "Updated "}
							{result.target.name}
						</span>
						<span className="text-ink-muted"> ({result.target.kind})</span>
						{result.changes.length > 0 ? (
							<span className="text-ink-muted">
								{": "}
								{result.changes.map((change) => change.label).join(", ")}
							</span>
						) : result.created ? null : (
							<span className="text-ink-muted">
								{
									": its settings changed. The list does not show instructions, so open it to see what was written."
								}
							</span>
						)}
					</li>
				))}
			</ul>
			{run.answer ? (
				<p className="whitespace-pre-wrap text-body-sm text-ink-muted">
					{run.answer}
				</p>
			) : null}
		</div>
	);
}

/**
 * THE BOX'S KEY: ONE CONSTANT, FOR THE APP'S WHOLE LIFE.
 *
 * It began as a key minted per page MOUNT, which took the draft with it when the
 * operator left /agents (UX exploration, U2 — the module-scope `config-run-store`
 * this mount replaced held the draft across route changes). A uuid minted once
 * per app LAUNCH is not the fix either: `useConversationInputStore` keeps every
 * row (`partialize`, conversation-input-store.ts, and nothing sweeps them), so
 * one uuid per launch orphans a persisted row per launch that ever held typing,
 * and an unsent request still dies at relaunch while chat's drafts survive.
 *
 * A CONSTANT makes relaunch behave like leaving and returning, which is what the
 * operator expects of a draft, and it cannot collide: conversation ids are uuids
 * or `session/…` — no bare word can be one.
 *
 * It is still NOT a session id and still never a conversation. See the note
 * § 3.3.1 for the decision it satisfies (key (a)) and § 3.7 for the leak row.
 */
export const CONFIG_BOX_KEY = "agents-config";

/**
 * THE SENTENCE "ASK FOR A CHANGE" PUTS IN THE BOX, built in one place.
 *
 * The pane's own button builds the same words (`agent-detail.tsx`, `team-detail.tsx`)
 * and the page's cleanup compares against them, so the shape lives here as a
 * function rather than as three copies of a template string: a change to the
 * sentence that missed one copy would leave a seeded draft the cleanup no longer
 * recognises as seeded, and the operator's next row click would keep it.
 */
export const configSeedPrompt = (about: {
	kind: "agent" | "team";
	name: string;
}): string => `Change the ${about.kind} ${about.name}: `;

/**
 * THE ONE WRITER OF THE BOX'S TEXT OUTSIDE THE COMPOSER, and the fix for QA
 * round 2's Q1.
 *
 * WHAT WENT WRONG. The detail panes' "Ask for a change" set the About badge and
 * seeded the run store's `draft`, which nothing rendered any more: the box's
 * text had moved to `useConversationInputStore[CONFIG_BOX_KEY]` (the store the
 * example chips and every keystroke write), so the button produced a badge, a
 * caret in an EMPTY box, and an operator who had to type the request they had
 * just asked for. Measured by QA: the box's own row was live and writable — six
 * run sends landed in its `submittedMessages` while `currentInput` stayed `""` —
 * and no `agents-config` row was ever written by the press.
 *
 * WHY THE FIX IS A FUNCTION RATHER THAN A LINE AT EACH CALL SITE. The defect was
 * a caller writing to a store the box does not read, and the defence against the
 * next one is to make the seed and the target ONE action that cannot be half
 * applied: a call site has nothing left to get wrong.
 */
export function askForChange(
	run: ConfigRunHandle,
	about: { kind: "agent" | "team"; name: string },
	prompt: string,
): void {
	run.setAbout(about);
	const store = useConversationInputStore.getState();
	/*
	 * THE SEED GOES THROUGH THE CHANNEL THAT CAN MOVE A BOX, and only into an
	 * EMPTY one (agent review round 9, finding 2).
	 *
	 * A press here is the APP writing the box, so it uses `setComposerText` - the
	 * writer that bumps `textRevision` and so reaches the composer - rather than
	 * `setCurrentInput`, whose write the hook only ever adopts into an EMPTY box.
	 * The pair therefore moves in both directions through the same channel, and the
	 * row stays the box's own value, which is what makes the clear below sound: it
	 * compares the row against the sentence it seeded.
	 *
	 * WORDS THE OPERATOR HAS ALREADY TYPED ARE THEIRS, the rule the clear's guard
	 * enforces on the way out and this enforces on the way in: a started request is
	 * left alone rather than replaced by a sentence that was only ever a starting
	 * point. Nothing is written in that case, so the row still holds the DRAFT and
	 * the guard cannot mistake it for the seed.
	 */
	if (store.getCurrentInput(CONFIG_BOX_KEY)) return;
	store.setComposerText(CONFIG_BOX_KEY, prompt);
}

/**
 * THE SEEDED SENTENCE GOES WITH ITS TARGET, and only the seeded one.
 *
 * Text the operator typed is theirs, and deleting it because they clicked another
 * row would be a worse bug than the stale chip (review round 1, U6/D2) — so this
 * clears the box only when it still holds exactly what `configSeedPrompt` wrote
 * for the target being left behind, and leaves a hand-typed request alone.
 */
export function discardSeededConfigBox(about: {
	kind: "agent" | "team";
	name: string;
}): void {
	const store = useConversationInputStore.getState();
	if (
		store.getCurrentInput(CONFIG_BOX_KEY).trim() ===
		configSeedPrompt(about).trim()
	) {
		/*
		 * `setComposerText`, NOT `setCurrentInput` (agent review round 9, finding 2).
		 * The silent keystroke path cannot EMPTY a filled box: the hook adopts
		 * non-empty text into an empty composer and adopts an external clear ONLY
		 * through `textRevision`, which `setCurrentInput` deliberately does not bump.
		 * Written through it, this clear emptied the row and left the sentence on
		 * screen, and the operator's next Enter sent it as the request while the run
		 * was told about no agent at all.
		 */
		store.setComposerText(CONFIG_BOX_KEY, "");
	}
}

export function ConfigComposer({
	run,
	hero = false,
	blockedReason,
	/** Names the row the next request is about, when one is selected. */
	about,
	onClearAbout,
}: {
	run: ConfigRunHandle;
	hero?: boolean;
	blockedReason?: string | null;
	about: { kind: "agent" | "team"; name: string } | null;
	onClearAbout: () => void;
}) {
	const inputRef = useRef<MessageInputHandle | null>(null);
	const recordingProbe = useRadientCredentialProbe();
	/*
	 * THE IDLE BOX'S READINGS COME FROM THE DRAFT PREVIEW, the same resolution a
	 * new chat's box uses (chat-page.tsx's `preview`), because this box opens on
	 * the SAME question — a request about to start a conversation — and a box that
	 * showed no readings where a new chat shows six read as a different composer
	 * (the operator's report on this page). It asks about the app's staged working
	 * directory, which is the value the new chat's draft preview is built from; the
	 * run's own create deliberately names no `cwd` (`use-config-run.ts`: the backend
	 * resolves it), so the preview is a reading of the resolution the box is about
	 * to ask for rather than a second, invented request shape.
	 *
	 * READ ONLY WHILE THE RUN HAS NO SNAPSHOT: the moment a run is live `run.frontend`
	 * is the authoritative projection and the preview stops being asked for, exactly
	 * as the chat pane's does once its session exists.
	 */
	const cwd = useCanonicalSessionsStore((state) => state.cwd);
	const capabilities = useDesktopCapabilities();
	const draftPreviewOn =
		run.frontend === null &&
		run.status === "idle" &&
		cwd.length > 0 &&
		desktopFeatureEnabled(capabilities.data, "draft_preview");
	const preview = useQuery({
		...draftPreviewQuery({ cwd, model: null }),
		enabled: draftPreviewOn,
	});
	/*
	 * THE BOX'S CONVERSATION KEY, present from the FIRST PAINT and never re-minted.
	 *
	 * WHY IT IS NOT A SESSION ID: the composer refuses to submit without a key and
	 * stores its text under it, while a run's session exists only after the create
	 * answers — and the key must not move when it does, or a send that failed after
	 * the create would put the text back into a key the box is no longer reading.
	 * So the key is the run composer's OWN identity (the design's "the run's
	 * identity, which is deliberately not a session", §1.4), minted once per page
	 * mount, and the run never becomes a canonical row under it.
	 */
	// U2: the key outlives the mount, so the draft does too (see CONFIG_BOX_KEY).
	const boxKey = CONFIG_BOX_KEY;
	/** The composer owns the box's text; this writes into the same key it reads. */
	const setBoxText = (value: string) =>
		useConversationInputStore.getState().setCurrentInput(boxKey, value);
	const live = run.status === "running" || run.status === "stopping";
	/*
	 * WHY THE BOX REFUSES INPUT WHILE A RUN IS LIVE, and what that refusal is NOT.
	 * The strip's Stop is not the only door onto a second send — the box's own Enter
	 * is, and a second send is a second registry write — so `live` joins
	 * `blocksInput` below (U1) and the field goes `readOnly` with the ink stepped.
	 * `disabled` survives for the states that cannot send at all (no capability, a
	 * dirty edit holding the page), which is the term the box's own "unavailable"
	 * sentences and the example chips read. The keystrokes typed into a refused live
	 * box are NOT queued: they are dropped, which UX review round 2's U2 records as
	 * a follow-up (the refusal is visible in four channels; the discard is not).
	 */
	const disabled = !run.enabled || Boolean(blockedReason);
	/*
	 * THE BOX'S WORDS IN THE STATES THIS PAGE OWNS (design review round 1, D1/D5).
	 *
	 * The composer's own sentences for a refused or outstanding box are chat's
	 * ("Agent is busy", "Sending your message"), and neither is true here: nothing
	 * is busy when the page is holding a dirty edit, and the request the box is
	 * waiting on is a configuration run. The host supplies the sentence for those
	 * two states and nothing else — the invitation and every other state still
	 * come from the composer.
	 *
	 * THE BAND OWNS THE BACKEND'S REFUSAL SENTENCE, not the box (design review
	 * round 2, D7). `run.disabledReason` used to be set here as the placeholder as
	 * well as rendered in the notice band, so the operator read the same 66-character
	 * sentence twice, 8 px apart — same string, the second copy in the dim ink. One
	 * carrier is enough, and the band is the one that says it at 7.88:1, so the box
	 * keeps its own line for the state instead.
	 *
	 * THE DISABLED GATE STILL NEEDS AN ARM, AND THROUGH THIS SLOT (design review
	 * round 3, D9 = UX review round 3, U1). Dropping the arm re-opened round 1's D1
	 * on the one state D1 named: with no host line the resolution chain in
	 * `composerPlaceholder` falls through to `COMPOSER_PLACEHOLDER.busy` — "Agent is
	 * busy" — while nothing is running, on a box that is refused because the backend
	 * could not be reached. The `idle` slot (`placeholderOverride`, below) cannot
	 * carry the fix: it is read LAST, after `inputDisabled`, so a refused box never
	 * reaches it. `hostLine` is the channel that does, and it is the same one the
	 * dirty-edit gate already speaks through above.
	 */
	/*
	 * THE DRAFT, READ SO THE BAND'S SECOND COPY CAN STAND DOWN (UX review round 1
	 * U3).
	 *
	 * `MessageInput` prints `hostNotice.placeholder` a SECOND time, as a meta line
	 * above the status row, whenever a refusing box holds text - because a
	 * placeholder is not painted on a control with a value. That line stacked on
	 * the row's own state ("Working on your request" twice within 26 px; the
	 * blocked sentence beside the standing promise) and made the dock's height
	 * depend on whether the box was empty. The status row carries the state in
	 * every case (its sentence slot takes the blocked reason; its title carries the
	 * run), so with a draft the line has nothing left to say, and `statedByNode`
	 * tells the composer so. The placeholder ATTRIBUTE is untouched: it is what an
	 * EMPTY box paints. The reading is the store's, the same row the composer
	 * writes every keystroke to.
	 */
	const hasDraft = useConversationInputStore(
		(state) =>
			(state.inputByConversation[CONFIG_BOX_KEY]?.currentInput ?? "").trim()
				.length > 0,
	);
	const hostPlaceholder = blockedReason
		? blockedReason
		: live
			? "Working on your request…"
			: run.enabled
				? undefined
				: DISABLED_GATE_LINE;
	/*
	 * THE INVITATION IS THE SAME WORDS ON BOTH PANES (UX review round 3, U2). The
	 * heading above this box says "Ask for an agent" or "Ask for a team" depending
	 * on the tab, but the box serves both, so an invitation that names either object
	 * first reads as a contradiction on the other pane — the Teams pane's box used to
	 * open with "a new agent". Naming no object keeps it true on both, and it matches
	 * the sentence the pane itself gives the operator: "Describe what you want and a
	 * configuration run sets it up."
	 */
	/*
	 * THE DOCKED, NO-TARGET BOX NAMES ITS JOB (UX review round 1 U2). With the chips
	 * gone from the dock and its heading `sr-only`, "Describe what you want…" under
	 * an open team read like messaging that team. Round 3's rule is that the
	 * invitation must not contradict the open TAB, and what it forbade was naming ONE
	 * object first ("a new agent" over the Teams pane). A sentence that names BOTH
	 * objects, and a change to the open definition first, is true on either tab. The
	 * hero keeps its object-free words: it is a different arm, with the heading and
	 * the chips standing beside it to say what the box is for.
	 *
	 * IT MUST FIT ON ONE LINE AT EVERY PANE WIDTH THE APP CAN PRODUCE (design review
	 * round 2 D1 = QA Q1 = UX U3). The idle docked box is one row tall and does not
	 * auto-grow, so a placeholder that wraps is clipped mid-sentence with a stray
	 * scrollbar thumb in an empty box. The narrowest docked pane is 416 px: the
	 * shell's sidebar docks from 1024 px at up to 320 px wide, and the roster is a
	 * fixed 288 px. The box's text area is the pane less 88 px of insets (measured:
	 * 328 px at 416, 388 px at 476). The previous 71-character sentence measured
	 * 444 px and needed a 532 px pane; this one measures 301 px. It still names the job (a change) and, naming neither
	 * object, cannot contradict whichever tab is open. Do not lengthen it without
	 * re-running the pane-width sweep.
	 */
	const placeholder = about
		? `Change ${about.name}…`
		: run.enabled
			? hero
				? "Describe what you want…"
				: "Ask for a change, or describe something new…"
			: DISABLED_GATE_LINE;

	/*
	 * "ASK FOR A CHANGE" ARRIVES FROM ELSEWHERE, so the caret has to land here.
	 * The detail pane's own button (`askForChange`) puts the sentence in this box
	 * and names the target; the operator's next keystroke belongs in this box, and
	 * without this the focus stayed on `BODY` — a keyboard user had no cue that
	 * anything had happened (review round 1, D9).
	 */
	const aboutKey = about ? `${about.kind}:${about.name}` : null;
	useEffect(() => {
		if (!aboutKey) return;
		inputRef.current?.focusInput();
	}, [aboutKey]);

	/**
	 * DISMISS AND CLEAR PUT THE CARET BACK (UX U8). Both retire the control the
	 * operator just pressed, and focus used to fall to `body` — a keyboard user
	 * then had no cursor anywhere on the page.
	 */
	const dismissAndFocus = () => {
		run.dismiss();
		inputRef.current?.focusInput();
	};
	const clearAboutAndFocus = () => {
		onClearAbout();
		inputRef.current?.focusInput();
	};

	return (
		<div
			/*
			 * NO FRAME, NO PADDING, NO POSITIONING CONTEXT. This element used to be a
			 * bordered `bg-surface` card around the box in the docked arm (the second of
			 * three nested frames; design spec D1) and the containing block of an
			 * absolutely-positioned strip. The box is the composer's own object with its
			 * own step of lightness, the status row is in flow above it, and the band
			 * inside `MessageInput` already carries the horizontal and vertical padding,
			 * so a wrapper that added any of it would be a second inset on one edge.
			 * Docked and hero are now the same element: the difference is only the chips.
			 */
			data-testid="config-composer"
		>
			<div className="sr-only" id="config-composer-label">
				Ask for an agent or team change
			</div>
			{/*
			 * THE BOX IS THE APP'S OWN COMPOSER (Scope B, §3.1).
			 *
			 * WHAT IT REPLACES: the bespoke `<Textarea>` and its own Send button, and
			 * nothing else. The run keeps the surface above it — `ComposerStatus`, Watch,
			 * Stop, `RunSummary` — because that is the run's progress vocabulary and
			 * not a transcript (§3.1's two-surface reading); this is one shared box
			 * with speech, attachments and the model/effort readings the page never
			 * had, not a second composer.
			 *
			 * THE FOUR DIFFERENCES ARE ALL PROPS, none of them a fork (§3.3):
			 * `transcriptless` (no transcript above it), no `onSlashCommand` and no
			 * `mentionsEnabled` (the command write paths stay closed), the readings
			 * without a dispatcher (each picker renders with the shipped
			 * `COMMANDS_OFF` sentence), and the aside sentence in the notice band
			 * below, where the box can still describe itself with it.
			 */}
			<MessageInput
				ref={inputRef}
				conversationId={boxKey}
				messages={EMPTY_MESSAGES}
				/*
				 * `isLoading` IS FALSE AND STAYS FALSE: it is the only prop that swaps
				 * Send for Stop and disables the box, and this page's Stop is the
				 * strip's (`run.stop`), which keeps running beside the box.
				 */
				isLoading={false}
				transcriptless
				placeholderOverride={placeholder}
				/*
				 * READINGS WITHOUT PICKERS (§3.3.3(b)): the snapshot renders the model,
				 * effort, context, spend and duration the run really is on, and no
				 * `onCommand` means none of them opens a picker — because this run's
				 * model and effort are resolved by the backend, not chosen here.
				 */
				sessionStatus={
					run.frontend
						? { frontend: run.frontend }
						: preview.data
							? { frontend: preview.data.snapshot, draft: true }
							: undefined
				}
				recordingProbe={recordingProbe}
				hostNotice={{
					id: ASIDE_NOTICE_ID,
					/*
					 * THE PAGE'S OWN GATE REACHES THE BOX (code review round 1, M1): a
					 * dirty edit elsewhere on the page (`blockedReason`) and a backend
					 * without the capability both refuse input here, through the same
					 * `isInputDisabled` term every writer and submitter reads. It used
					 * to gate only the example chips, so the operator could type a
					 * request the page would then refuse to send.
					 *
					 * NOT `unavailable`: that prop is chat's "this conversation is not
					 * on this machine" state, and it would put chat's copy and a
					 * transcript-only notice id on this page (m1).
					 */
					/*
					 * `live` is in the term deliberately (U1): the strip's Stop is not
					 * the only door onto a second send — the box's own Enter is, and a
					 * second send is a second registry write.
					 */
					blocksInput: !run.enabled || Boolean(blockedReason) || live,
					placeholder: hostPlaceholder,
					/*
					 * TRUE WITH A DRAFT BECAUSE `ComposerStatus` KEEPS THE PROMISE THAT GOES
					 * WITH IT: the sentence is visible in the row (idle), under it (settled,
					 * stopped, errored) or is the live title. Do not widen this to a state
					 * where the node renders the sentence `sr-only` - that was the round 2
					 * regression (a blocked box with a draft and no reason on screen).
					 */
					statedByNode: hasDraft,
					/*
					 * THE STATUS ROW IS THE NOTICE NODE (design spec s2). The slot is the one
					 * place a node can sit immediately outboard of the box AND be named by its
					 * `aria-describedby`, and the composer renders it as a plain child of the
					 * form (not inside a `<p>` and not `aria-hidden`), so interactive content
					 * is fine here. The sentence inside carries `ASIDE_NOTICE_ID`; the row
					 * around it must not, or the box would describe itself with Stop and Clear.
					 */
					node: (
						<ComposerStatus
							run={run}
							about={about}
							blockedReason={blockedReason}
							hasDraft={hasDraft}
							onClearAbout={clearAboutAndFocus}
							onDismiss={dismissAndFocus}
						/>
					),
				}}
				/*
				 * THE SEND SEAM, AND THE DRAFT RULE THAT SURVIVES THROUGH IT: `false`
				 * means the request never reached the run, so the composer puts the text
				 * (and its chips) back rather than spending them (§3.3.1).
				 */
				onSendMessage={(content, attachments) =>
					run.start(content, about, attachments)
				}
			/>
			{/*
			 * THE EXAMPLES BELONG TO THE HERO ALONE (design spec s2, D1).
			 *
			 * They are examples of NEW requests ("A reviewer that only reads code"),
			 * and the docked composer is mounted exactly when a definition is open, i.e.
			 * when the likely ask is a change to THAT definition. Docked, they cost 61
			 * px of a 725 px window (three wrapped lines) and suggested the wrong thing;
			 * in the hero, where creating is the whole point, they stay. They are a
			 * vertical stack because the three measure 211 + 241 + 353 px against a
			 * 630 px box, so a single non-wrapping row is not achievable and a wrapping
			 * row is ragged.
			 *
			 * THEY STAY WHILE THE BOX IS REFUSING (a run, a held edit) and are disabled
			 * with it, and they write through the SAME store the box reads, keyed by its
			 * conversation id (design review round 1, D4/U11 and D9): the composer owns
			 * the text now, so a chip that wrote anywhere else would type into a box
			 * nobody is looking at. `invisible` rather than unmounted while a run or an
			 * `about` is set keeps the hero's height, so the box does not move under the
			 * caret the moment Enter is pressed (the original D4).
			 *
			 * `-ml-2` cancels the button's own `px-2`, so the chip's TEXT starts at the
			 * box's left edge rather than its padding box; the hover ground then reaches
			 * 8 px outside the column, which a ground is allowed to do and text is not.
			 * The inset wrapper is the band's own (`CHAT_COLUMN_INSET`, the value and not
			 * a copy of it) so the three columns share an edge if that inset moves. The
			 * wrapper is its own query container, exactly as the band is, because the
			 * hero's composer is a direct child of the pane (see `EmptyPane`) and nothing
			 * above it supplies one for `CHAT_MEASURE`'s 750 px gate to resolve against.
			 */}
			{hero && run.enabled ? (
				<div className={cn(CHAT_COLUMN_CONTAINER, CHAT_COLUMN_INSET)}>
					<div
						className={cn(
							CHAT_MEASURE,
							"mt-2 flex flex-col items-start gap-0.5",
							!about && !live ? "" : "invisible",
						)}
					>
						{EXAMPLES.map((example) => (
							<Button
								key={example}
								/*
								 * THE NEW CHAT'S SUGGESTION STYLE, NOT THE APP'S HEAVIEST BUTTON
								 * (design round 1, D2): `ghost`, the borderless muted line
								 * `measured-suggestion-stack.tsx` states the missing border of as
								 * deliberate. Same colour classes as that row so the two surfaces
								 * cannot drift apart.
								 */
								variant="ghost"
								size="sm"
								className="-ml-2 h-auto max-w-full justify-start whitespace-normal break-words px-2 py-1 text-left text-body-sm text-ink-muted hover:bg-elevated hover:text-ink disabled:text-ink-disabled disabled:hover:bg-transparent"
								disabled={disabled}
								onClick={() => {
									setBoxText(example);
									inputRef.current?.focusInput();
								}}
							>
								{example}
							</Button>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
