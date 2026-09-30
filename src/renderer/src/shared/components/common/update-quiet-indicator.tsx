/**
 * The quiet update indicator: what an unsolicited release looks like now.
 *
 * ## What this replaces, and why
 *
 * Until #672, the app's answer to "there is a new version" was a card pinned
 * `fixed top-4 right-4 z-50` over whatever the person was doing - raised by the
 * start-up check, the five-minute check and the post-wake check, so a busy week
 * of releases interrupted the view several times a day and deferral only
 * silenced the exact version that had already arrived. The card is the right
 * shape for a question someone ASKED (an explicit check) and for the states they
 * deliberately entered (downloading, ready to install, a failure to read); it is
 * the wrong shape for the app's own periodic news.
 *
 * So the unsolicited news lives here: one line in the window's own chrome, at
 * the bottom edge, present only while there is something to say and gone the
 * moment there is not. It says what is waiting and opens the real release detail
 * on a press - the card still exists, one press behind the indicator, and the
 * detail it shows is the same component, with the same notes and remedies.
 *
 * ## Why a band and not a corner chip
 *
 * The card's whole defect was that it PAINTED OVER the view. Moving the same box
 * to another corner with the same `fixed` would have moved the symptom. This is
 * IN FLOW instead - the last row of the shell's own column - so it takes its
 * height out of the layout and can never cover a control, at any copy length.
 * The cost is real and accepted: the band appearing shifts the app up by its own
 * 28px, once per release, at the moment the app is saying something changed.
 * That is the same trade the shell's notice bands already document, and it buys
 * the property that matters: nothing can be hidden.
 *
 * ## Zero pixels at rest
 *
 * With nothing waiting the component renders `null` and the band does not exist
 * - no reserved strip, no empty row for a user who never updates mid-session.
 * `UpdateQuietIndicatorView` is the drawing half and is what the stories and the
 * evidence frames mount, so a state can be photographed without a running
 * updater; the connected half below only decides whether there is anything to
 * draw.
 *
 * ## The bottom-LEFT position is load-bearing
 *
 * Toasts rank `right-4 bottom-4 z-50` (`FloatingAlert`, `ThemedToastContainer`).
 * The indicator shares the bottom edge with them, so it is laid out at the
 * LEADING edge: a band whose last item sat at the trailing edge would be covered
 * by every toast the app raises, which on an update is the exact moment it is
 * needed. Keep the copy short and the row leading-anchored.
 */

import { cn } from "@shared/lib/utils";
import { UpdateType } from "@shared/store/deferred-updates-store";
import {
	NOTICE_SURFACES,
	quietOfferShown,
	useUpdateNoticeStore,
} from "@shared/store/update-notice-store";
import { CircleArrowDown } from "lucide-react";
import { type FC, useMemo } from "react";

/** One surface's waiting release, as the indicator draws it. */
export type QuietIndicatorOffer = {
	type: UpdateType;
	version: string;
};

/**
 * The words for a surface, in one place: the visible text and the label read to
 * assistive tech must agree, and the accessible name begins with the visible
 * text (WCAG 2.5.3, "label in name") - a screen reader user who hears "App
 * update 0.31.0 available" and then finds a control reading "App update 0.31.0"
 * is being asked to guess whether they are the same control.
 */
const SURFACE_COPY: Record<UpdateType, string> = {
	[UpdateType.UI]: "App update",
	[UpdateType.BACKEND]: "Server update",
};

export const UpdateQuietIndicatorView: FC<{
	offers: QuietIndicatorOffer[];
	onOpen: (type: UpdateType) => void;
	/** The rig's hook for a frame; also lets a test scope its query. */
	className?: string;
}> = ({ offers, onOpen, className }) => {
	if (offers.length === 0) return null;
	return (
		/*
		 * `<output>` rather than `<div role="status">`: it IS the status role, and the
		 * semantic element also carries the implicit `aria-live="polite"` - which is
		 * the politeness this notice wants (the app's own periodic news may be
		 * announced when the reader is between tasks, never over what they are
		 * reading, which is the same distinction the card's interruption made badly).
		 * The interactive control inside is a real `<button>`, so it is reachable by
		 * keyboard and carries its own focus ring; the live region announces the text.
		 */
		<output
			data-update-indicator=""
			className={cn(
				"flex h-7 shrink-0 items-center gap-1 border-t border-hairline bg-surface px-2",
				className,
			)}
		>
			{offers.map((offer) => (
				<button
					key={offer.type}
					type="button"
					data-update-indicator-open={offer.type}
					aria-label={`${SURFACE_COPY[offer.type]} ${offer.version} available. Open release details.`}
					className={cn(
						"flex h-6 items-center gap-1.5 rounded-md px-1.5 text-meta text-accent",
						"hover:bg-row-hover",
						/*
						 * `outline`, never a box-shadow ring: this sits inside a scroll-free
						 * band, but the rule is the branding contract's and not a property of
						 * this row - a ring drawn as a shadow is clipped by the first
						 * `overflow: hidden` ancestor a caller adds.
						 */
						"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
					)}
					onClick={() => onOpen(offer.type)}
				>
					<CircleArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
					<span className="whitespace-nowrap">
						{SURFACE_COPY[offer.type]} {offer.version}
					</span>
				</button>
			))}
		</output>
	);
};

/**
 * The connected indicator: what the shell mounts.
 *
 * Reads the store and asks `quietOfferShown` per surface - the same function the
 * tests drive and the same rule the card's own gate uses, so "the indicator is
 * up" and "the card is up" cannot disagree about whether a surface has news.
 */
export const UpdateQuietIndicator: FC = () => {
	const followed = useUpdateNoticeStore((s) => s.followed);
	const running = useUpdateNoticeStore((s) => s.running);
	const offers = useUpdateNoticeStore((s) => s.offers);
	const detailOpen = useUpdateNoticeStore((s) => s.detailOpen);
	const openDetail = useUpdateNoticeStore((s) => s.openDetail);

	const shown = useMemo(() => {
		const state = { followed, running, offers, detailOpen };
		return NOTICE_SURFACES.filter((type) => quietOfferShown(state, type)).map(
			(type) => ({ type, version: offers[type]?.version ?? "" }),
		);
	}, [followed, running, offers, detailOpen]);

	return <UpdateQuietIndicatorView offers={shown} onOpen={openDetail} />;
};
