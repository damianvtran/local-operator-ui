/**
 * The banner that says this conversation's live updates are paused.
 *
 * WHY IT EXISTS. The backend replaces any frame larger than its 1 MiB socket
 * cap with a passive notice (`frontend.update.degraded` / `.paused`, or an
 * `event` whose `action` is `reload`). Before this surface the desktop app
 * folded the notice's empty delta, painted nothing a reader could act on, and
 * went on looking live - a long-lived session simply stopped updating with no
 * affordance. This is the one statement the reader can act on: the view may be
 * stale, and there is a control that repaints it from authoritative history.
 *
 * WHY IT IS SPLIT FROM ITS READINGS (`...View` plus a thin container). Same
 * reason as `BackendCompatibilityBannerView`: the three states - paused,
 * reloading, and not paused (renders nothing) - are conditions of a running
 * stream, so a story cannot arrange them through the hook. The split is what
 * lets the designer review a rendered frame of each state, and what lets the
 * banner stay out of the hook's own render path entirely.
 *
 * THE ONE BAND GRAMMAR, shared with the compatibility banner and the pane's
 * status strip (`NOTICE_BAND`): `Alert` wearing the same compact band inside the
 * pane's own `shrink-0 px-6 py-1` gutter, so one incident's bands read as one
 * family. Severity is `warning`, because a paused stream is not a failure - the
 * conversation is still there and the control repaints it; `danger` is reserved
 * for the failure notice that says the conversation cannot be read at all.
 *
 * COPY. "Paused" is the transport's own word in the notice's vocabulary and the
 * sentence names the consequence (the view may be out of date) rather than the
 * mechanism (a frame budget), which the reader cannot act on. The control is
 * named for what it does - reload from history - not for the socket.
 */

import { NOTICE_BAND } from "@shared/components/common/notice-band";
import { Alert, Button } from "@shared/components/ui";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { t } from "../../../../../i18n/messages";

export type LiveUpdatesPausedBannerViewProps = {
	/** The view has been told its deltas are not arriving; render nothing when false. */
	paused: boolean;
	/** A reload press is out, with no frame yet proving the view current. */
	reloading: boolean;
	onReload: () => void;
};

/**
 * The band itself. Pure: every state the banner has is a prop.
 *
 * `aria-live="polite"` sits on the sentence, which is what announces the
 * transition into "paused" to a reader who is elsewhere on the page - the
 * banner is not a dialog and must not steal focus. `data-lo-live-updates-paused`
 * is the marker the rendered-evidence rig and the QA harness key on: the copy
 * may change with a translation wave, the state may not.
 */
export const LiveUpdatesPausedBannerView = ({
	paused,
	reloading,
	onReload,
}: LiveUpdatesPausedBannerViewProps) => {
	useI18nLocale();
	if (!paused) return null;
	return (
		<div data-lo-live-updates-paused className="shrink-0 px-6 py-1">
			<Alert variant="warning" className={NOTICE_BAND}>
				<div className="flex w-full min-w-0 items-center gap-2">
					<span
						className="min-w-0 flex-1 text-body-sm text-ink"
						aria-live="polite"
					>
						{t("ui.chat.live_updates.paused")}
					</span>
					<span className="flex shrink-0 items-center gap-2">
						{/*
						 * WHILE THE PRESS IS OUT THE CONTROL IS REPLACED BY ITS STATUS WORD,
						 * not shown disabled. A disabled Button renders its label in the
						 * disabled ink role, which is a colour step meant for a control whose
						 * meaning is carried elsewhere - measured in the first capture of this
						 * story, the word was barely legible on the warning wash. The button
						 * has no job while the answer is owed, so the band answers with the
						 * status instead of a control that cannot be used.
						 */}
						{reloading ? (
							<span className="text-body-sm text-ink-muted" aria-live="polite">
								{t("ui.chat.live_updates.reloading")}
							</span>
						) : (
							<Button variant="primary" size="sm" onClick={onReload}>
								{t("ui.chat.live_updates.reload")}
							</Button>
						)}
					</span>
				</div>
			</Alert>
		</div>
	);
};

export type LiveUpdatesPausedBannerProps = {
	paused: boolean;
	reloading: boolean;
	onReload: () => void;
};

/** The container: the handle's fields, forwarded verbatim. */
export const LiveUpdatesPausedBanner = (
	props: LiveUpdatesPausedBannerProps,
) => <LiveUpdatesPausedBannerView {...props} />;
