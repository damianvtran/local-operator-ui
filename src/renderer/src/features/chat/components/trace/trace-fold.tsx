/**
 * The aggregation tier's line (§E2, amendment A3).
 *
 * A run of three or more consecutive actions in one turn folds under ONE summary
 * line, so a forty-call turn stops being forty lines and starts being a sentence
 * a reader can act on: `Explored 4 files, 1 search`, `3 shell · 1 python`.
 *
 * ## What this component owns, and what it does not
 *
 * The copy, the counts, the run's span and the live clause are `trace-fold-model.ts`,
 * which is pure and unit-tested. This file owns the row, the disclosure, and the
 * two things a pure model cannot own: WHAT a reader's own press may change, and
 * WHEN a finished section condenses.
 *
 * ## Condensed by default, and the reader is the only closer
 *
 * The fold opens on NOTHING but the reader's own press: a group must not arrive
 * open (operator report, 2026-09-26 - groups auto-opened for the newest turn and
 * then never closed, "which defeats the purpose").
 *
 * It closes on THE READER'S press and nothing else (operator report, 2026-09-27:
 * "[expanded states] shouldn't be closed simply by state updates if they've been
 * explicitly opened"). The condense this component used to own - one close, the
 * moment the fold's section stopped being live, guarded by `!sectionLive &&
 * live === null` - was written for the auto-open that no longer exists: with
 * groups arriving condensed, its only client was the reader's OWN fold, and it
 * closed that under them. The two failure modes it had were both reported or
 * measured: a live turn whose section edge fires while the reader watches
 * (the rig's fold rounds reproduce it at every turn end - `expanded true ->
 * false` in the trace), and any frame where the working line is transiently
 * absent mid-turn (a gate, a reconnect) closing a fold whose turn is still
 * running. So the close is not here, and `open`/`onOpenChange` are REQUIRED
 * rather than defaulted: the state lives in the transcript's own registry
 * (`fold-open.ts`), which is what lets an explicit open survive the fold's
 * React identity changing under a windowed run (see that module's header) and
 * what resets it exactly once, on a conversation switch.
 *
 * ## What the condensed header says
 *
 * Three facts, in the order a reader needs them while the group is collapsed:
 * what is running RIGHT NOW (the in-flight call's own label - the operator's
 * sharpest point: `wait` holds a turn for minutes and a bare count hides it),
 * what the run has done (the counts by class or kind), and how long it has been
 * going (the run's wall-clock span, ticking while it runs). The running clause
 * is dropped while the fold is OPEN: the live row is right there, and two
 * elements for one fact is the redundancy this transcript keeps removing.
 *
 * ## The disclosure is the app's own
 *
 * `Disclosure` rather than a fold of its own, for the reason the design system
 * gives: a tool row, a section header and this line are the same gesture (a
 * leading chevron, one row height, a full-row ground), and a second folding
 * implementation beside the first is how one of them ends up with a different
 * hover, a different chevron or a different hit area. It is also what keeps the
 * fold's row at the ledger's own 24px pitch, so folding a run moves nothing
 * below it by more than the rows it hides. The one thing this change asks of
 * the primitive is its CONTROLLED mode: the condense belongs to the app as well
 * as the reader, and a second open-state owner beside the disclosure's own is
 * exactly how the two end up disagreeing about whether the fold is open.
 *
 * WHAT THE SHARED PRIMITIVE STILL DOES NOT GIVE THIS LINE, stated rather than
 * quietly skipped: §B7's named 180ms transition. `Disclosure` UNMOUNTS its
 * children (`isOpen && children`), so the fold appears and disappears rather
 * than growing and shrinking — and making it animate means keeping children
 * mounted for every caller, including every tool row in the transcript, where
 * an unmounted body is what keeps a forty-row turn cheap to scroll. That is a
 * change to a shared primitive with a real regression surface, so it is not
 * this commit's: the two states are legible in the frames, and the transition
 * is named as deferred on the PR rather than half-done here.
 *
 * ## The fold never reorders anything
 *
 * Folding hides rows; each keeps its record id and its position, and the fold
 * itself is keyed by its FIRST row's id, so it cannot claim a place ahead of the
 * action that opens it. That is branding §7's placement rule, and the transcript
 * order guard (`applyLiveSeed`/`withTimeOrder`) depends on it.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { foldMediaClause } from "../../canonical/trace-fold-model";
import type {
	FoldLive,
	FoldSpan,
	FoldSummarySpec,
} from "../../canonical/trace-fold-model";
import { formatSettledDuration } from "./tool-row-model";

/**
 * The ledger's own row height, and the reason it is spelled here rather than
 * imported: `tool-row.tsx` keeps its copy private on purpose (a consumer that
 * captured it by name could keep a stale pitch after the row moved), and
 * `scripts/tool-row.test.mjs` asserts the two stay equal.
 */
