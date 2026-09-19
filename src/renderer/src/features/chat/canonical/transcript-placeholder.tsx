import { Skeleton } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import type { DesktopColdReason } from "../../../../../shared/desktop-session-contract";

/*
 * WHY THIS PLACEHOLDER CAN NOW SAY WHY.
 *
 * The operator's complaint had two halves, and this pane is the second: clicking
 * a quiet owner commits immediately, and the panel then hydrates from the event
 * stream with no client-side bound on the first paint — a 45 s silence watchdog
 * and a renderer retry budget behind it — so up to a minute can pass with
 * nothing on screen but an undifferentiated "Loading conversation…". The row had
 * already said WHICH session this was; what was missing is why the read is slow.
 *
 * THE BACKEND ALREADY MEASURES IT. A cold read comes back with `cold_reason`
 * (`DesktopColdReason`: no pid holds the session's lease, one holds it and did
 * not deliver canonical state, or the record is finishing a turn first) and with
 * `attaching` when a dial is retained and its state has not landed. The tokens
 * are the contract and the SENTENCE IS THE SURFACE'S — the same discipline the
 * error ladder's `code` follows — so the mapping lives here, once, and no other
 * renderer module reads those two fields.
 *
 * THE CAPTION REPLACES "Loading conversation…" RATHER THAN JOINING IT, which is
 * this file's own rule rather than a preference: two claims about one wait is
 * the failure the placeholder's re-homing was for. When nothing is known about
 * why the wait is happening the original words stand unchanged, because a
 * placeholder that guessed a cause would be worse than one that admits it has
 * none — and the caller passes nothing at all for a session-less pane, which has
 * no reason to give.
 *
 * The skeleton bars are untouched: this is a change to WORDS, and the motion, the
 * ink role and the ground were each measured where they stand.
 */
/**
 * What the wait is, in the product's own words, or null when nothing is known.
 *
 * The words follow the row's vocabulary rather than inventing one: a session
 * whose owner stopped reporting is "not answering" everywhere else in the
 * product, and the disk is where this client's reads are answered from whenever
 * no runtime is bound — which is a fact about the mechanism, not a promise that
 * the wait is short.
 */
const waitCaption = (
	reason: DesktopColdReason | null,
	attaching: boolean,
): string | null => {
	if (reason === "owner-silent") return "Not answering — reading it from disk.";
	if (reason === "owner-leaving")
		return "Finishing a turn first — reading from disk.";
	if (reason === "no-runtime")
		return "No runtime is holding it — opening from disk.";
	if (attaching) return "Connected — waiting for its state.";
	return null;
};

