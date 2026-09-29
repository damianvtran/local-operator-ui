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
 * ## It never reflows the row under the pointer
 *
 * A mark is state-driven (it appears when the poll says so), never
 * hover-driven, and the glyph swap for "updating" / "applied" happens INSIDE the
 * same 24px box, so pressing a mark does not move the name or the `...` beside
 * it. The reserved `...` slot is untouched: the mark is a sibling BEFORE it.
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
	type HubUpdateItem,
	hubMarkDetail,
	hubMarkLabel,
} from "@shared/api/local-operator/hub-updates";
import { cn } from "@shared/lib/utils";
import {
	Check,
	CircleAlert,
	CircleArrowDown,
	LoaderCircle,
	TriangleAlert,
} from "lucide-react";
import { useId } from "react";

/**
 * "Update all" is offered from TWO waiting items. With one, the row's own mark
 * is already a single click to the same outcome, and a strip that repeated it
 * would be a second line of chrome per section for no extra reach - the opposite
 * of the subtle treatment the operator asked for.
 */
const UPDATE_ALL_FROM = 2;

const GLYPH_BY_MARK = {
	available: CircleArrowDown,
	review: CircleAlert,
	failed: TriangleAlert,
	updating: LoaderCircle,
	applied: Check,
} as const;

const INK_BY_MARK: Record<HubMark["kind"], string> = {
	available: "text-accent",
	review: "text-warning",
	failed: "text-warning",
	updating: "text-ink-disabled",
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
	const shown: HubMark["kind"] = busy ? "updating" : mark.kind;
	const Glyph = GLYPH_BY_MARK[shown];
	const detail = hubMarkDetail(item, busy ? { kind: "updating" } : mark);
	const inert = shown === "updating" || shown === "applied";
	return (
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
			aria-label={hubMarkLabel(item.name, busy ? { kind: "updating" } : mark)}
			aria-describedby={describedBy}
			// `aria-disabled`, not `disabled`: Chrome blurs a button the moment
			// `disabled` lands, and a keyboard reader who pressed Enter would lose
			// their place in the list for the length of the merge. The press is
			// ignored while it is open instead (the Mark-all-read control's rule).
			aria-disabled={inert || undefined}
			title={detail}
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
				{detail}
			</span>
		</button>
	);
}

/** The one line under a row: the refusal an update press just got. */
export function HubRowNote({ message }: { message: string }) {
	return (
		<p role="alert" className="pb-1 pl-7 pr-2 text-meta text-danger">
			{message}
		</p>
	);
}

/**
 * The section's own quiet strip: the sign-in line, the roll-up after "Update
 * all", the refusal of "Update all", and the control itself. Draws NOTHING when
 * it has nothing to say, so a section with no hub activity is byte-for-byte
 * what it was.
 *
 * It sits INSIDE the section, under the heading, rather than as a heading
 * action: the heading's `action` slot makes the whole row sticky (the Mark-all-
 * read control's contract), and a control that pins itself to the top of the
 * list for every hub user is louder than "subtle".
 */
export function HubSectionStrip({
	kind,
	available,
	busy,
	signIn,
	rollup,
	failure,
	onUpdateAll,
	onDismissRollup,
}: {
	kind: HubItemKind;
	available: number;
	busy: boolean;
	signIn: string | null;
	rollup: string | undefined;
	failure: string | undefined;
	onUpdateAll: () => void;
	onDismissRollup: () => void;
}) {
	const offerAll = available >= UPDATE_ALL_FROM;
	if (!offerAll && !signIn && !rollup && !failure) return null;
	const noun = kind === "agent" ? "agent" : "team";
	return (
		<div
			data-hub-strip={kind}
			className="flex flex-col gap-0.5 px-1 pb-1 text-meta text-ink-dim"
		>
			{offerAll && (
				<div className="flex h-6 items-center justify-between gap-2">
					<span className="min-w-0 truncate">
						{available === 1
							? `1 ${noun} update on the hub`
							: `${available} ${noun} updates on the hub`}
					</span>
					<button
						type="button"
						data-testid={`hub-update-all-${kind}`}
						aria-disabled={busy || undefined}
						className={cn(
							"shrink-0 rounded-sm px-1 text-meta text-accent underline-offset-2",
							"hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
						)}
						onClick={() => {
							if (!busy) onUpdateAll();
						}}
					>
						{busy ? "Updating…" : "Update all"}
					</button>
				</div>
			)}
			{signIn && <p>{signIn}</p>}
			{rollup && (
				<output className="flex items-center justify-between gap-2">
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
			{failure && (
				<p role="alert" className="text-danger">
					{failure}
				</p>
			)}
		</div>
	);
}