const ROW_HEIGHT = "min-h-5 py-0";

/** The fold's clock ticks at 1Hz, the interval the row's own clock uses. */
const FOLD_CLOCK_MS = 1000;

export type TraceFoldProps = {
	/**
	 * §E2's generated copy AS THE HEADER MUST PAINT IT: the units, and which shape
	 * they are (`FoldSummarySpec`). A COUNT LINE's units are painted unbreakable,
	 * so its wraps fall at a ` · ` and never inside a phrase (design round 1, D1);
	 * a SENTENCE is painted to wrap at its own spaces, exactly as it did before
	 * this branch (round 2, R2-1: painting it nowrap made prose unbreakable and
	 * left the summary's `break-words` inert). The collapsed bar's `title`, which
	 * has no DOM to paint, reads `foldSummary` - the units joined.
	 */
	summary: FoldSummarySpec;
	actionCount: number;
	/**
	 * The run's wall-clock span (`foldSpan`), or null when it cannot date itself -
	 * an older row restored from history carries durations but no stamps, and the
	 * header then renders NOTHING rather than a `0s` claim nothing supports.
	 */
	span: FoldSpan | null;
	/**
	 * The call being watched (`foldLive`), or null when no call is EXECUTING.
	 *
	 * It names the header while the fold is collapsed, and it is the fold's
	 * running clock while the fold is open - nothing else. The close it used to
	 * gate left with the condense (see the state rule above): the reader's press
	 * is the only closer now, so an executing call here can never hold a fold
	 * open or close one.
	 */
	live: FoldLive | null;
	/**
	 * Whether the reader has this fold open. Owned by the CALLER - the transcript's
	 * registry (`fold-open.ts`) - not by this component: a fold's key changes when
	 * the render window's edge walks through its run, and state held here would be
	 * thrown away by the remount (see that module's header for the measured walk).
	 */
	open: boolean;
	/** The reader's press, reported upward for the registry to hold. */
	onOpenChange: (open: boolean) => void;
	/** The fold's own margin: the gap tier its first row arrived with (D8). */
	className?: string;
	/**
	 * Media the run produced, drawn UNDER the condensed header.
	 *
	 * The rows inside a collapsed fold are unmounted (`Disclosure` renders
	 * `isOpen && children`), so a picture a call produced went with them: the
	 * reader had to expand the group to see the artifact, which is the cost
	 * condensing exists to remove. This is the fold's own copy of the principle
	 * #537 applied to metadata — the condensed state carries the facts the rows
	 * would have carried.
	 *
	 * Render it ONLY while condensed, and that is what the prop asks of its
	 * caller rather than something this component can check: open, the rows draw
	 * their own media (`TranscriptRow`'s `media`) and a strip here as well would
	 * put one picture on screen twice. The caller composes it
	 * (`canonical-transcript.tsx` builds a `FoldMedia` from the run's images)
	 * rather than this file importing it, because the fold is a trace-tier
	 * component and the transcript is what knows a record's images; the fold
	 * hands the node its own toggle, so the strip's `+N` slot (named and titled
	 * `N more images`) can open this fold instead of being a dead end (UX round
	 * 1, U1).
	 */
	condensedMedia?: (expand: () => void) => ReactNode;
	/**
	 * How many pictures `condensedMedia` stands for, for the header's own clause.
	 *
	 * A number beside the node rather than something read out of it, because the
	 * node is opaque here (the caller builds it) and because the COUNT is the part
	 * a 64px tile cannot carry: the strip is a presence cue, so the reader has to
	 * be told the number in text - legible at any tile size, reachable without a
	 * pointer, and the same fact the strip's accessible name already states
	 * (design review round 1, D3). Zero or absent adds no clause at all, which is
	 * what keeps a run with no pictures byte-identical.
	 */
	mediaCount?: number;
	/**
	 * The record ids the fold holds. Stamped on the wrapper (`data-fold-ids`)
	 * because a collapsed fold UNMOUNTS its rows, so a reader (or a future
	 * affordance) cannot find a row by its `data-record-id` until the fold
	 * that holds it is opened - this is how it finds that fold.
	 */
	recordIds: readonly string[];
	children: ReactNode;
};

