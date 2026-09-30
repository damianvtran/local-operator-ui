/**
 * The "how much of a change is news" control (issue #672).
 *
 * The app raises an unsolicited indicator when either half of the installation
 * has a release waiting, and both halves ship often - so the preference is per
 * SURFACE rather than one setting, because the two are not equally interesting
 * to the same person: the server moves on every release, the app bundle much
 * less often.
 *
 * WHAT THIS DOES NOT DO is silence an answer. These preferences gate the app's
 * own periodic news; a check the user runs from the button below reports what it
 * found whatever these are set to, which is why the sentence above the controls
 * says so rather than leaving the reader to infer it from a missing notice.
 *
 * The rules themselves are in `@shared/utils/update-segment` - pure, so the
 * cases that matter (an unorderable version, a same-triple respelling, each of
 * the three settings) are driven by a test rather than by clicking through
 * Settings.
 */

import { Select } from "@shared/components/ui";
import {
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui/select";
import { cn } from "@shared/lib/utils";
import { UpdateType } from "@shared/store/deferred-updates-store";
import { useUpdateNoticeStore } from "@shared/store/update-notice-store";
import {
	FOLLOWED_SEGMENTS,
	FOLLOWED_SEGMENT_COPY,
	type FollowedSegment,
} from "@shared/utils/update-segment";
import type { FC } from "react";

/**
 * The surface names, in the order the two rows are listed.
 *
 * The same words the indicator itself prints, so the thing being configured is
 * recognisable from the setting: a user who has seen "Server update 0.55.10" in
 * the chrome is looking for the row that governs it.
 *
 * ## One word for the app, on every surface
 *
 * The row labels, the band's own copy and this section's heading all say
 * APPLICATION (reviews D3, D10): the block below sits under "Application updates
 * and info", the settings sidebar's rail names it the same way, and a dozen other
 * sentences in the app send the reader to "Settings, under Application updates" -
 * so "App updates" here and "App update" in the band were two names for one thing
 * inside a single screen, and the band's 110-odd characters of copy have the room
 * (the band is 720px wide with its text using about 110px of it, measured).
 */
const SURFACE_LABELS: Record<UpdateType, string> = {
	[UpdateType.UI]: "Application updates",
	[UpdateType.BACKEND]: "Server updates",
};

const SurfaceRow: FC<{ type: UpdateType }> = ({ type }) => {
	const followed = useUpdateNoticeStore((state) => state.followed[type]);
	const setFollowedSegment = useUpdateNoticeStore(
		(state) => state.setFollowedSegment,
	);
	return (
		<div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
			<div className="min-w-0">
				<div className="text-body-sm text-ink">{SURFACE_LABELS[type]}</div>
				<div className="mt-0.5 text-meta text-ink-muted">
					{FOLLOWED_SEGMENT_COPY[followed].description}
				</div>
			</div>
			<Select
				value={followed}
				onValueChange={(value) =>
					setFollowedSegment(type, value as FollowedSegment)
				}
			>
				<SelectTrigger
					/*
					 * A bare `aria-label`: Radix's trigger renders a button and there is no
					 * `<label for>` to point at it, so the surface name has to live on the
					 * control itself or a screen reader hears three listboxes called
					 * "Every release" with nothing saying which half of the app each one
					 * governs.
					 *
					 * AND IT CARRIES THE VISIBLE VALUE (review D9). The trigger's visible text
					 * is the selected option, so a name of "Announce application updates" alone
					 * named a control the sighted user cannot see the like of - the same
					 * label-in-name rule (WCAG 2.5.3) the band's own header cites, applied to
					 * the one control on this page that did not follow it.
					 */
					aria-label={`${SURFACE_LABELS[type]}: ${FOLLOWED_SEGMENT_COPY[followed].label}`}
					className="w-full sm:w-56"
					data-followed-segment={type}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{FOLLOWED_SEGMENTS.map((segment) => (
						<SelectItem
							key={segment}
							value={segment}
							/*
							 * The description rides the item's `title`, following the convention
							 * the settings registry's own enums use: an OPEN listbox is a
							 * portal-rendered popper that no committed frame can photograph, so
							 * a sentence laid out inside the item would be a visual change no
							 * design round could review.
							 */
							title={FOLLOWED_SEGMENT_COPY[segment].description}
						>
							{FOLLOWED_SEGMENT_COPY[segment].label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
};

export const UpdateFollowing: FC = () => (
	<div className={cn("flex flex-col gap-3")}>
		<div>
			{/*
			 * THE HEADING IS A HEADING (review D2). It was `text-body-sm`, the row labels'
			 * own class, so three same-weight lines stacked before the first control and
			 * the only thing distinguishing the block's top was a `gap-3` - which is the
			 * step its neighbours use for a SECTION heading (`SettingsSection`'s own h2,
			 * `mcp-management-section`'s inner h3), so the block now has a top rather
			 * than a third label.
			 */}
			<h3 className="text-heading text-ink">Update notifications</h3>
			{/*
			 * WHAT THE READER SEES, NOT WHAT THE APP CALLS IT (review D6): "raises the
			 * update indicator" named a component the user has never been shown. The
			 * notice is the strip at the bottom of the window, and that is how the
			 * sentence names it.
			 */}
			<p className="mt-1 text-meta text-ink-muted">
				How much of a version change shows the update notice at the bottom of
				the window. A check you run yourself always reports what it finds.
			</p>
		</div>
		<div className="flex flex-col gap-3">
			<SurfaceRow type={UpdateType.UI} />
			<SurfaceRow type={UpdateType.BACKEND} />
		</div>
	</div>
);
