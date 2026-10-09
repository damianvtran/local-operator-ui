/**
 * The one-time "delegated sessions were cleaned up" notice.
 *
 * WHY IT EXISTS. Delegated retention is ON by default, so the first launch on a
 * long-lived store removes thousands of subagent and background-run sessions the
 * reader never asked about. Silence would make that look like data loss. The
 * backend announces it once (`delegated_cleanup_notice` on the sessions list)
 * and this is where it is read.
 *
 * THE COPY IS THE BACKEND'S. `message` is finished sentences the terminal
 * prints too, rendered line by line and never re-worded, so the two surfaces
 * cannot say different things about the same removal. What this adds is the
 * way out: `Open settings` lands on the retention rows, and `Dismiss` is the
 * only thing that removes the notice (it is not time-limited: the server will
 * never send it again, see `delegated-cleanup-notice-store.ts`).
 *
 * `in_progress` is the backlog still draining. It changes one thing here, the
 * eyebrow, because the message already carries "so far"; the band must not
 * read as a final tally while removals continue on later launches.
 *
 * Split into a view and a container for the reason the compatibility banner is
 * (`backend-compatibility-banner.tsx`): the view takes props, so each state is
 * a story; the container owns the store and the navigation.
 */

import { NOTICE_BAND } from "@shared/components/common/notice-band";
import { Alert, Button } from "@shared/components/ui";
import { useDelegatedCleanupNoticeStore } from "@shared/store/delegated-cleanup-notice-store";
import { X } from "lucide-react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";
import type { DelegatedCleanupNotice } from "../../../../../shared/desktop-contract";
import { DELEGATED_SECTION } from "../retention-duration";

/** Where `Open settings` lands: the section's own rows, via the page's deep link. */
export const DELEGATED_SETTINGS_HREF =
	"/settings?setting=session.cleanup.delegated.max_age_hours";

export type DelegatedCleanupNoticeViewProps = {
	notice: DelegatedCleanupNotice;
	onOpenSettings: () => void;
	onDismiss: () => void;
};

export const DelegatedCleanupNoticeView: FC<
	DelegatedCleanupNoticeViewProps
> = ({ notice, onOpenSettings, onDismiss }) => {
	const lines = notice.message
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return (
		/*
		 * `<output>` (an implicit polite live region) rather than `role="alert"`:
		 * this is news, not a failure, and it arrives while the reader is doing
		 * something else. The repo's idiom for the same job, see agent-card.tsx.
		 */
		<output
			className="block shrink-0 px-6 py-1"
			data-delegated-cleanup-notice={notice.in_progress ? "draining" : "done"}
			data-delegated-section={DELEGATED_SECTION}
		>
			<Alert variant="info" className={NOTICE_BAND}>
				<div className="flex w-full min-w-0 items-start gap-3">
					<div className="flex min-w-0 flex-1 flex-col gap-0.5 text-body-sm text-ink">
						{lines.map((line, index) => (
							// The first line is the fact; the rest are what to do about it.
							<span
								key={line}
								className={index === 0 ? "text-ink" : "text-ink-muted"}
							>
								{line}
							</span>
						))}
					</div>
					<span className="flex shrink-0 items-center gap-1">
						<Button variant="ghost" size="sm" onClick={onOpenSettings}>
							Open settings
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onDismiss}
							aria-label="Dismiss this notice"
						>
							<X aria-hidden="true" />
						</Button>
					</span>
				</div>
			</Alert>
		</output>
	);
};

/** Mounted in the conversation pane beside the other notice bands. */
export const DelegatedCleanupNoticeBand: FC = () => {
	const notice = useDelegatedCleanupNoticeStore((state) => state.notice);
	const dismiss = useDelegatedCleanupNoticeStore((state) => state.dismiss);
	const navigate = useNavigate();
	if (!notice) return null;
	return (
		<DelegatedCleanupNoticeView
			notice={notice}
			onDismiss={dismiss}
			onOpenSettings={() => navigate(DELEGATED_SETTINGS_HREF)}
		/>
	);
};
