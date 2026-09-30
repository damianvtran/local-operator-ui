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
import { quietOfferSubject } from "./update-quiet-indicator";

/** One waiting surface as the icon draws it. */
export type FootIconSurface = { type: UpdateType; offer: QuietOffer };

/** The in-flight fact: which surface, and its percent when one is measured. */
export type FootIconInFlight = { type: UpdateType; percent: number | null };

/**
 * The in-flight element's accessible name.
 *
 * Per surface, because the two channels say different true things: the server
 * channel is this lane's rollover ("Updating the server"), the app channel is
 * the application bundle ("Updating the application"). The percent rides only
 * where one is measured - the app download reports `download-progress`; the
 * server update reports phases, not percentages - and "0%" is never invented
 * for an unmeasured arm.
 */
export const footIconInFlightName = (inflight: FootIconInFlight): string => {
	const subject =
		inflight.type === UpdateType.BACKEND
			? "Updating the server"
			: "Updating the application";
	const percent =
		typeof inflight.percent === "number"
			? `, ${Math.round(inflight.percent)}%`
			: "";
	return `${subject}${percent}.`;
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
}> = ({ surfaces, inflight, onShow }) => {
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
			 */
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
			content={
				<div className="flex max-w-64 flex-col gap-0.5">
					{surfaces.map((surface) => (
						<span key={surface.type} className="whitespace-nowrap text-ink">
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
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-sm text-accent",
					"transition-colors duration-fast ease-out-quart",
					// The foot's hover wash, not `Button`'s ghost `accent-wash`: the gear
					// beside it already hovers with this one, and two washes 4px apart in
					// one row read as two systems (design consult §3.2). The ink stays
					// accent on hover - the accent IS the "something is here" reading.
					"hover:bg-row-hover",
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

	return (
		<UpdateFootIconView
			surfaces={surfaces}
			inflight={inflightReading}
			onShow={show}
		/>
	);
};
