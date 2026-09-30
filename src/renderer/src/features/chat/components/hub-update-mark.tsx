/**
 * The chat sidebar's hub-update marks: one per Agents/Teams row, and one quiet
 * strip per section.
 *
 * ## What they are, and what they are not
 *
 * The backend decides everything (which items differ, whether auto-update will
 * take them, what failed); this file only DRAWS `GET /v1/desktop/hub/updates`
 * (`shared/api/local-operator/hub-updates.ts` holds the wording and the
 * decisions about which mark an item gets, and is what the test pins). Nothing
 * here derives policy.
 *
 * ## Subtle by request
 *
 * The operator asked for indicators that show an update exists EVEN WHEN
 * AUTO-UPDATE IS OFF, and asked them to be subtle. So a mark is one 14px glyph
 * in a 24px hit area - the size of the row's own `...` control, which it sits
 * beside - at rest in the muted `ink-dim` register, with colour spent only
 * where a person has something to DO: `accent` for "an update is waiting" and
 * `warning` for "this needs you". Nothing is a badge, a dot with a count or a
 * banner; a row with nothing to say carries nothing, so a user who never used
 * the hub pays zero pixels.
 *
 * ## What moves, and what does not
 *
 * A mark is state-driven (it appears when the poll says so), never
 * hover-driven, and the glyph swap for "updating" / "applied" happens INSIDE the
 * same 24px box, so pressing a mark does not move the name or the `...` beside
 * it. The reserved `...` slot is untouched: the mark is a sibling BEFORE it.
 * What DOES change when the poll first lists an item is the row's name column:
 * it gives up the mark's 24px (+ the row's 4px gap), so a long name truncates 28px
 * earlier. That is the only cost, and it is measured in the long-name frame.
 *
 * "UPDATE ALL" AND THE CHECK CONTROL LIVE IN THE SECTION'S OWN HEADING ROW, which
 * is a fixed 28px, and never in a strip of their own: a strip that appeared at two
 * waiting items and vanished at one moved every row below it by 28px, under the
 * pointer, the moment the person pressed the first of two marks (design round 1,
 * D2). The heading is not sticky for this (the `action` slot pins the row; these
 * are ordinary children), so it costs no height and no pinned chrome.
 *
 * ## The failure belongs to the row
 *
 * A refusal from an update press is drawn as one `text-meta` line under the row
 * (`HubRowNote`) and never as a toast - the hub's one error language. The mark's
 * own persistent state (a failed item the backend still holds) is carried by the
 * glyph, its tooltip and its accessible description, so nothing here needs a
 * second line at rest.
 */

import {
	type HubItemKind,
	type HubMark,
	type HubNote,
	type HubUpdateItem,
	hubMarkAction,
	hubMarkDetail,
	hubMarkLabel,
} from "@shared/api/local-operator/hub-updates";
import { Tooltip } from "@shared/components/ui/tooltip";
import { cn } from "@shared/lib/utils";
import {
	Check,
	CircleAlert,
	CircleArrowDown,
	LoaderCircle,
	RefreshCw,
	TriangleAlert,
} from "lucide-react";
import { useId } from "react";
import { Link } from "react-router-dom";

/**
 * "Update all" is offered from TWO waiting items. With one, the row's own mark
 * is already a single click to the same outcome, and a control that repeated it
 * would be a second thing per section for no extra reach.
 */
const UPDATE_ALL_FROM = 2;

const GLYPH_BY_MARK = {
	available: CircleArrowDown,
	review: CircleAlert,
	failed: TriangleAlert,
	updating: LoaderCircle,
	applied: Check,
} as const;

/*
 * INK: colour is spent only where a person has something to DO, and the two
 * "it needs you" states are told apart by ink as well as by shape (design D6):
 * `warning` is a DECISION (review), `danger` is a FAULT (failed). The spinner is
 * `ink-dim`, not `ink-disabled` (design D4: 2.16:1 dark / 2.76:1 light, below the
 * 3:1 a state indicator needs, and it read as "unavailable" during the one state
 * with a model merge behind it).
 */
const INK_BY_MARK: Record<HubMark["kind"], string> = {
	available: "text-accent",
	review: "text-warning",
	failed: "text-danger",
	updating: "text-ink-dim",
	applied: "text-success",
};

