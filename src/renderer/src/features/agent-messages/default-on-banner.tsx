import { NOTICE_BAND } from "@shared/components/common/notice-band";
import { Alert, AlertTitle, Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { X } from "lucide-react";
import { useId, useState } from "react";
import type { FC } from "react";
import type {
	DefaultOnFailure,
	DefaultOnPending,
} from "./use-default-on-banner";

export type DefaultOnBannerProps = {
	/**
	 * The status read's served consent text, or null when none is served. It is
	 * rendered VERBATIM: this banner never paraphrases consent, so what the
	 * member reads under "Read what this means" is byte-for-byte what the hub
	 * served for the version the runtime enrolled them under.
	 */
	consentText: string | null;
	pending: DefaultOnPending;
	failure: DefaultOnFailure;
	onTurnOff: () => void;
	onDismiss: () => void;
	/** Story/test seed only: the real expanded state is the reader's own. */
	defaultExpanded?: boolean;
};

/**
 * The first-run notice for default-on (opt-out) Team Bridge.
 *
 * WHY A BANNER AND NOT A DIALOG. Under default-on the member is enrolled
 * before they see anything, and nothing fires at enrolment. Interrupting them
 * with a modal to announce a state that already holds - and that costs
 * nothing to leave alone - would be a consent ceremony with no decision in it.
 * So this is a quiet, dismissible band in the page flow: it never takes
 * focus, never blocks, and is NOT announced: a labelled `<section>` is a
 * landmark a reader can navigate to, not a live region. That is deliberate -
 * nothing here is urgent, and the state it describes already holds.
 *
 * WHAT IT OFFERS, AND WHAT IT DELIBERATELY DOES NOT. Exactly two actions
 * (Turn off, Read what this means) plus a dismiss control. There is no Enable
 * button, no "enable later" cue and no opt-in default-reach line: the product
 * ruling is that the default-on path has no affordance to opt IN to what is
 * already on. A member who turns it off gets back in only through the
 * existing explicit Settings path, never from this band.
 *
 * LOOK. The info band grammar (`NOTICE_BAND`) with its border made
 * transparent so the wash alone separates it - the borderless rule for quiet
 * chrome, the same call the chief-of-staff hold notice makes. The consent
 * block is a `bg-sunken` step, not a bordered card.
 */
export const DefaultOnBanner: FC<DefaultOnBannerProps> = ({
	consentText,
	pending,
	failure,
	onTurnOff,
	onDismiss,
	defaultExpanded = false,
}) => {
	useI18nLocale();
	const [expanded, setExpanded] = useState(defaultExpanded);
	const detailsId = useId();
	const busy = pending !== null;
	return (
		<section
			data-agent-messages-banner="default-on"
			aria-label={t("ui.agentMessages.banner.title")}
		>
			<Alert variant="info" className={cn(NOTICE_BAND, "border-transparent")}>
				<div className="flex w-full min-w-0 flex-col gap-2">
					<div className="flex w-full min-w-0 items-start gap-3">
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<AlertTitle className="text-ink">
								{t("ui.agentMessages.banner.title")}
							</AlertTitle>
							<p className="text-body-sm text-ink-muted">
								{t("ui.agentMessages.banner.body")}
							</p>
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							className="shrink-0 text-ink-muted"
							aria-label={t("ui.agentMessages.banner.dismiss")}
							disabled={busy}
							onClick={onDismiss}
							data-agent-messages-banner-action="dismiss"
						>
							<X aria-hidden="true" />
						</Button>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={onTurnOff}
							data-agent-messages-banner-action="turn_off"
						>
							{pending === "turn_off"
								? t("ui.agentMessages.banner.turning_off")
								: t("ui.agentMessages.banner.turn_off")}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="text-ink"
							aria-expanded={expanded}
							aria-controls={expanded ? detailsId : undefined}
							onClick={() => setExpanded((open) => !open)}
							data-agent-messages-banner-action="read"
						>
							{expanded
								? t("ui.agentMessages.banner.hide")
								: t("ui.agentMessages.banner.read")}
						</Button>
					</div>
					{expanded && (
						<section
							id={detailsId}
							// At the native minimum the full disclosure is taller than the
							// thread pane. Scroll only its text, keeping dismiss/opt-out
							// actions and the composer reachable. The named page container
							// limits this to narrow Bridge panes; approved desktop geometry
							// and Settings' own scrolling remain unchanged (design D2).
							className="rounded-md bg-sunken p-3 @max-[1024px]/bridge:max-h-[35dvh] @max-[1024px]/bridge:overflow-y-auto focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
							aria-label={t("ui.agentMessages.banner.read")}
							data-agent-messages-banner-consent=""
						>
							{consentText ? (
								<p className="whitespace-pre-wrap text-body-sm text-ink-muted">
									{consentText}
								</p>
							) : (
								<p className="text-body-sm text-ink-muted">
									{t("ui.agentMessages.banner.consent_unavailable")}
								</p>
							)}
						</section>
					)}
					{failure && (
						<p role="alert" className="text-body-sm text-ink">
							{failure === "turn_off"
								? t("ui.agentMessages.banner.turn_off_failed")
								: t("ui.agentMessages.banner.dismiss_failed")}
						</p>
					)}
				</div>
			</Alert>
		</section>
	);
};
