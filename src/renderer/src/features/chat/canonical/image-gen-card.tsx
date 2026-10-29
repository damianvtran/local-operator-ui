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
 *   queued     an honest state line — its datum slot states how many requests
 *              are ahead ("2 ahead") when the live field carries one, never an
 *              invented number — and
 *              NO generating tile, because nothing is being generated yet and
 *              the tile would borrow running's claim.
 *   running    the media-scale tile with the shimmer sweep, the state line
 *              with the call's own elapsed clock, the progress bar (pulsing
 *              while no fraction is known; the determinate fill when one is),
 *              and the log tail when lines are present.
 *   cancelling the running body with its line swapped, after Stop and until
 *              the interrupt settles; the tile stays while the work does. The
 *              line is the SECURITY ROUND'S split (2026-10-17): a stop pressed
 *              before the provider was called states the no-charge guarantee,
 *              and an in-flight stop states a REQUEST with its billing
 *              consequence and the settlement check that follows it.
 *   done       the artifact under a quiet one-line receipt: a picture through the
 *              EXISTING path (`CanonicalImage` -> `ImageAttachment`, so the
 *              reserved box, the lightbox expansion and the canvas affordance
 *              all come with it), a video through the digest-fed player
 *              (`CanonicalVideo`) — the card mounts each entry by its KIND, one
 *              component per kind, never a picture component over video bytes.
 *              The line's noun follows the card's `material` fact, so a video
 *              call reads `Generated video` and settles its duration the same
 *              way.
 *   failed     the error sentence VERBATIM as the line itself — the frozen
 *              platform `error` is authored to be read as-is and is never
 *              wrapped in a sentence this card substituted for it — and Retry
 *              when wired.
 *   cancelled  a plain state line and the restart slots when wired.
 *
 * AFFORDANCES ARE OPT-IN. The card draws only the controls its `actions`
 * provide (`imageGenCardControls`): integration wires Stop — the existing
 * turn-interrupt path, capability-gated like the composer's Stop — and leaves
 * the restart/steer slots for the round that names them; stories stand those
 * up with stub handlers so the design round can review them. A VIDEO call gets
 * no Stop from its mount at all (contract §4.2: an in-turn press cannot
 * cancel a detached video job; the post-turn rail is the run-details Jobs row),
 * so the absence is the mount's decision and this card only ever draws what it
 * is handed.
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
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	formatBytes,
	formatDuration,
	formatSettledDuration,
} from "../components/trace/tool-row-model";
import { CanonicalAudio } from "./canonical-audio";
import { CanonicalImage } from "./canonical-image";
import { CanonicalVideo } from "./canonical-video";
import {
	CANCEL_QUEUED_COPY,
	CANCEL_RUNNING_COPY,
	type ImageGenActionKind,
	type ImageGenCardActions,
	type ImageGenCardState,
	type ImageGenCardView,
	imageGenCardControls,
	imageGenMaterialNoun,
	withoutSettlementClause,
} from "./image-gen-card-model";
import { SoundBatch } from "./sound-batch";
import { SoundStopConfirmation } from "./sound-stop-confirmation";
import type { AttachmentScope } from "./use-attachment-url";
import { BAR_BASE, BAR_WIDTH, waveformBars } from "./waveform-model";

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

/**
 * The audio generation's tile: a WAVEFORM, not the image loader's rectangle.
 *
 * WHY. A voiceover or a sound effect used to wait behind the image card's
 * 240x160 3:2 picture box with the shimmer sweep, which told the reader a
 * picture was coming. The artifact is a sound, so the loader wears the same
 * band the finished `SoundPlayer` will: the recipe's 4px bars, 2px gaps and 2px
 * radius from `waveform-model.ts`, at the player's own min-height. The card and
 * its settled clip then read as ONE object resolving rather than two languages.
 *
 * INDETERMINATE ONLY, BY CONTRACT. No vendor exposes a progress fraction for
 * sound, and this app must not invent one: the bars move to answer "alive", not
 * "60% done", and no fill, percentage or determinate bar is drawn here. The
 * FOUR STATES are the card's own and differ visibly:
 *
 *   queued    a static band at disabled ink - the READER's queue, not the
 *             provider's work. (The image card draws no tile at all when queued
 *             because a picture's shape is unknown before it exists; a sound's
 *             seat is a band by construction, so showing the empty seat borrows
 *             no running claim.)
 *   running   the same band pulsing bar-by-bar at `ink-muted` - one indefinite
 *             element, the surface's whole motion budget.
 *   failed    the band collapsed to its base line: no shape was produced, and
 *             the card's verbatim error sentence is the announcement.
 *   stopped   the band at rest, at `ink-muted`, with the receipt sentence under
 *             the state line (`soundStopReceipt`) - a stop asked of a provider
 *             with no cancellation endpoint may still be billed.
 *
 * `aria-hidden`: the state line beside it is the announcement, exactly as the
 * image tile's comment states.
 */
