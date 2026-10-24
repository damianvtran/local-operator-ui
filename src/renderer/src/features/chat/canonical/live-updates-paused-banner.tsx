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
 * reason as `BackendCompatibilityBannerView`: the states - paused, reloading,
 * failed, and not paused (renders nothing) - are conditions of a running
 * stream, so a story cannot arrange them through the hook. The split is what
 * lets the designer review a rendered frame of each state, and what lets the
 * banner stay out of the hook's own render path entirely.
 *
 * THE ONE BAND GRAMMAR, shared with the compatibility banner and the pane's
 * status strip (`NOTICE_BAND`): `Alert` wearing the same compact band inside
 * the host column's own `px-6` gutter, so one incident's bands read as one
 * family. Severity is `warning`, because a paused stream is not a failure - the
 * conversation is still there and the control repaints it; `danger` is reserved
 * for the failure notice that says the conversation cannot be read at all.
 *
 * THE COLUMN CONTRACT IS TWO ELEMENTS, like `QuestionDock`. The host
 * (`chat-content`) carries `CHAT_COLUMN_CONTAINER` + `CHAT_COLUMN_INSET`; the
 * BAND carries `CHAT_MEASURE`, handed in through `className`. That is what makes
 * the Alert span the composer's full 810px: putting the measure and the inset on
 * one element charged the 24px gutter to the measure (810 - 48 = 762px), so the
 * band sat 24px inside the composer at every wide column (design round 2, D1).
 * The root carries no horizontal padding of its own.
 *
 * COPY. "Paused" is the transport's own word in the notice's vocabulary and the
 * sentence names the consequence (the view may be out of date) rather than the
 * mechanism (a frame budget), which the reader cannot act on. The control is
 * named for what it does - reload from history - not for the socket. A press
 * that spent the retry budget says so, in place of the paused sentence, so a
 * failed reload is not a silent reversion to a button.
 */

import { COMPOSER_TEXTAREA_SELECTOR } from "@features/chat/composer-field";
import { NOTICE_BAND } from "@shared/components/common/notice-band";
import { Alert, Button } from "@shared/components/ui";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useLayoutEffect, useRef } from "react";
import { t } from "../../../../../i18n/messages";

export type LiveUpdatesPausedBannerViewProps = {
	/** The view has been told its deltas are not arriving; render nothing when false. */
	paused: boolean;
	/** A reload press is out, with no frame yet proving the view current. */
	reloading: boolean;
	/** The last press spent the retry budget without an answer. */
	reloadFailed: boolean;
	/** The host's column measure, applied by the mount that knows the column. */
	className?: string;
	onReload: () => void;
};

/**
 * The band itself. Pure enough to be driven by every state a story can name.
 *
 * THE CONTROL'S NODE IS KEPT WHILE IT IS OUT (UX round 1, U4). Swapping the
 * `Button` for a status word unmounted the focused element on the reader's own
 * press and dropped focus to `body`; the label changes instead, and
 * `aria-disabled` says the control will take nothing until the answer lands.
 * The node survives the press AND the clear, so a keyboard reader never loses
 * their place.
 *
 * `data-lo-live-updates-paused` is the marker the rendered-evidence rig and the
 * QA harness key on: the copy may change with a translation wave, the state may
 * not.
 */
export const LiveUpdatesPausedBannerView = ({
	paused,
	reloading,
	reloadFailed,
	className,
	onReload,
}: LiveUpdatesPausedBannerViewProps) => {
	useI18nLocale();
	const rootRef = useRef<HTMLDivElement>(null);
	/*
	 * WHEN THE BAND ITSELF GOES, FOCUS GOES SOMEWHERE REAL. A snapshot clears the
	 * flag and unmounts this subtree; a keyboard reader who was on the control
	 * would otherwise land on `body` with nothing announced. The hand-off is the
	 * composer's own textarea, found by the selector the app's other focus
	 * repairs use - and only when focus was actually inside this band, so a
	 * reader typing elsewhere is never moved.
	 */
	useLayoutEffect(
		() => () => {
			const root = rootRef.current;
			if (!root?.contains(document.activeElement)) return;
			document
				.querySelector<HTMLTextAreaElement>(COMPOSER_TEXTAREA_SELECTOR)
				?.focus();
		},
		[],
	);
	if (!paused) return null;
	return (
		<div
			ref={rootRef}
			data-lo-live-updates-paused
			className={cn("w-full shrink-0 py-1", className)}
		>
			<Alert variant="warning" className={NOTICE_BAND}>
				<div className="flex w-full min-w-0 flex-wrap items-center gap-2">
					{/*
					 * A 200px basis is what makes the ACTION drop under the sentence
					 * before the sentence collapses. Below it, a long locale at a
					 * narrow column kept 0-68px of text width with the button held
					 * `shrink-0` beside it (design round 1, D2); the basis is a floor
					 * for the sentence, not a width for the band.
					 */}
					<span
						className="min-w-0 flex-1 basis-[200px] text-body-sm text-ink"
						aria-live="polite"
					>
						{reloadFailed
							? t("ui.chat.live_updates.reload_failed")
							: t("ui.chat.live_updates.paused")}
					</span>
					<span className="ms-auto flex min-h-7 shrink-0 items-center gap-2">
						<Button
							variant="primary"
							size="sm"
							/*
							 * `aria-disabled`, not `disabled`: the native attribute takes
							 * the node out of the tab order and blurs it, which is the
							 * focus loss this shape exists to avoid. The handler is
							 * removed for the same span, so the control is inert while
							 * still announcing itself.
							 */
							aria-disabled={reloading || undefined}
							onClick={reloading ? undefined : onReload}
							aria-live="polite"
						>
							{/*
							 * BOTH LABELS OCCUPY THE SAME CELL, so the control's width is
							 * the wider of the two in every state. Without it a narrow
							 * column's band dropped 101px -> 65px on the reader's own press,
							 * because "Reloading…" is narrower than "Reload from history"
							 * (design round 2, D3 residual). The hidden label is `invisible`
							 * and `aria-hidden`, so it takes space but is not read.
							 */}
							<span className="grid">
								<span
									className={cn(
										"col-start-1 row-start-1",
										reloading && "invisible",
									)}
									aria-hidden={reloading}
								>
									{t("ui.chat.live_updates.reload")}
								</span>
								<span
									className={cn(
										"col-start-1 row-start-1",
										!reloading && "invisible",
									)}
									aria-hidden={!reloading}
								>
									{t("ui.chat.live_updates.reloading")}
								</span>
							</span>
						</Button>
					</span>
				</div>
			</Alert>
		</div>
	);
};

export type LiveUpdatesPausedBannerProps = LiveUpdatesPausedBannerViewProps;

/** The container: the handle's fields, forwarded verbatim. */
export const LiveUpdatesPausedBanner = ({
	...props
}: LiveUpdatesPausedBannerProps) => <LiveUpdatesPausedBannerView {...props} />;
