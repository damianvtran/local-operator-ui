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
 *   queued     an honest state line; NO generating tile, because nothing is
 *              being generated yet and the tile would borrow running's claim.
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
 * the surface's indeterminate element: `background-position` only, never a
 * layout property, and its keyframes END on a visible frame — `styles/index.css`
 * caps rather than cancels animation under reduced motion, so the cap parks a
 * visible tile instead of an empty box (`--animate-shimmer` carries the same
 * reasoning). PROVISIONAL, pending the design round: while no fraction is
 * known the Progress primitive's indeterminate pulse runs beside the tile's
 * sweep, two motions on one card; if the round reads that as one element too
 * many, the tile's sweep is the one to drop — the bar states the call's
 * progress and the tile is only the picture it stands in for.
 *
 * PROVISIONAL COPY throughout the state lines (the register is settled; the
 * exact words are the design round's to set).
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
 * edge and out the other.
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
			detail = view.argumentBytes > 0 ? formatBytes(view.argumentBytes) : null;
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
			 * a substitute for supplied text. PROVISIONAL fallback copy.
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
	const logTail =
		unsettled && view.progress.logs.length > 0
			? view.progress.logs[view.progress.logs.length - 1]
			: null;
	return (
		<div
			data-imagegen-card={view.state}
			className={cn("flex w-full flex-col gap-2")}
		>
			{unsettled && (view.state === "running" || view.generating) ? (
				<GeneratingTile />
			) : null}
			<StateLine view={view} elapsed={elapsed} />
			{unsettled ? (
				/*
				 * One bar, two modes, both the shared primitive's: no fraction
				 * states the absence (`value={null}` is the primitive's indeterminate
				 * state, and Radix reports it to assistive tech as exactly that); a
				 * fraction fills it. It caps at the tile's width so the card's media
				 * column reads as one edge.
				 */
				<Progress
					aria-label="Image generation progress"
					className={cn("max-w-[240px]")}
					value={
						view.progress.fraction === null
							? null
							: Math.round(
									Math.min(1, Math.max(0, view.progress.fraction)) * 100,
								)
					}
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
