/**
 * The generating-image card: the one surface for a tool call in the detection
 * set, placed at the call's position in the transcript.
 *
 * WHY A CARD AND NOT A ROW TREATMENT. The ledger quantises a call into one
 * scannable line, and for most calls that is the whole story. An image
 * generation's product is not a line — it is a picture the reader will look at,
 * produced by a call that may run for minutes — and its progress is the thing
 * being watched while it runs. So the card quantises by STATE (below), and its
 * settled state deliberately gives most of the card back: § 7's "a completed
 * action is one quiet line, not a card".
 *
 * THE SIX STATES, from `ImageGenCardView` (`image-gen-card-model.ts` — the one
 * module that knows the record's fields):
 *
 *   queued     an honest state line — its datum slot states the queue position
 *              when the live field carries one, never an invented number — and
 *              NO generating tile, because nothing is being generated yet and
 *              the tile would borrow running's claim.
 *   running    the media-scale tile with the shimmer sweep, the state line
 *              with the call's own elapsed clock, the progress bar (pulsing
 *              while no fraction is known; the determinate fill when one is),
 *              and the log tail when lines are present.
 *   cancelling the running body with its line swapped, after Cancel and until
 *              the interrupt settles; the tile stays while the work does.
 *   done       the image through the EXISTING path (`CanonicalImage` ->
 *              `ImageAttachment`, so the reserved box, the lightbox expansion
 *              and the canvas affordance all come with it) under a quiet
 *              one-line receipt.
 *   failed     the error sentence VERBATIM as the line itself — the frozen
 *              platform `error` is authored to be read as-is and is never
 *              wrapped in a sentence this card substituted for it — and Retry
 *              when wired.
 *   cancelled  a plain state line and the restart slots when wired.
 *
 * AFFORDANCES ARE OPT-IN. The card draws only the controls its `actions`
 * provide (`imageGenCardControls`): integration wires Cancel — the existing
 * turn-interrupt path, capability-gated like the composer's Stop — and leaves
 * the restart/steer slots for the round that names them; stories stand those
 * up with stub handlers so the design round can review them.
 *
 * THE MOTION BUDGET, stated because this file spends it. The shimmer sweep is
 * the surface's ONE indefinite element (a fraction-less card draws no bar —
 * design round 1, D2): `background-position` only, never a layout property,
 * and its END frame is also the span's RESTING position
 * (`bg-[position:-200%_50%]`, `bg-no-repeat`) — `styles/index.css` caps rather
 * than cancels animation under reduced motion, and the cap parks an animation
 * on its end frame, so a reduced-motion reader gets the band parked off the
 * tile with the `sunken` ground still reading. Both halves were bought with
 * measurements (design round 1, D1): a base of `0%` paints a static half-band,
 * and a REPEATED image — every `±200%` position one image width, the `0%`
 * phase again — both sheens at rest and crosses the tile twice per loop;
 * un-repeated, the band crosses ONCE and its rest is genuinely off the tile.
 * The round's rulings stand: ONE indefinite element per surface, and the
 * sweep is the element that stays — the bar draws only against a carried
 * fraction (D2; `--animate-shimmer` carries the same reasoning).
 *
 * THE COPY IS THE ROUND'S, ACCEPTED AS SHIPPED (design round 1): sentence
 * case, the datum register — the words live in the state lines below. The
 * round left one record for the wiring round: when Retry wires, the fallback
 * sentence is where a remedy clause lands (branding section 8).
 */

import { Button, Progress } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useEffect, useState } from "react";
import {
	formatBytes,
	formatDuration,
	formatSettledDuration,
} from "../components/trace/tool-row-model";
import { CanonicalImage } from "./canonical-image";
import {
	type ImageGenActionKind,
	type ImageGenCardActions,
	type ImageGenCardState,
	type ImageGenCardView,
	imageGenCardControls,
} from "./image-gen-card-model";
import type { AttachmentScope } from "./use-attachment-url";