export function HubUpdateMark({
	item,
	mark,
	busy,
	staged,
	onPress,
}: {
	item: HubUpdateItem;
	mark: HubMark;
	/** A press for this item is in flight; the glyph becomes the spinner. */
	busy: boolean;
	/** The row carries the draft ground, which the control's hover step must not paint over. */
	staged: boolean;
	onPress: () => void;
}) {
	const describedBy = useId();
	const shownMark: HubMark = busy ? { kind: "updating" } : mark;
	const shown = shownMark.kind;
	const Glyph = GLYPH_BY_MARK[shown];
	const detail = hubMarkDetail(item, shownMark);
	const action = hubMarkAction(shownMark);
	const inert = shown === "updating" || shown === "applied";
	return (
		// The sidebar's own tooltip, not a native `title`: it opens on keyboard
		// focus (a `title` never does), so a keyboard reader gets the sentence and
		// the action it names (design D3; UX U2).
		<Tooltip
			content={action ? `${detail} ${action}` : detail}
			side="right"
			align="center"
			disableHoverableContent
		>
			<button
				type="button"
				data-hub-mark={shown}
				data-testid={`hub-mark-${item.kind}-${item.name}`}
				className={cn(
					"flex size-6 shrink-0 items-center justify-center rounded-md",
					INK_BY_MARK[shown],
					!staged && !inert && "hover:bg-row-hover",
					"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
				)}
				aria-label={hubMarkLabel(item.name, shownMark)}
				aria-describedby={describedBy}
				// `aria-disabled`, not `disabled`: Chrome blurs a button the moment
				// `disabled` lands, and a keyboard reader who pressed Enter would lose
				// their place in the list for the length of the merge. The press is
				// ignored while it is open instead (the Mark-all-read control's rule).
				aria-disabled={inert || undefined}
				onClick={() => {
					if (inert) return;
					onPress();
				}}
			>
				<Glyph
					className={cn(
						"size-3.5",
						shown === "updating" && "motion-safe:animate-spin",
					)}
					aria-hidden="true"
				/>
				<span id={describedBy} className="sr-only">
					{action ? `${detail} ${action}` : detail}
				</span>
			</button>
		</Tooltip>
	);
}

/**
 * The one line under a row: the answer to the press the person just made. Its left
 * edge is the row LABEL's (design D8), not the disclosure's or the icon's, so it
 * reads as a caption of the name above it.
 */
export function HubRowNote({ note }: { note: HubNote }) {
	return (
		<p
			role={note.tone === "error" ? "alert" : "status"}
			className={cn(
				"pb-1 pl-13 pr-2 text-meta",
				note.tone === "error" ? "text-danger" : "text-ink-muted",
			)}
		>
			{note.message}
		</p>
	);
}

/**
 * The section heading's own controls: "Update all N" and (Agents only) "Check for
 * updates". Drawn INSIDE the fixed-height heading row, so appearing or vanishing
 * moves nothing (see the header).
 */
export function HubHeadingControls({
	kind,
	available,
	busy,
	onUpdateAll,
	onCheck,
	checking,
}: {
	kind: HubItemKind;
	available: number;
	busy: boolean;
	onUpdateAll: () => void;
	/** Present on ONE heading: the check covers both kinds, so a second control would repeat it. */
	onCheck?: () => void;
	checking?: boolean;
}) {
	const offerAll = available >= UPDATE_ALL_FROM;
	if (!offerAll && !onCheck) return null;
	const noun = kind === "agent" ? "agent" : "team";
	return (
		<>
			{offerAll && (
				<button
					type="button"
					data-testid={`hub-update-all-${kind}`}
					aria-label={`Update all ${available} ${noun} updates from the hub`}
					aria-disabled={busy || undefined}
					className={cn(
						"h-6 shrink-0 rounded-md px-1.5 text-meta text-accent",
						"hover:bg-row-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
					)}
					onClick={() => {
						if (!busy) onUpdateAll();
					}}
				>
					{busy ? "Updating…" : `Update all (${available})`}
				</button>
			)}
			{onCheck && (
				<Tooltip content="Check the hub for updates now" side="right">
					<button
						type="button"
						data-testid="hub-check-now"
						aria-label="Check the hub for updates now"
						aria-disabled={checking || undefined}
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-md text-ink-dim",
							"hover:bg-row-hover hover:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
						)}
						onClick={() => {
							if (!checking) onCheck();
						}}
					>
						<RefreshCw
							className={cn("size-3.5", checking && "motion-safe:animate-spin")}
							aria-hidden="true"
						/>
					</button>
				</Tooltip>
			)}
		</>
	);
}

/**
 * The lines a section can carry under its heading: the sign-in sentence (one
 * section only, and a link), the answer to "check now", the roll-up after "Update
 * all", and the refusal of "Update all". Draws NOTHING when there is nothing to say.
 *
 * These are ANSWERS to a press or a backend fact, not resting chrome, so none of
 * them is reserved space; every one of them appears BELOW a control the person
 * just pressed, or (sign-in) only while an item the backend cannot reach exists.
 */
export function HubSectionLines({
	kind,
	signIn,
	signInHref,
	rollup,
	note,
	onDismissRollup,
}: {
	kind: HubItemKind;
	signIn: string | null;
	signInHref: string;
	rollup: string | undefined;
	note: HubNote | undefined;
	onDismissRollup: () => void;
}) {
	if (!signIn && !rollup && !note) return null;
	return (
		<div
			data-hub-strip={kind}
			className="flex flex-col gap-0.5 px-1 pb-1 text-meta text-ink-dim"
		>
			{signIn && (
				<p>
					<Link
						to={signInHref}
						className="rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
					>
						{signIn}
					</Link>
				</p>
			)}
			{note && (
				<p
					role={note.tone === "error" ? "alert" : "status"}
					className={note.tone === "error" ? "text-danger" : undefined}
				>
					{note.message}
				</p>
			)}
			{rollup && (
				<output className="flex items-start justify-between gap-2">
					<span className="min-w-0">{rollup}</span>
					<button
						type="button"
						aria-label="Dismiss update summary"
						className="shrink-0 rounded-sm px-1 hover:text-ink"
						onClick={onDismissRollup}
					>
						Dismiss
					</button>
				</output>
			)}
		</div>
	);
}
