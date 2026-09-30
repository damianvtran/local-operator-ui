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
 */
const SURFACE_LABELS: Record<UpdateType, string> = {
	[UpdateType.UI]: "App updates",
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
					 */
					aria-label={`Announce ${SURFACE_LABELS[type].toLowerCase()}`}
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
			<h3 className="text-body-sm text-ink">Update notifications</h3>
			<p className="mt-0.5 text-meta text-ink-muted">
				How much of a version change raises the update indicator in the window.
				A check you run yourself always reports what it finds.
			</p>
		</div>
		<div className="flex flex-col gap-3">
			<SurfaceRow type={UpdateType.UI} />
			<SurfaceRow type={UpdateType.BACKEND} />
		</div>
	</div>
);