/**
 * Ms now, ticking once a second while `active`.
 *
 * A local copy of the row's clock idiom (`tool-row.tsx`'s `useRunningElapsed`)
 * rather than an export of it: the row's hook answers "how long has ONE call
 * been running" from its start, while this answers "what time is it" for the
 * fold's span - `foldSpan` owns the arithmetic and this owns only the tick. It
 * shares the row's interval because the fold's number is whole seconds or tenths
 * (`formatSettledDuration`), so a faster clock would repaint without a change.
 */
function useNowMs(active: boolean): number {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const read = () => setNowMs(Date.now());
		read();
		const timer = window.setInterval(read, FOLD_CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [active]);
	return nowMs;
}

export const TraceFold = ({
	summary,
	actionCount,
	span,
	live,
	open,
	onOpenChange,
	className,
	condensedMedia,
	mediaCount = 0,
	recordIds,
	children,
}: TraceFoldProps) => {
	/*
	 * NO CONDENSE EVENT LIVES IN THIS COMPONENT, and that is now the whole of the
	 * state rule (operator report, 2026-09-27): a fold is opened and closed by
	 * the reader's own press, and the transcript's registry holds that across
	 * remounts. The rule this replaces - "one close, when the section stops being
	 * live" - belonged to the auto-open that no longer exists; its remaining
	 * client was the reader's own fold, which it closed under them (the fold
	 * rounds' trace: `expanded true -> false` at a turn end; and a working line
	 * that blinks false mid-turn - a gate, a reconnect - closes it early). Do not
	 * reintroduce an app-driven close here: an explicitly-opened fold is the
	 * reader's until they close it or switch conversations.
	 */

	/*
	 * The run's clock. `span.running` ticks it against now; a settled span freezes
	 * at its last completion, and a span that cannot date itself renders nothing
	 * (`formatSettledDuration(null)` is the empty string).
	 */
	const nowMs = useNowMs(span?.running === true);
	const spanS =
		span === null
			? null
			: Math.max(
					0,
					((span.running ? nowMs : (span.endedAtMs ?? nowMs)) -
						span.startedAtMs) /
						1000,
				);
	const durationText = spanS === null ? "" : formatSettledDuration(spanS);

	/*
	 * The fold's root, held so the strip's `+N` press can hand focus to THIS
	 * fold's own trigger (UX round 1, U2): that press unmounts the strip and the
	 * control the reader just activated, and focus on a removed node falls to
	 * `<body>`, from where the next Tab restarts at the document's first stop. The
	 * trigger stays mounted, owns the open state and is what closes the group
	 * again, so it is where the reader should land. The primitive does not expose
	 * its button, and the trigger is the first `aria-expanded` control in the
	 * root by construction (the strip renders after the disclosure).
	 */
	const rootRef = useRef<HTMLDivElement>(null);
	const revealFromStrip = () => {
		rootRef.current
			?.querySelector<HTMLElement>("button[aria-expanded]")
			?.focus();
		onOpenChange(true);
	};

	return (
		<div
			ref={rootRef}
			className={className}
			data-fold-ids={recordIds.join(" ")}
		>
			<Disclosure
				/*
				 * CONTROLLED, because the app closes this fold as well as the reader
				 * (`open`/`onOpenChange` above): the alternative is the reader's state
				 * and the app's state disagreeing about whether the fold is open.
				 */
				open={open}
				onOpenChange={onOpenChange}
				/*
				 * The summary is the aggregate line, so the chevron is what carries "there are
				 * rows in here" — the count alone would read as a statement of fact rather
				 * than as a control.
				 */
				rowClassName={ROW_HEIGHT}
				triggerClassName={cn("-mx-2 rounded-sm px-2", "hover:bg-row-hover")}
				summary={
					<span className={cn("flex min-w-0 flex-1 items-center gap-2")}>
						{/*
						 * Sans, because this is a SENTENCE about the turn rather than an
						 * identifier (§B4): the counts are words. The object's monospace column
						 * belongs to the individual rows inside the fold.
						 *
						 * FOUR FLEX ITEMS AND THE GAP THAT SPACES THEM, not one truncating
						 * sentence: the header's `·` separators take their breathing room from
						 * this row's `gap-2`, exactly as the summary/failure/clock did before the
						 * live clause existed (§E2).
						 *
						 * TRUNCATION PRIORITY, WHILE A CALL IS IN FLIGHT: the NAME is the only
						 * element that truncates. The first cut left the clause and the summary
						 * both on `min-w-0 truncate`, and flex shrank them in proportion - so a
						 * realistic long command took the counts down with it (`3 shell ·…`,
						 * `1 python` lost) while the failure chip and clock survived on
						 * `shrink-0` (design round 1, D1, measured on a long-name probe). The
						 * counts and the clock are the facts a condensed group exists to carry,
						 * and they still are: the clause keeps `min-w-0 truncate` (it can shrink
						 * to nothing) and the summary never truncates at all - it WRAPS (see
						 * its own comment below), so the counts survive in full even where the
						 * name has been paid away. `shrink-0` kept the summary on one line by
						 * refusing every squeeze, and that is also what made a long summary
						 * unable to stay inside a narrow row; with the counts wrapping there is
						 * nothing left for it to protect (operator report, 2026-10-01).
						 */}
						{live !== null && !open && (
							<>
								{/*
								 * THE IN-FLIGHT CALL, in the row's own words and its own
								 * typography: the verb the row paints while running (`Running`,
								 * `Reading`, `Calling`) at the row's own liveness ink, then the
								 * object in the machine voice the row gives it. Dropped while the
								 * fold is open - the live row is on screen then, and one fact does
								 * not need two elements. `data-fold-live` is the handle the
								 * behaviour suite drives (`scripts/trace-fold-behaviour.test.mjs`).
								 */}
								<span
									data-fold-live=""
									/*
									 * `shrink-[100000]`: THE NAME IS THE ELEMENT THAT YIELDS, and it yields to
									 * its own zero (`min-w-0`) before the counts lose a pixel. Flex hands each
									 * item a share of the deficit proportional to `factor x basis`, so this
									 * weight against the summary's DEFAULT 1 leaves the counts a share that
									 * rounds to zero layout units for as long as the clause has any width left
									 * - D1's ruling, and the reason the `long-name` and `image-live` frames come
									 * back byte-identical under the summary's own rule below. The ordering is
									 * measured, not assumed: at 999 the summary still lost 0.05px and wrapped
									 * (Chrome, 1280px, this story), so the weight is an order of magnitude
									 * higher rather than one step.
									 */
									className={cn("min-w-0 shrink-[100000] truncate")}
									/*
									 * The name is the only element here that truncates, so the full text
									 * would otherwise be reachable only by expanding the fold; the tooltip
									 * keeps it one hover away (design round 1, D1).
									 */
									title={`${live.verb} ${live.object}`}
								>
									<span className={cn("text-accent")}>{live.verb}</span>{" "}
									<span className={cn("font-mono text-mono-sm text-ink-muted")}>
										{live.object}
									</span>
								</span>
								{/*
								 * The `·` the header joins its facts with, after the live clause as
								 * after every other. It is a flex child rather than text inside the
								 * clause: nested one level in, it lost the row's `gap-2` and printed
								 * as `Running pnpm vitest run·3 shell` - caught in the first frame of
								 * `docs/evidence/chat-trace-fold/` and confirmed by measuring the
								 * rendered rects (clause 52-213, dot 213-217: zero gap).
								 */}
								<span
									aria-hidden={true}
									className={cn("text-ink-dim text-meta")}
								>
									·
								</span>
							</>
						)}
						<span
							/*
							 * WRAPS, NEVER TRUNCATES, AND NEVER OVERFLOWS (operator report,
							 * 2026-10-01): the summary is the run's counts - the facts a condensed
							 * group exists to carry - so nothing about it may be silently cut, and a
							 * settled header used to ellipsise it (`6 searches · 1 task · 2 browser
							 * actions · 1 ai_search · 1 get_tool_access · 1 query_…` at the 640px
							 * window). At a minimum-width column, or beside a long live clause, it
							 * now wraps onto the next line and the row grows; the ROW keeps
							 * `min-h-5`, so the ledger pitch only opens where a line genuinely
							 * needs it. The cap in `foldCounts` is the first line of defence - the
							 * report's nine-type run composes to five segments and a tail - and
							 * this wrap is the backstop underneath it. The span carries
							 * `data-fold-summary` for the tests and the rig (a text node inside the
							 * button is otherwise unaddressable), and
							 * `scripts/chat-alignment-geometry.mjs` reads its box per width.
							 *
							 * NO FACTOR OF ITS OWN, WHICH IS THE OTHER HALF OF THE ORDERING: the
							 * clause above pays while it has width (its `shrink-[100000]`), and the
							 * moment it has none - or never mounted, which is a settled header at a
							 * narrow column - the deficit is this span's alone at the default 1, and
							 * it takes ALL of it and wraps. Measured in the Chrome this ships on:
							 * at the 640px window the capped line is 52.7px too wide and the row
							 * ends exactly on its own right edge (`lastRight` == the line's right),
							 * where a tuned low factor left the stamp and the time 52px past it.
							 * `truncate` was the older rule and cut the counts; `shrink-0` could say
							 * the first half of this rule and not the second.
							 */
							/*
							 * WHAT `break-words` DOES AND DOES NOT DO HERE (agent review round 2,
							 * R2-1, and QA's Q-r2-3, which measured it served): `overflow-wrap`
							 * cannot act inside a `white-space: nowrap` box, so on the COUNT
							 * LINE's units it is deliberately inert - those hold together, and the
							 * bound that keeps them inside the box is the column floor rather than
							 * a break: the narrowest column the app can give this header is ~350px
							 * (`WINDOW_MIN_WIDTH` 800 and `CHAT_PANE_MIN_PX` 480), and the longest
							 * unit a run can compose is the **241.4px**
							 * `1 workspace_get_gmail_thread_content` - its own box, its text range and a
							 * canvas measure of the same string all read 241.4 on the live
							 * component - and the `many-types-kept` cell photographs it at 420.
							 * On the PROSE form it is the property that does the work: a single
							 * over-long word inside the clause breaks rather than painting past
							 * the box. Round 1's comment claimed the property was protecting the
							 * units, which is exactly the claim this round had to correct.
							 */
							className={cn("min-w-0 break-words text-body-sm text-ink-muted")}
							title={`${actionCount} actions`}
							data-fold-summary=""
						>
							{/*
							 * What the run has done, by class or by kind (`foldSummary`), ONE UNIT PER
							 * SPAN - and the SHAPE decides whether a span may break (R2-1). A count
							 * line's units are unbreakable so its wraps fall at the ` · ` separators
							 * and never inside a phrase (design round 1, D1, where `and 4 other
							 * actions` broke between the numeral and its noun); a SENTENCE is one
							 * unit painted to wrap at its own spaces, which is how prose painted
							 * before this branch and has to keep painting.
							 */}
							{summary.units.map((unit, index) => (
								<Fragment key={unit}>
									{index > 0 && <span aria-hidden="true"> · </span>}
									<span
										className={cn(
											summary.prose ? "whitespace-normal" : "whitespace-nowrap",
										)}
									>
										{unit}
									</span>
								</Fragment>
							))}
						</span>
						{/* NO FAILURE TALLY (operator, 2026-09-29, issue #6): the
						 * fold's `· N failed` chip is retired — a completed run's
						 * failure count is noise at a glance, and the rows (red,
						 * behind the fold) carry the state. */}
						{/*
						 * How many pictures the run produced, as the count the strip cannot
						 * carry at 64px - and the reason this clause is here at all is the
						 * inversion the design round found: the strip's accessible name
						 * stated the count while the visible header said nothing, so a
						 * sighted reader got strictly less than a screen-reader user
						 * (design review round 1, D3). It costs no height: it joins the
						 * facts the header already prints.
						 *
						 * IT DOES COST WIDTH, and that is written down here rather than found
						 * again later: this span is `shrink-0`, so while a call is in flight
						 * the clause is paid for out of the live clause - the row's only
						 * truncating element - and `Running git push origin
						 * feat/condensed-group-images` loses its tail to `…group-…` (design
						 * review round 2, D5, measured on the long-name pair). It stands for
						 * now because both ways to give the characters back change what this
						 * surface's committed frames show - withholding the clause while
						 * live, or shortening it to `· 1 img` - and the frames are the
						 * evidence a reviewer reads, so that is a change taken with a
						 * capture of `image-live` and `long-name` in both palettes rather
						 * than folded into a comment round. No reader is left without the
						 * count in the meantime: the strip renders in this same condensed
						 * window and states it itself - countable while the pictures fit,
						 * `+N more` past the cap.
						 */}
						{foldMediaClause(mediaCount) !== null && (
							<>
								<span
									aria-hidden={true}
									className={cn("text-ink-dim text-meta")}
								>
									·
								</span>
								<span className={cn("shrink-0 text-ink-muted text-meta")}>
									{foldMediaClause(mediaCount)}
								</span>
							</>
						)}
						{/*
						 * The run's own clock, as the sentence's last fact (`3 shell · 1
						 * python · 1 failed · 15s`), matching the foot line's register. It is
						 * the WALL-CLOCK SPAN (first start to last completion), rendered in the
						 * rows' own settled format so it can never print a bare `0s` for a run
						 * of fast calls - and omitted entirely when no stamps exist, because
						 * "we do not know" is a different statement from "no time passed".
						 */}
						{durationText !== "" && (
							<>
								<span
									aria-hidden={true}
									className={cn("text-ink-dim text-meta")}
								>
									·
								</span>
								<span
									data-fold-span=""
									className={cn(
										"shrink-0 font-mono text-ink-dim text-mono-sm tabular-nums",
									)}
								>
									{durationText}
								</span>
							</>
						)}
					</span>
				}
			>
				{/*
				 * ONE CHILD, SO THE BODY'S OWN `gap-2` NEVER SITS BETWEEN ROWS (operator
				 * report, 2026-09-26: "the spacing of the actions under the actions
				 * dropdown ... 2px space between them"). `Disclosure`'s body is
				 * `mt-1 flex flex-col gap-2 pb-1` - an 8px step meant for a stack of
				 * mixed disclosed content - and a run of ledger rows is not that stack:
				 * its rhythm is `transcript-rows.ts`'s `trace` tier, 2px, which each row
				 * already carries as its own top margin. Passing the rows as ONE child
				 * keeps the body's padding (4px above the group) and takes its gap out
				 * of the run, so a folded run measures exactly what the same run measures
				 * unfolded: `N x 20px + (N-1) x 2px`. Same step as `TraceGroup`'s
				 * `gap-0.5`, so the two ways of composing a block agree.
				 */}
				<div className={cn("flex flex-col")}>{children}</div>
			</Disclosure>
			{/*
			 * The run's pictures, while the rows that would draw them are unmounted.
			 *
			 * OUTSIDE the disclosure and below it, so the header keeps its own 24px
			 * pitch and the strip is what the reader gains rather than something the
			 * header now has to trade against. Only while condensed: open, every row
			 * draws its own media and rendering both would show one picture twice.
			 * The fold's own toggle is handed to the node so its count slot can open
			 * the fold (`FoldMedia`'s `onRevealMore`).
			 */}
			{!open && condensedMedia && condensedMedia(revealFromStrip)}
		</div>
	);
};
