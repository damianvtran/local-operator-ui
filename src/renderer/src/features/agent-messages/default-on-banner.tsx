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
 * TURN OFF SAYS WHAT IT TAKES AWAY (design round 1, D1). Turning Team Bridge
 * off also gates the Team Bridge page, conversations included, until the
 * member turns it on again. A quiet band whose main button removes a whole
 * page must say so BEFORE the press, so the hint sits beside the button and
 * is wired to it with `aria-describedby`: a screen reader hears the
 * consequence with the control, not as unrelated body text.
 *
 * LOOK. The info band grammar (`NOTICE_BAND`) with its border made
 * transparent so the wash alone separates it - the borderless rule for quiet
 * chrome, the same call the chief-of-staff hold notice makes. The consent
 * block is a `bg-sunken` step, not a bordered card.
 *
 * This band is multi-row (two to four rows), so it overrides the grammar's
 * `items-center` with `items-start`: centred, the mark slid from beside the
 * body to the middle of the consent block as the band grew (design D2). The
 * Alert's own `mt-px` keeps the mark on the title's first line. The title
 * takes the info ink the Alert gives its `data-alert-mark` slots (title and
 * mark in step), so it carries no ink class of its own (design D5).
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
	const turnOffHintId = useId();
	const busy = pending !== null;
	const turningOff = pending === "turn_off";
	return (
		<section
			data-agent-messages-banner="default-on"
			aria-label={t("ui.agentMessages.banner.title")}
		>
			<Alert
				variant="info"
				className={cn(NOTICE_BAND, "items-start border-transparent")}
			>
				<div className="flex w-full min-w-0 flex-col gap-2">
					<div className="flex w-full min-w-0 items-start gap-3">
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<AlertTitle>{t("ui.agentMessages.banner.title")}</AlertTitle>
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
							aria-describedby={turnOffHintId}
							data-agent-messages-banner-action="turn_off"
						>
							{/*
							 * BOTH LABELS OCCUPY THE SAME CELL, so the button is as wide as
							 * the longer one in every state and "Read what this means" does
							 * not jump 27.5px on the press (design D6). Same mechanism as the
							 * live-updates band's Reload: the idle label is `invisible` and
							 * `aria-hidden`, so it takes space but is not read.
							 */}
							<span className="grid">
								<span
									className={cn(
										"col-start-1 row-start-1",
										turningOff && "invisible",
									)}
									aria-hidden={turningOff}
								>
									{t("ui.agentMessages.banner.turn_off")}
								</span>
								<span
									className={cn(
										"col-start-1 row-start-1",
										!turningOff && "invisible",
									)}
									aria-hidden={!turningOff}
								>
									{t("ui.agentMessages.banner.turning_off")}
								</span>
							</span>
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
						<span
							id={turnOffHintId}
							className="text-pretty text-meta text-ink-muted"
						>
							{t("ui.agentMessages.banner.turn_off_hint")}
						</span>
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
							{/* The well stays full width; only the text is capped at a
							    readable measure. Uncapped it ran ~1011px on a 1440 window
							    (design D3). */}
							{consentText ? (
								<p className="max-w-prose whitespace-pre-wrap text-body-sm text-ink-muted">
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