/*
 * THE COMPACT PLAYER'S OWN HEIGHT. `SoundPlayer`'s control box is `min-h-11`
 * (44px) in both variants, so a taller loader would make the card shrink 12px
 * the moment the sound settles. The band and the player must occupy the same
 * box for the "one object resolving" claim to survive the transition.
 */
const SOUND_TILE_HEIGHT = 44;
const SOUND_TILE_WIDTH = 240;
const SOUND_TILE_PADDING = 12;
/** A deterministic envelope: the band's shape, never a claim about the sound. */
const SOUND_LOADER_PEAKS = Array.from({ length: 240 }, (_, index) =>
	Math.min(
		1,
		0.18 + Math.abs(Math.sin(index / 7) * Math.cos(index / 17)) * 0.72,
	),
);

function SoundGeneratingTile({
	state,
}: {
	state: "queued" | "running" | "failed" | "stopped";
}) {
	const bars = waveformBars(
		SOUND_LOADER_PEAKS,
		SOUND_TILE_WIDTH - SOUND_TILE_PADDING * 2,
		SOUND_TILE_HEIGHT,
	);
	return (
		<div
			aria-hidden={true}
			data-sound-loading-tile=""
			data-sound-loading={state}
			className={cn(
				"relative flex w-[240px] max-w-full items-center overflow-hidden rounded-sm bg-sunken",
			)}
			style={{ height: SOUND_TILE_HEIGHT }}
		>
			<div
				className={cn("flex w-full items-center")}
				style={{
					paddingLeft: SOUND_TILE_PADDING,
					paddingRight: SOUND_TILE_PADDING,
				}}
			>
				{bars.map((bar, index) => (
					<span
						key={bar.x}
						data-sound-loading-bar=""
						className={cn(
							"shrink-0 rounded-[2px]",
							state === "running"
								? "animate-pulse-visible bg-ink-muted"
								: state === "queued"
									? "bg-ink-disabled"
									: state === "stopped"
										? "bg-ink-dim"
										: "bg-ink-muted",
						)}
						style={{
							width: BAR_WIDTH,
							height: state === "failed" ? BAR_BASE : bar.height,
							marginRight: bar === bars.at(-1) ? 0 : 2,
							animationDelay:
								state === "running" ? `${(index % 12) * 90}ms` : undefined,
						}}
					/>
				))}
			</div>
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
			 * The datum slot, one precedence: a STATED queue depth wins (the
			 * live field's only render, and the fact a waiting reader wants),
			 * then the dictation's byte count when there is one, then nothing —
			 * every branch negativeable, like the progress facts themselves
			 * (round-1 QA Q-1: the slot existed with no consumer before this).
			 *
			 * THE COPY STATES WHAT THE NUMBER COUNTS. `queue_position` is the
			 * count of requests AHEAD of this one (FAL's own semantics; 0 means
			 * nothing is ahead), so "position 3" would read one off — the TUI's
			 * design ruling D3 ("N requests ahead"). "N ahead" is the same
			 * meaning in this card's terse register: the state line already says
			 * "Queued", so the datum only needs the count and its direction, not
			 * the noun again.
			 */
			detail =
				view.queuePosition !== null
					? `${view.queuePosition} ahead`
					: view.argumentBytes > 0
						? formatBytes(view.argumentBytes)
						: null;
			break;
		case "running":
			/*
			 * THE NOUN IS THE MATERIAL FACT (design spec §4, V2; extended by the
			 * sound phase): a video call's line says `Generating video…`, a voiceover
			 * `Generating voiceover…`, a sound effect `Generating sound effect…`, and
			 * nothing else about the line moves. The noun comes off
			 * `imageGenMaterialNoun` so the state line, the done receipt and the
			 * failure fallback cannot spell one material three ways.
			 */
			text = view.batchProgress
				? `Generating ${view.batchProgress.total} ${imageGenMaterialNoun(view.material)}${view.batchProgress.total === 1 ? "" : "s"}…`
				: `Generating ${imageGenMaterialNoun(view.material)}…`;
			detail = elapsed === null ? null : formatDuration(elapsed);
			break;
		case "cancelling":
			/*
			 * THE SECURITY ROUND'S SPLIT (2026-10-17): a stop pressed before the
			 * provider was called is the one case that may claim no charge; an
			 * in-flight stop is a REQUEST — there is no vendor cancel endpoint —
			 * and its line says so, including the settlement check that follows.
			 * Never the no-charge sentence for an in-flight cancel.
			 */
			text = view.generating ? CANCEL_RUNNING_COPY : CANCEL_QUEUED_COPY;
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
					: view.batch
						? `${batchMaterialTitle(view.material)} batch`
						: `Generated ${imageGenMaterialNoun(view.material)}`;
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
			text = view.batch
				? `${batchMaterialTitle(view.material)} batch failed.`
				: (view.message ??
					`The ${imageGenMaterialNoun(view.material)} could not be generated.`);
			emphasis = true;
			break;
		case "cancelled": {
			/*
			 * The settled receipt prefers the TOOL/SERVER detail (`message`); the
			 * canned sentence is only the fallback, and it follows the same
			 * queued/running split the live line does — a settled in-flight stop
			 * must still not read as a no-charge cancellation.
			 *
			 * THE PENDING CLAUSE IS RETIRED BY ITS OWN ANSWER: the settlement row
			 * rendered under this line states the pending fact or the final charge,
			 * so the sentence that asks "Checking for settlement" would either
			 * repeat it or contradict it (design D7, UX U8/U9).
			 */
			const line =
				view.message ??
				(view.generating ? CANCEL_RUNNING_COPY : CANCEL_QUEUED_COPY);
			text = view.batch
				? `${batchMaterialTitle(view.material ?? "sound-effect")} batch stopped.`
				: view.settlementCaption || view.settled
					? withoutSettlementClause(line)
					: line;
			break;
		}
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
function batchMaterialTitle(
	material: Parameters<typeof imageGenMaterialNoun>[0],
): string {
	const noun = imageGenMaterialNoun(material);
	return noun.charAt(0).toUpperCase() + noun.slice(1);
}

function NoteLine({
	line,
	prominent = false,
}: { line: string; prominent?: boolean }) {
	return (
		<p
			data-imagegen-note=""
			className={cn(
				"min-w-0 text-body-sm",
				prominent ? "text-ink-muted" : "text-ink-dim",
			)}
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
	/*
	 * "Stop", not "Cancel": cancellation is a REQUEST (best-effort once the
	 * vendor is working), and the button's own hint states which promise it can
	 * keep — the queued case stops before the call, the running case only asks.
	 * A control labelled "Cancel" would imply a guaranteed stop that the frozen
	 * contract explicitly does not offer.
	 */
	if (kind === "cancel") return "Stop";
	if (kind === "restart") return state === "failed" ? "Retry" : "Restart";
	return "Edit and restart";
}

export const ImageGenCard = ({ view, scope, actions }: ImageGenCardProps) => {
	useI18nLocale();
	const [confirmStop, setConfirmStop] = useState(false);
	const keepWaiting = useCallback(() => setConfirmStop(false), []);
	const root = useRef<HTMLDivElement>(null);
	const wasConfirming = useRef(false);
	useLayoutEffect(() => {
		if (wasConfirming.current && !confirmStop) {
			(
				root.current?.querySelector<HTMLButtonElement>(
					"[data-imagegen-controls] button",
				) ?? root.current
			)?.focus();
		}
		wasConfirming.current = confirmStop;
	}, [confirmStop]);
	useLayoutEffect(() => {
		const card = root.current;
		return () => {
			// If the live row disappears, return the keyboard to its own pane,
			// never a composer belonging to a different conversation.
			if (card?.contains(document.activeElement)) {
				card
					.closest("[data-chat-pane]")
					?.querySelector<HTMLTextAreaElement>("textarea")
					?.focus();
			}
		};
	}, []);
	const soundRunning =
		view.state === "running" &&
		(view.material === "voiceover" || view.material === "sound-effect");
	useEffect(() => {
		if (!soundRunning) setConfirmStop(false);
	}, [soundRunning]);
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
	/*
	 * THE SOUND TILE IS ITS OWN FOUR-STATE SEAT (see `SoundGeneratingTile`).
	 * Image and video keep the rectangular `GeneratingTile`; a sound gets the
	 * waveform in every state the card can be in, including QUEUED (where the
	 * image rule draws nothing, because a picture has no shape yet; a sound's
	 * seat is a band by construction, so the empty seat claims nothing).
	 */
	const material = "material" in view ? view.material : undefined;
	const soundMaterial = material === "voiceover" || material === "sound-effect";
	const soundTileState = !soundMaterial
		? null
		: view.state === "queued"
			? "queued"
			: view.state === "cancelling"
				? view.generating
					? "stopped"
					: null
				: generatingBody
					? "running"
					: view.state === "failed"
						? "failed"
						: view.state === "cancelled"
							? "stopped"
							: null;
	/*
	 * THE STOP RECEIPT, IN THE CARD. The state line carries the honest billing
	 * sentence for a plain cancelled sound, but three paths replace it with
	 * shorter words: a BATCH receipt's title, a wire-supplied `message`, and a
	 * FAILED batch after a mid-flight stop. The fact that the provider has no
	 * cancellation endpoint - and may still bill for audio it produces - must not
	 * disappear behind those words, so it is rendered as its own note exactly
	 * when the line does not already state it.
	 */
	const soundStopReceipt =
		soundMaterial &&
		(view.state === "failed"
			? Boolean(view.batch?.some((item) => item.status === "cancelled"))
			: view.state === "cancelled"
				? Boolean(view.batch?.some((item) => item.status === "cancelled")) ||
					Boolean(view.message)
				: false)
			? CANCEL_RUNNING_COPY
			: null;
	const logTail =
		unsettled && view.progress.logs.length > 0
			? view.progress.logs[view.progress.logs.length - 1]
			: null;
	return (
		<div
			ref={root}
			tabIndex={-1}
			data-imagegen-card={view.state}
			className={cn("flex w-full flex-col gap-2")}
		>
			{soundTileState ? (
				<SoundGeneratingTile state={soundTileState} />
			) : generatingBody ? (
				<GeneratingTile />
			) : null}
			{view.state === "failed" &&
			(view.material === "voiceover" || view.material === "sound-effect") &&
			view.errorType ? (
				<p className={cn("text-meta text-ink-dim")}>{view.errorType}</p>
			) : null}
			<StateLine view={view} elapsed={elapsed} />
			{(view.state === "done" ||
				view.state === "failed" ||
				view.state === "cancelled") &&
			view.costCaption ? (
				<NoteLine line={view.costCaption} prominent={Boolean(view.batch)} />
			) : null}
			{(view.state === "done" ||
				view.state === "failed" ||
				view.state === "cancelled") &&
			view.batchNote ? (
				<NoteLine line={view.batchNote} prominent />
			) : null}
			{view.state === "running" && view.batchProgress?.note ? (
				<NoteLine line={view.batchProgress.note} />
			) : null}
			{view.state === "cancelled" && view.settlementCaption ? (
				<NoteLine line={view.settlementCaption} />
			) : null}
			{soundStopReceipt ? <NoteLine line={soundStopReceipt} /> : null}
			{soundRunning && confirmStop ? (
				<SoundStopConfirmation
					onKeepWaiting={keepWaiting}
					onRequestStop={() => {
						setConfirmStop(false);
						actions?.onCancel?.();
					}}
				/>
			) : null}
			{/*
			 * THE INTERIM'S ACCOUNT (design round 1, D1): the mid-walk failure's
			 * sentence under the live body, verbatim — the call keeps its tile,
			 * clock and Stop while the walk continues, and the note simply
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
					aria-label={t("ui.chat.canonical.image_gen.progress")}
					className={cn("max-w-[240px]")}
					value={Math.round(
						Math.min(1, Math.max(0, view.progress.fraction)) * 100,
					)}
				/>
			) : null}
			{logTail === null ? null : <LogTail line={logTail} />}
			{(view.state === "done" ||
				view.state === "failed" ||
				view.state === "cancelled") &&
			view.batch ? (
				<SoundBatch
					items={view.batch}
					summary={view.batchSummary ?? `${view.batch.length} items`}
					scope={scope}
				/>
			) : view.state === "done" && view.images.length > 0 ? (
				<div className={cn("flex flex-col gap-2")}>
					{/*
					 * THE ONE PLAYER SEAT (design spec §3.3; sound phase extends it). Each
					 * entry mounts by its KIND: a picture through the existing image path,
					 * a video through the digest-fed player, a sound through the audio
					 * player (`CanonicalAudio`) — the reducer admits all three kinds into
					 * `record.images`, and "extend the filter AND the render together" is
					 * exactly this branch. An audio entry is fetched here, the tool row's
					 * media block and the Files/highlight seats; none of them decodes it
					 * as a picture.
					 */}
					{view.images.map((image, index) => {
						/*
						 * THE ENTRY'S KIND PICKS THE PLAYER, AND THE CARD'S MATERIAL PICKS
						 * THE NOUN. A sound entry only knows it is audio; whether it is a
						 * voiceover or a sound effect is the fact `view.material` carries, so
						 * the label reads `Generated voiceover`, never `Generated audio`.
						 */
						const noun = `Generated ${imageGenMaterialNoun(
							image.kind === "audio" ? view.material : (image.kind ?? "image"),
						)}`;
						const label =
							view.images.length === 1 ? noun : `${noun} ${index + 1}`;
						return image.kind === "video" ? (
							<CanonicalVideo
								key={image.id}
								video={image}
								scope={scope}
								label={label}
							/>
						) : image.kind === "audio" ? (
							<CanonicalAudio
								key={image.id}
								audio={image}
								scope={scope}
								label={label}
							/>
						) : (
							<CanonicalImage
								key={image.id}
								image={image}
								scope={scope}
								label={label}
							/>
						);
					})}
				</div>
			) : null}
			{controls.length > 0 && !(soundRunning && confirmStop) ? (
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
							/*
							 * The hint is the contract in one line: a queued stop is
							 * guaranteed; a running one is a request the provider may
							 * ignore (and bill for). Absent on the other controls.
							 */
							title={
								control.kind === "cancel"
									? /*
										 * The hint follows the SAME fact the sentence does:
										 * a call that never started can be stopped for
										 * certain, and one that started can only be asked.
										 * Keying it on the state alone made a `cancelling`
										 * row promise a queued stop after the provider was
										 * already working — the exact inversion the split
										 * exists to prevent.
										 */
										view.state === "queued" ||
										(view.state === "cancelling" && !view.generating)
										? "Stops before the provider is called."
										: "Requests a stop; the provider may finish anyway."
									: undefined
							}
							onClick={
								control.kind === "cancel" && soundRunning
									? () => {
											// A pane Stop may already own the same question.
											const existing = root.current
												?.closest("[data-chat-pane]")
												?.querySelector<HTMLButtonElement>(
													"[data-sound-stop-confirmation] button",
												);
											if (existing) {
												existing.focus();
												return;
											}
											setConfirmStop(true);
										}
									: handlers[control.kind]
							}
						>
							{controlLabel(control.kind, view.state)}
						</Button>
					))}
				</div>
			) : null}
		</div>
	);
};