/*
 * What a conversation pane shows while its transcript is still in flight.
 *
 * WHERE IT LIVES, and why that is the fix rather than a detail. This used to be
 * rendered inside the composer band, in the greeting's own slot, which is a
 * slot that only exists in the EMPTY-CHAT layout: the band claims the column
 * and centres itself, and the bar sat at the pane's centre. Photographed, that
 * is a different shape from the pane it stands in for - measured on the switch
 * this replaced, the composer's top edge moved 468px -> 736px and the box grew
 * 112px -> 148px at the moment the transcript landed, and the placeholder was a
 * centred 256px line where the transcript is a full-width left-anchored column.
 * A switch that ends by re-shaping the window has not finished registering. So
 * the placeholder renders in the TRANSCRIPT region now, at the same container
 * inset and the same bottom anchor the rows arrive at, and the composer keeps
 * its settled geometry underneath it.
 *
 * THE STEP IS `elevated`, NOT `sunken`, and that is measured rather than
 * preferred. The shared `Skeleton` defaults to `sunken` on the reasoning that
 * content sits on `surface` (deltaE00 4.48); this pane's ground is `canvas`,
 * where `sunken` is the WEAKEST adjacent pair in the system - deltaE00 1.89 in
 * the dark brand palette and 1.25 in `obsidian`, against the perceptual
 * threshold of about 2 that branding.md § 3 records from the captured frames.
 * A placeholder whose entire job is to be seen was standing on the faintest
 * step the system has, so the ROLE was the bug and not the pulse. `elevated` is
 * the next ground up from the pane's own and clears the threshold with margin
 * in every palette: at rest deltaE00 3.90 (rosePineDawn) to 12.40 (radient),
 * measured over all fifty-nine.
 *
 * THE PULSE IS `animate-pulse-visible`, NOT `animate-pulse`, and that is the
 * same argument one level down. Tailwind's pulse is keyed `1 -> 0.5 -> 1`, and
 * on a GROUND that takes the step with it: in the light brand palette the
 * trough delivered deltaE00 1.63 against the pane's own canvas - under the same
 * ~2 aim, in the one state where the pane has nothing else to show (design
 * round 2, D8) - while dark measured 3.42 and cleared it. So the floor moved to
 * 0.7 (`styles/index.css` owns the keyframes and the reasoning): trough deltaE00
 * 3.02 (iceberg) to 9.12 (radient) at the token level across the twelve, and
 * 2.81 measured on the delivered light frame against its own ground (1.63
 * before), 4.26 dark (3.54 before), with rest unmoved at 4.79 / 6.52. The pulse
 * stays because it is what says "working" when the wait is long; it is the step
 * and then the depth of the fade that were wrong, not the motion.
 *
 * THE WORDS ARE VISIBLE. `Loading conversation…` was `sr-only`, so a sighted
 * user got a faint bar and nothing naming the wait, while the state this
 * replaced ("Opening chat…") did have a visible sentence. `text-ink-dim` is the
 * role § 2 assigns to placeholders and clears the 4.5:1 floor on every ground.
 *
 * The bars are sized as prose lines rather than as one centred rule, so what is
 * on screen reads as "the transcript is coming" and not as "this chat is
 * empty"; the last one is shorter so the group has the ragged right edge a
 * paragraph has.
 */

type TranscriptPlaceholderProps = {
	/** Compact spacing below the small-view breakpoint, like the rows it stands in for. */
	isSmallView?: boolean;
	/**
	 * WHY the read this pane is waiting on has not answered, when this session's own
	 * stream has said so (`CanonicalSessionView.coldReason`).
	 *
	 * Optional and defaulted to the unknown case, which is the honest one for the
	 * callers with no session behind them: a staged draft opens no stream at all, so
	 * it has no read to explain.
	 */
	coldReason?: DesktopColdReason | null;
	/** A retained dial whose canonical state has not arrived yet. */
	attaching?: boolean;
};

export const TranscriptPlaceholder: FC<TranscriptPlaceholderProps> = ({
	isSmallView = false,
	coldReason = null,
	attaching = false,
}) => {
	const caption = waitCaption(coldReason, attaching);
	return (
		/*
		 * ONE element, `<output>` rather than a div with role="status": it carries
		 * the same implicit live-region semantics as a native element, which is what
		 * the a11y lint asks for, and the `aria-label` names the region. The visible
		 * caption lives INSIDE it rather than beside it, so the whole placeholder is
		 * one subtree - the transcript's own "is there content yet" reads exclude
		 * this element by that name, and a caption sitting outside it would have read
		 * as a transcript row (which is exactly how it was caught: every hydrating
		 * frame reported itself as settled).
		 *
		 * THE NAME FOLLOWS THE CAPTION, or the region would tell a screen reader
		 * "Loading conversation" while the screen says the read is being answered from
		 * disk. With no reason known it is the original string, which is also the one
		 * the switch rigs select the placeholder by — they stage no cold read, so they
		 * meet it unchanged.
		 */
		<output
			aria-label={caption ?? "Loading conversation"}
			className={cn("flex flex-col gap-2", isSmallView && "gap-1.5")}
		>
			<Skeleton className={cn("h-3 w-56 bg-elevated animate-pulse-visible")} />
			<Skeleton className={cn("h-3 w-80 bg-elevated animate-pulse-visible")} />
			<Skeleton className={cn("h-3 w-64 bg-elevated animate-pulse-visible")} />
			<span className={cn("mt-1 text-ink-dim text-meta")}>
				{caption ?? "Loading conversation…"}
			</span>
		</output>
	);
};
