/**
 * The update foot icon: the standing "a release is waiting" affordance.
 *
 * ## What this replaces
 *
 * Until 2026-09-30 the standing notice was the quiet band - a 28px in-flow row
 * at the window's bottom edge that drew itself the moment any surface had news
 * and stayed until the news was consumed. The band's own header prices that
 * move honestly ("the band appearing shifts the app up by its own 28px"), and
 * the designer consult for the update-rollover lane moved the standing notice
 * into chrome that already exists: this icon, in the sidebar foot, immediately
 * left of the settings gear (`sidebar-navigation.tsx`). The band itself is not
 * gone - it is the notice ON DEMAND now, raised by a press on this icon and
 * lowered by its own dismiss (`update-quiet-indicator.tsx`).
 *
 * ## The five states (design consult §3.4)
 *
 * - **hidden** - nothing waiting and nothing running: ZERO pixels. No button,
 *   no reserved width; the row renders exactly as if this component were not
 *   mounted. A reserved 32px slot that draws nothing is not this state.
 * - **available** - the `circle-arrow-down` glyph, the band's own mark, in
 *   `text-accent`. More than one waiting surface still draws ONE icon; all
 *   versions are named in the tooltip and the accessible name.
 * - **hover** - the app's `Tooltip` (`side="top"`, the 400ms primitive delay),
 *   carrying the band's own sentence per surface plus the press's outcome.
 * - **pressed** - raises the notice band. A press shows the notice; it never
 *   toggles anything off (the band's own dismiss is that control).
 * - **in flight** - a surface is downloading/installing: the mark becomes an
 *   indeterminate arc (`LoaderCircle`, the app's spinner idiom) at the same
 *   16px, NON-interactive (`role="status"`, not a button - there is no cancel,
 *   and a spinner that answers a click with nothing is the dead-end the app's
 *   copy rules refuse).
 *
 * ## Accessibility
 *
 * The button is a real `<button>` in the foot row's tab order, between the
 * account row and the gear (the gear stays the row's last stop). Its accessible
 * name carries the fact itself - never the tooltip alone, which is not
 * available to every user - and begins with the visible text (WCAG 2.5.3):
 * `Application update 0.30.1 available. Show the update notice.` for one
 * surface, `Application update 0.30.1 and server update 0.55.10 available. Show
 * the update notice.` for two. The name is built from the band's own words
 * (`quietOfferSubject`), so the two surfaces cannot drift about what is
 * waiting.
 *
 * NO `aria-live` here: the band is the polite `<output>` region and keeps
 * that; an icon that appears at launch must not be announced as a change to a
 * live region the user did not ask for. The in-flight element is a
 * `role="status"`, which is itself a polite region - and its name is the one
 * thing that changes while an update runs.
 *
 * ## Where the facts come from
 *
 * `update-notice-store`: the offers (from the updater's events), the same
 * `quietOfferShown` gate the band and the card use (so "the icon is up" and
 * "the card is up" cannot disagree about whether a surface has news), and the
 * in-flight flags `UpdateNotification` sets while it downloads or installs.
 * Nothing new is invented here; this component only decides how to draw them.
 */

import { Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { UpdateType } from "@shared/store/deferred-updates-store";
import {
	NOTICE_SURFACES,
	type QuietOffer,
	quietOfferShown,
	useUpdateNoticeStore,
} from "@shared/store/update-notice-store";
import { CircleArrowDown, LoaderCircle } from "lucide-react";
import { type FC, useCallback, useMemo } from "react";
import { quietOfferSubject, quietSurfaceLabel } from "./update-quiet-indicator";

/** One waiting surface as the icon draws it. */
export type FootIconSurface = { type: UpdateType; offer: QuietOffer };

/** The in-flight fact: which surface, and its percent when one is measured. */
export type FootIconInFlight = { type: UpdateType; percent: number | null };

/**
 * The in-flight element's accessible name AND its tooltip line.
 *
 * Per surface, and built from the BAND'S OWN NOUNS (`quietSurfaceLabel` -
 * "Application update" / "Server update") so the two surfaces cannot drift
 * about what is updating (review round 1's NIT: the previous spelling,
 * "Updating the server", was copy that existed nowhere else). `in progress`
 * states the transient fact; the percent rides only where one is measured -
 * the app download reports `download-progress`, the server update reports
 * phases, not percentages - and "0%" is never invented for an unmeasured arm.
 * The name is also what the pointer user reads (review round 1's U3: the arc
 * used to answer nothing on hover).
 */
export const footIconInFlightName = (inflight: FootIconInFlight): string => {
	const subject = quietSurfaceLabel(inflight.type);
	const percent =
		typeof inflight.percent === "number"
			? `, ${Math.round(inflight.percent)}%`
			: "";
	return `${subject} in progress${percent}.`;
};

/** The band's words for one waiting surface, minus the trailing "available". */
const surfaceSubject = (surface: FootIconSurface): string =>
	quietOfferSubject({ type: surface.type, version: surface.offer.version });

/**
 * The accessible name for the available state: the band's own words, joined.
 *
 * The join ("A and B available", one trailing word) is why
 * `quietOfferSubject` exists rather than `quietOfferText` per surface: two
 * "available" words would not be the sentence the consult specified, and the
 * hint sentence is always last. The second subject is LOWERCASED mid-sentence
 * ("... and server update 0.55.10 available") - the consult's own string, and
 * plain English - while a single surface keeps the band's capitalised spelling.
 * Both subjects are ordinary common-noun phrases today; a future surface whose
 * words begin with a proper noun would need this rule re-read, which is why it
 * is stated rather than left as a `.toLowerCase()` on a template.
 */
export const footIconAvailableName = (surfaces: FootIconSurface[]): string => {
	const words = surfaces.map((surface) => surfaceSubject(surface));
	const joined = words
		.map((word, index) =>
			index === 0 ? word : `${word.charAt(0).toLowerCase()}${word.slice(1)}`,
		)
		.join(" and ");
	return `${joined} available. Show the update notice.`;
};

/**
 * The drawing half, mounted directly by the stories and driven by tests.
 *
 * Presentational on purpose: the connected half below only decides WHICH state
 * is live, so every state here is photographable without an updater running.
 */
export const UpdateFootIconView: FC<{
	surfaces: FootIconSurface[];
	inflight: FootIconInFlight | null;
	onShow: () => void;
	/**
	 * Escape while the icon has focus lowers a RAISED band (review round 1's U1):
	 * the icon is where the keyboard reader is when the band it opened is up, and
	 * the same key every overlay in the app answers may not be dead here. Absent
	 * (stories, the view-direct frames) means no Escape handling, because there
	 * is no band for this view to lower.
	 */
	onDismiss?: () => void;
}> = ({ surfaces, inflight, onShow, onDismiss }) => {
	/*
	 * HIDDEN IS RETURNING NOTHING - not a spaced-out empty box. The row's own
	 * `gap-1` between the account row and the gear collapses to one gap, which is
	 * the BEFORE frame byte for byte (design consult §3.4, honest decision 1).
	 */
	if (inflight === null && surfaces.length === 0) return null;
	if (inflight !== null) {
		return (
			/*
			 * `<output>` rather than `<span role="status">`: it IS the status role
			 * and carries the implicit polite live region, the same element choice the
			 * band made for the same reason (the consult names the role; this is the
			 * element that has it structurally, and the a11y linter refuses the
			 * spellable-role version).
			 *
			 * AND IT ANSWERS A HOVER (review round 1's U3): the arc is the state a
			 * pointer user most wants to interrogate, and a bare status element told
			 * them nothing - the same `Tooltip` primitive every other control in the
			 * row carries, with the name it already has for assistive tech. The panel
			 * is not focusable and not clickable (`pointer-events-none`), so this adds
			 * a reading, not a control.
			 */
			<Tooltip
				side="top"
				collisionPadding={8}
				content={footIconInFlightName(inflight)}
			>
				<output
					data-update-foot-icon=""
					data-update-foot-icon-state="inflight"
					aria-label={footIconInFlightName(inflight)}
					className="flex size-8 shrink-0 items-center justify-center text-accent"
				>
					<LoaderCircle
						className="size-4 shrink-0 motion-safe:animate-spin"
						aria-hidden="true"
					/>
				</output>
			</Tooltip>
		);
	}
	/*
	 * The summary is ONE line at most when both surfaces wait: the first readable
	 * one in the notice order. Two summaries would push the tooltip past the
	 * consult's three-line shape, and the summary's job here is orientation
	 * before the press, not a release-notes reader - the card is one press away
	 * and holds the full text.
	 */
	const summarySurface = surfaces.find(
		(surface) => (surface.offer.summary ?? "").trim() !== "",
	);
	return (
		<Tooltip
			side="top"
			/*
			 * 8px OF EDGE PADDING (review round 1's NIT): in the 56px strip the panel
			 * centres over a control at the window's left edge, and with no collision
			 * padding Radix clamped it flush to x=0 - a panel sitting against the
			 * window border reads as cut off. The primitive documents this exact
			 * number for the same reason (the conversation row's flyout, design round
			 * 1's D4).
			 */
			collisionPadding={8}
			content={
				<div className="flex max-w-64 flex-col gap-0.5">
					{surfaces.map((surface) => (
						/*
						 * `truncate`, NOT `whitespace-nowrap` (review round 1's U4): a long
						 * release line measured 327px of scrollWidth in the panel's 238px
						 * content box and ran out of the panel, while the summary line below
						 * ellipsised correctly - one rule for every line now.
						 */
						<span key={surface.type} className="truncate text-ink">
							{surfaceSubject(surface)} available
						</span>
					))}
					{summarySurface ? (
						<span className="truncate text-ink-muted">
							{(summarySurface.offer.summary ?? "").trim()}
						</span>
					) : null}
					<span className="whitespace-nowrap text-ink-muted">
						Show the update notice.
					</span>
				</div>
			}
		>
			<button
				type="button"
				data-update-foot-icon=""
				data-update-foot-icon-state="available"
				aria-label={footIconAvailableName(surfaces)}
				onClick={onShow}
				/*
				 * ESCAPE LOWERS A RAISED BAND (review round 1's U1). The icon keeps the
				 * focus after its own press, so this is the second of the two places a
				 * keyboard reader can be with the band up; `onDismiss` is absent in
				 * stories and view-direct frames, where nothing is raisable.
				 */
				onKeyDown={(event) => {
					if (event.key !== "Escape" || !onDismiss) return;
					event.stopPropagation();
					onDismiss();
				}}
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-sm text-accent",
					"transition-colors duration-fast ease-out-quart",
					// The foot's hover wash, not `Button`'s ghost `accent-wash`: the gear
					// beside it already hovers with this one, and two washes 4px apart in
					// one row read as two systems (design consult §3.2). The ink ALSO
					// flips like the gear's on hover (review round 1's NIT): the consult
					// asked for alignment or disclosure, and alignment is the better
					// read - at rest the accent IS the "something is here" signal, and
					// under the pointer both controls take the active ink together.
					"hover:bg-row-hover hover:text-ink",
				)}
			>
				<CircleArrowDown className="size-4 shrink-0" aria-hidden="true" />
			</button>
		</Tooltip>
	);
};

