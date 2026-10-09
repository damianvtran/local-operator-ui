/**
 * The one-time "delegated sessions were cleaned up" notice.
 *
 * WHY IT EXISTS. Delegated retention is ON by default, so the first launch on a
 * long-lived store removes thousands of subagent and background-run sessions the
 * reader never asked about. Silence would make that look like data loss. The
 * backend announces it on the sessions list (`delegated_cleanup_notice`) and this
 * is where it is read.
 *
 * THE COPY IS THE BACKEND'S. `message` is finished sentences the terminal
 * prints too, rendered line by line and never re-worded, so the two surfaces
 * cannot say different things about the same removal. What this adds is the
 * way out: `Open settings` lands on the retention rows, and `Dismiss` clears
 * the held copy AND acknowledges the notice for the store
 * (`dismissDelegatedCleanupNotice`; the route keeps serving the field until
 * that write lands, so a failed ack only means the band may reappear - there is
 * nothing to tell the reader about it).
 *
 * `in_progress` is the backlog still draining. It does not change a word here -
 * the message already carries "so far" - and its one effect is the
 * `data-delegated-cleanup-notice` attribute ("draining" vs "done"), which is
 * what the capture rigs and the stories read the state by. The band must not
 * read as a final tally while removals continue on later launches.
 *
 * Split into a view and a container for the reason the compatibility banner is
 * (`backend-compatibility-banner.tsx`): the view takes props, so each state is
 * a story; the container owns the store and the navigation.
 */

import { dismissDelegatedCleanupNotice } from "@shared/api/local-operator/desktop-api";
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

/**
 * The backend's own record-line label, mirrored from
 * `delegated_retention.format_delegated_notice` ("Record: {record}").
 *
 * Used only to RECOGNISE the message's record line: recognition is
 * byte-for-byte, so a backend that rewords the label simply falls back to
 * rendering the line verbatim like every other line.
 */
const RECORD_LINE_PREFIX = "Record: ";

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
						{lines.map((line, index) =>
							/*
							 * The record line gets the machine voice its path is owed
							 * (branding §4: paths are monospace - the same treatment `lop exec`
							 * gets in the retention copy). Rendered from the structured field
							 * so the path is the wire's, with the label the backend wrote; the
							 * line is recognised byte-for-byte, so a reworded backend falls back
							 * to the verbatim rendering below rather than being rewritten here.
							 */
							notice.record &&
							line === `${RECORD_LINE_PREFIX}${notice.record}` ? (
								<span key={line} className="text-ink-muted">
									{RECORD_LINE_PREFIX}
									<code className="font-mono">{notice.record}</code>
								</span>
							) : (
								// The first line is the fact; the rest are what to do about it.
								<span
									key={line}
									className={index === 0 ? "text-ink" : "text-ink-muted"}
								>
									{line}
								</span>
							),
						)}
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
	const navigate = useNavigate();
	if (!notice) return null;
	return (
		<DelegatedCleanupNoticeView
			notice={notice}
			onDismiss={dismissDelegatedCleanupNotice}
			onOpenSettings={() => navigate(DELEGATED_SETTINGS_HREF)}
		/>
	);
};
