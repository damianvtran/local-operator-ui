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
 * ## Zero pixels at rest, but the REGION is always there
 *
 * With nothing waiting the component draws no band: no reserved strip, no empty
 * row for a user who never updates mid-session, so the measured property holds -
 * one colour across the whole frame, both themes (`docs/evidence/update-reload-ux/`).
 * What is NOT conditional any more is the `<output>` element itself (review R4):
 * a polite live region is announced when its CONTENT CHANGES, and a region that is
 * inserted already populated is unreliable in NVDA and VoiceOver - the element is
 * therefore mounted empty from the start and the button is rendered INTO it, with
 * `className` applied only while there is something to draw so the empty region
 * carries no box, no border and no height.
 *
 * `UpdateQuietIndicatorView` is the drawing half and is what the stories and the
 * evidence frames mount, so a state can be photographed without a running
 * updater; the connected half below only decides whether there is anything to
 * draw.
 *
 * ## One card at a time, and a press that shows what it pressed
 *
 * A press SWITCHES the detail to the surface it pressed - it closes the other
 * surface's detail on the way in - because the alternative reads as a dead press:
 * with the app card up, pressing the server item used to drop the item out of the
 * band and leave the app card on screen, so the press had no visible effect at all
 * (review U4). The other surface's offer is not consumed by that: closing its
 * detail puts it back in the band, which is what `quietOfferShown` already says.
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
import { type FC, useCallback, useMemo } from "react";

/** One surface's waiting release, as the indicator draws it. */
export type QuietIndicatorOffer = {
	type: UpdateType;
	version: string;
};

/**
 * The words for a surface, in one place: the visible text and the label read to
 * assistive tech must agree, and the accessible name begins with the visible
 * text (WCAG 2.5.3, "label in name") - a screen reader user who hears "App
 * update 0.31.0 available" and then finds a control reading "Application update
 * 0.31.0 available" is being asked to guess whether they are the same control.
 *
 * The WORD "available" IS VISIBLE (reviews D3, U5). It used to live in the
 * `aria-label` alone, and a 28px status row reading "App update 0.30.1" beside a
 * circle-down glyph is as easily "you are on 0.30.1" as "0.30.1 is waiting" - a
 * sighted reader was left to decode the icon, and the string the label-in-name
 * rule compares against was not on screen at all. The band is 720px wide with
 * this copy using ~110px of it, so length was never the constraint.
 */
const SURFACE_COPY: Record<UpdateType, string> = {
	[UpdateType.UI]: "Application update",
	[UpdateType.BACKEND]: "Server update",
};

/**
 * The visible string for one control, and the head of its accessible name.
 *
 * One function for both, so the two cannot drift: the label is this string plus a
 * sentence, which is what keeps the label-in-name rule true by construction.
 */
export const quietOfferText = (offer: QuietIndicatorOffer): string =>
	`${SURFACE_COPY[offer.type]} ${offer.version} available`;

export const UpdateQuietIndicatorView: FC<{
	offers: QuietIndicatorOffer[];
	onOpen: (type: UpdateType) => void;
	/** The rig's hook for a frame; also lets a test scope its query. */
	className?: string;
}> = ({ offers, onOpen, className }) => {
	/*
	 * The region is mounted whether or not there is anything in it (review R4), and
	 * the band's own box only exists while there is: an empty `<output>` with no
	 * classes paints nothing and takes no height, which is the "zero pixels at rest"
	 * property the frames measure.
	 */
	const quiet = offers.length === 0;
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
			data-update-indicator-count={offers.length}
			className={
				quiet
					? undefined
					: cn(
							"flex h-7 shrink-0 items-center gap-1 border-t border-hairline bg-surface px-2",
							className,
						)
			}
		>
			{offers.map((offer) => (
				<button
					key={offer.type}
					type="button"
					data-update-indicator-open={offer.type}
					aria-label={`${quietOfferText(offer)}. Open release details.`}
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
					<span className="whitespace-nowrap">{quietOfferText(offer)}</span>
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
	const closeDetail = useUpdateNoticeStore((s) => s.closeDetail);

	const shown = useMemo(() => {
		const state = { followed, running, offers, detailOpen };
		return NOTICE_SURFACES.filter((type) => quietOfferShown(state, type)).map(
			(type) => ({ type, version: offers[type]?.version ?? "" }),
		);
	}, [followed, running, offers, detailOpen]);

	/*
	 * A press SHOWS WHAT IT PRESSED (review U4). The detail is opened for the
	 * pressed surface and closed for the other one, so the press always changes
	 * something on screen: with the app card up, pressing the server item used to
	 * leave the app card exactly where it was while the item vanished from the band.
	 * The other surface keeps its offer - closing its detail is what puts it back in
	 * the band - so nothing is dropped by the switch.
	 */
	const pressSurface = useCallback(
		(type: UpdateType) => {
			for (const other of NOTICE_SURFACES) {
				if (other !== type) closeDetail(other);
			}
			openDetail(type);
		},
		[closeDetail, openDetail],
	);

	return <UpdateQuietIndicatorView offers={shown} onOpen={pressSurface} />;
};