export type ImageGenCardProps = {
	/** The mapped state, from `imageGenCardView`. The card reads nothing else. */
	view: ImageGenCardView;
	/** The conversation scope the images resolve through, as every row gets it. */
	scope: AttachmentScope | null;
	/** The handlers this surface wired. Absent handler, absent control. */
	actions?: ImageGenCardActions;
};

/**
 * The card's clock — the ledger's own tick (`tool-row.tsx`'s `ROW_CLOCK_MS`;
 * the spec makes the ticking number load-bearing at `CLOCK_INTERVAL_S = 1.0`).
 * Local rather than shared because each row scopes its own timer: a settled
 * transcript of forty rows must hold zero intervals, and a hoisted ticker
 * would repaint every memoised row each second to move one number.
 */
const CARD_CLOCK_MS = 1000;

/**
 * Whole seconds since `startedAtMs`, re-rendered once a second; `null` while
 * there is nothing to count.
 *
 * Seeded synchronously rather than at the first tick, so a card that mounts
 * into an already-running call (a reconnect, a scroll back into view) shows
 * the true elapsed time immediately instead of restarting at zero.
 */
function useElapsedSeconds(startedAtMs: number | null): number | null {
	const [elapsed, setElapsed] = useState<number | null>(() =>
		startedAtMs === null
			? null
			: Math.max(0, (Date.now() - startedAtMs) / 1000),
	);
	useEffect(() => {
		if (startedAtMs === null) {
			setElapsed(null);
			return;
		}
		const read = () =>
			setElapsed(Math.max(0, (Date.now() - startedAtMs) / 1000));
		read();
		const timer = window.setInterval(read, CARD_CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [startedAtMs]);
	return elapsed;
}

/**
 * The media-scale tile the picture will land in, with the shimmer sweeping
 * across it: 240x160 (3:2, the fixtures' own aspect), the `sunken` ground the
 * attachment frames' reserved boxes already use, 6px like every control-scale
 * frame. The sweep's band is `elevated` — an authored ground step, not a hex —
 * over a `background-size` of twice the tile so the band travels in from one
 * edge and out the other; the span's RESTING position is the sweep's end
 * frame (`bg-[position:-200%_50%]`) and the image does NOT repeat
 * (`bg-no-repeat`), which together are what make the reduced-motion cap's
 * parked state the bare tile rather than a sheen — and the loop carry ONE
 * crossing instead of two (header; design round 1, D1).
 *
 * `aria-hidden`: the state line beside it is the announcement, and a decorative
 * field a screen reader cannot describe is not worth announcing (the same rule
 * the placeholder dot follows).
 */
function GeneratingTile() {
	return (
		<div
			aria-hidden={true}
			data-imagegen-tile=""
			className={cn(
				"relative aspect-[3/2] w-[240px] max-w-full overflow-hidden rounded-sm bg-sunken",
			)}
		>
			<span
				className={cn(
					"absolute inset-0",
					"animate-shimmer",
					"bg-gradient-to-r from-transparent via-elevated to-transparent",
					"bg-[length:200%_100%]",
					/*
					 * THE RESTING POSITION IS THE SWEEP'S END FRAME, AND THE IMAGE DOES
					 * NOT REPEAT. Both halves are the fix, measured in pixels (design
					 * round 1, D1): with the inherited `background-repeat: repeat`, the
					 * image is twice the tile, so every `±200%` position is one image
					 * width — the `0%` phase again — and the "rest" was a static sheen
					 * crossing twice per loop; un-repeated, `-200%` is genuinely off the
					 * tile (the bare `sunken` ground) and the loop carries ONE crossing.
					 * The reduced-motion cap parks an animation on its `to` frame — the
					 * contract `--animate-pulse-visible`'s end-opaque keyframe keeps.
					 */
					"bg-[position:-200%_50%]",
					"bg-no-repeat",
				)}
			/>
		</div>
	);
}

/** One state line: the words at body ink, the datum at meta ink beside them. */
function StateLine({
	view,
	elapsed,
}: {
	view: ImageGenCardView;
	elapsed: number | null;
}) {
	let text: string;
	let detail: string | null = null;
	let emphasis = false;
	switch (view.state) {
		case "queued":
			text = view.composing ? "Writing the request…" : "Queued";
			/*
			 * The datum slot, one precedence: a STATED queue position wins (the
			 * live field's only render, and the fact a waiting reader wants),
			 * then the dictation's byte count when there is one, then nothing —
			 * every branch negativeable, like the progress facts themselves
			 * (round-1 QA Q-1: the slot existed with no consumer before this).
			 */
			detail =
				view.queuePosition !== null
					? `position ${view.queuePosition}`
					: view.argumentBytes > 0
						? formatBytes(view.argumentBytes)
						: null;
			break;
		case "running":
			text = "Generating image…";
			detail = elapsed === null ? null : formatDuration(elapsed);
			break;
		case "cancelling":
			text = "Cancelling…";
			break;
		case "done":
			/*
			 * One line either way. `already-finished` is the frozen
			 * `media_already_completed` receipt — a cancel that lost its race
			 * with the finish — so it states the finish and withholds the
			 * duration: that number belongs to the receipt that watched the
			 * run, and this one only heard about it.
			 */
			text =
				view.receipt === "already-finished"
					? "Already finished."
					: "Generated image";
			detail =
				view.receipt === "already-finished" || view.durationS === null
					? null
					: formatSettledDuration(view.durationS);
			break;
		case "failed":
			/*
			 * The frozen shape's sentence, VERBATIM (see the model header): the
			 * platform `error` is authored to be read as-is, so no sentence of
			 * this app's is layered over it. The fallback covers only a record
			 * whose text is ABSENT entirely — it is the absence's sentence, not
			 * a substitute for supplied text. The fallback is the round's accepted
			 * copy too, and the seat its remedy clause lands on when Retry wires
			 * (branding section 8).
			 */
			text = view.message ?? "The image could not be generated.";
			emphasis = true;
			break;
		case "cancelled":
			text = "Cancelled";
			break;
	}
	return (
		<p className={cn("flex min-w-0 items-baseline gap-1.5 text-body-sm")}>
			<span className={cn("min-w-0", emphasis ? "text-ink" : "text-ink-muted")}>
				{text}
			</span>
			{detail === null ? null : (
				<span className={cn("shrink-0 text-meta text-ink-dim")}>
					· {detail}
				</span>
			)}
		</p>
	);
}

/** The log tail: ONE line, and only when the producer stated lines at all. */
function LogTail({ line }: { line: string }) {
	return (
		<p
			data-imagegen-log=""
			title={line}
			className={cn("min-w-0 truncate font-mono text-mono-sm text-ink-dim")}
		>
			{line}
		</p>
	);
}

/**
 * The interim's account under a live body (design round 1, D1): the last
 * frame's own sentence, verbatim — the failed arm's text, not a second
 * sentence of this app's layered over it — in the quiet ink a fact beside a
 * live state takes. It wraps rather than truncating, like the failed arm's
 * own sentence: the text is authored to be read whole.
 */
function NoteLine({ line }: { line: string }) {
	return (
		<p
			data-imagegen-note=""
			className={cn("min-w-0 text-body-sm text-ink-dim")}
		>
			{line}
		</p>
	);
}

/**
 * What each control is called, and it can depend on the state: the same
 * restart slot is `Retry` after a failure and `Restart` after a cancel.
 */
function controlLabel(
	kind: ImageGenActionKind,
	state: ImageGenCardState,
): string {
	if (kind === "cancel") return "Cancel";
	if (kind === "restart") return state === "failed" ? "Retry" : "Restart";
	return "Edit and restart";
}

export const ImageGenCard = ({ view, scope, actions }: ImageGenCardProps) => {
	const startedAtMs =
		view.state === "running" || view.state === "cancelling"
			? view.startedAtMs
			: null;
	const elapsed = useElapsedSeconds(startedAtMs);
	const controls = imageGenCardControls(view, actions);
	const handlers: Record<ImageGenActionKind, (() => void) | undefined> = {
		cancel: actions?.onCancel,
		restart: actions?.onRestart,
		editRestart: actions?.onEditRestart,
	};
	const unsettled = view.state === "running" || view.state === "cancelling";
	/*
	 * THE GENERATING BODY — tile and bar together — follows ONE predicate: a
	 * `running` call had a generation by definition, and a `cancelling` call
	 * keeps its body only if it was already generating. A call that never
	 * generated grows NEITHER a tile nor a bar it never had (round-1 review
	 * F3 put the bar behind the rule the tile already followed).
	 */
	const generatingBody =
		unsettled && (view.state === "running" || view.generating);
	const logTail =
		unsettled && view.progress.logs.length > 0
			? view.progress.logs[view.progress.logs.length - 1]
			: null;
	return (
		<div
			data-imagegen-card={view.state}
			className={cn("flex w-full flex-col gap-2")}
		>
			{generatingBody ? <GeneratingTile /> : null}
			<StateLine view={view} elapsed={elapsed} />
			{/*
			 * THE INTERIM'S ACCOUNT (design round 1, D1): the mid-walk failure's
			 * sentence under the live body, verbatim — the call keeps its tile,
			 * clock and Cancel while the walk continues, and the note simply
			 * disappears with the frame that carried it (a note, never a latch:
			 * nothing the wire does not claim is painted). Only the running state
			 * carries one; the type-guard tolerates hand-built views too.
			 */}
			{view.state === "running" && typeof view.note === "string" ? (
				<NoteLine line={view.note} />
			) : null}
			{generatingBody && view.progress.fraction !== null ? (
				/*
				 * ONE bar, ONE mode: the DETERMINATE fill, drawn only when the
				 * frame carries a fraction. The indeterminate state is deliberately
				 * NOT rendered (design round 1, D2): the tile's sweep is the
				 * surface's one indefinite element (kit section 5), and a
				 * fraction-less full-width bar doubles the rhythm twelve pixels
				 * from the tile while wearing a complete bar's shape - the one
				 * state of the pair that actively misreads when the cap parks it.
				 * The cancelling body loses its bar the same way; it follows the
				 * tile's predicate (`generatingBody`) besides, so a call that never
				 * generated wears neither (round-1 F3). It caps at the tile's width
				 * so the card's media column reads as one edge.
				 */
				<Progress
					aria-label="Image generation progress"
					className={cn("max-w-[240px]")}
					value={Math.round(
						Math.min(1, Math.max(0, view.progress.fraction)) * 100,
					)}
				/>
			) : null}
			{logTail === null ? null : <LogTail line={logTail} />}
			{view.state === "done" && view.images.length > 0 ? (
				<div className={cn("flex flex-col gap-2")}>
					{view.images.map((image, index) => (
						<CanonicalImage
							key={image.id}
							image={image}
							scope={scope}
							label={
								view.images.length === 1
									? "Generated image"
									: `Generated image ${index + 1}`
							}
						/>
					))}
				</div>
			) : null}
			{controls.length > 0 ? (
				/*
				 * Secondary `sm` for all three, which is the app's one quiet control
				 * under a row (`ProviderAction`'s own reasoning): these are remedies
				 * beside a state, never the screen's primary act.
				 */
				<div
					data-imagegen-controls=""
					className={cn("flex items-center gap-2")}
				>
					{controls.map((control) => (
						<Button
							key={control.kind}
							variant="secondary"
							size="sm"
							disabled={control.disabled}
							onClick={handlers[control.kind]}
						>
							{controlLabel(control.kind, view.state)}
						</Button>
					))}
				</div>
			) : null}
		</div>
	);
};