/**
 * The connected half: the shell/sidebar mounts this.
 *
 * `shown` is computed with the SAME `quietOfferShown` gate the band and the
 * card use, from the same store fields, so the three surfaces cannot disagree
 * about whether a release is news. The in-flight reading is separate from the
 * offers: an update can be in flight with no offer left on the table (the
 * offer is consumed by the press), and the arc must be drawn for the whole of
 * it - that is the state where nothing can be pressed, which is exactly what
 * the arc is for.
 */
export const UpdateFootIcon: FC = () => {
	const followed = useUpdateNoticeStore((s) => s.followed);
	const running = useUpdateNoticeStore((s) => s.running);
	const offers = useUpdateNoticeStore((s) => s.offers);
	const detailOpen = useUpdateNoticeStore((s) => s.detailOpen);
	const inflight = useUpdateNoticeStore((s) => s.inflight);
	const downloadPercent = useUpdateNoticeStore((s) => s.downloadPercent);
	const openNotice = useUpdateNoticeStore((s) => s.openNotice);
	const noticeOpen = useUpdateNoticeStore((s) => s.noticeOpen);
	const dismissNotice = useUpdateNoticeStore((s) => s.dismissNotice);

	const surfaces = useMemo(() => {
		const state = { followed, running, offers, detailOpen };
		return NOTICE_SURFACES.filter((type) => quietOfferShown(state, type))
			.map((type) => {
				const offer = offers[type];
				return offer ? { type, offer } : null;
			})
			.filter((surface): surface is FootIconSurface => surface !== null);
	}, [followed, running, offers, detailOpen]);

	/*
	 * The server's arm wins when both are mid-flight (a server rollover while
	 * the app bundle downloads): it is the one this icon's notice can also be
	 * about, and one role="status" element cannot carry two names. The percent
	 * then belongs to that arm's surface only, so a server arm never borrows the
	 * download's number.
	 */
	const inflightReading = useMemo((): FootIconInFlight | null => {
		if (inflight[UpdateType.BACKEND]) {
			return { type: UpdateType.BACKEND, percent: null };
		}
		if (inflight[UpdateType.UI]) {
			return { type: UpdateType.UI, percent: downloadPercent[UpdateType.UI] };
		}
		return null;
	}, [inflight, downloadPercent]);

	const show = useCallback(() => openNotice(), [openNotice]);
	/*
	 * ESCAPE ON THE ICON ITSELF (review round 1's U1): the band is lowered from
	 * the icon's own key event when it is up, and focus is already on the icon,
	 * so it stays there. Passed only while the band is open, so the key is not
	 * consumed when there is nothing to lower.
	 */
	const dismissRaised = useCallback(() => dismissNotice(), [dismissNotice]);

	return (
		<UpdateFootIconView
			surfaces={surfaces}
			inflight={inflightReading}
			onShow={show}
			onDismiss={noticeOpen ? dismissRaised : undefined}
		/>
	);
};
