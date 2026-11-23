import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Info, Lock } from "lucide-react";
import type { FC } from "react";
import {
	TEAM_BRIDGE_ALERT_SEVERITIES,
	type TeamBridgeAlertSeverity,
} from "./team-bridge-alert-model";

/**
 * THE RESPONDER DIALOG (Team Integrations RFC §7.1, §10 items 1-2; design D1;
 * UX Flow D). A member opts THEIR OWN agent in as an alert responder for one
 * channel: an autonomy tier and a minimum severity.
 *
 * WHY IT IS READ-ONLY IN THIS BUILD. The RFC puts the authority to start work
 * from an alert in a machine-local policy (`~/.local-operator/team_bridge/
 * responders.yaml`) that only a human surface may write, behind the same fence
 * as `local_operator/team_bridge/authority.py`, and the save also publishes the
 * consent record to the hub (`PUT .../responders/:endpointid`). Local Operator
 * `main` (checked 2026-11-21) has no supported write path for that policy - no
 * daemon op, no CLI command - and the UI must never write the file itself: a
 * renderer that writes authority files is exactly the bypass the fence exists
 * to prevent. So the dialog shows the choices and their defaults, says plainly
 * that nothing can be saved yet and that the agent is not responding, and
 * offers only Close. When the daemon ships the op, `onSave` is the one seam.
 *
 * THE DEFAULT IS A GROUND STEP, NOT A WASH (D1), AND NOTHING LOOKS LIVE (D6).
 * On the dialog's `elevated` ground, `row-selected` and `accent-wash` fail
 * 59-palette separation, so the default row is `bg-sunken` + `font-medium` +
 * the Default badge. Rows carry `hairline`, never `border-control`: the 3:1
 * control edge says "you can change this", and here nothing can be changed.
 * Rows: "responder summary row" in `contract-tables.mjs`.
 */

export type TeamBridgeResponderTier =
	| "watch"
	| "triage"
	| "prepare"
	| "runbooks";
const TIERS: TeamBridgeResponderTier[] = [
	"watch",
	"triage",
	"prepare",
	"runbooks",
];
/** Not available yet (RFC §15 Q2): drawn so the ladder is legible, never selectable. */
const LOCKED_TIERS = new Set<TeamBridgeResponderTier>(["runbooks"]);

/** The RFC's defaults (§7.1, §7.2): Triage, and sev2 and above. */
export const RESPONDER_DEFAULT_TIER: TeamBridgeResponderTier = "triage";
export const RESPONDER_DEFAULT_MIN_SEVERITY: Exclude<
	TeamBridgeAlertSeverity,
	"unknown"
> = "sev2";

export type TeamBridgeResponderDialogProps = {
	open: boolean;
	channelName: string;
	agentName: string;
	onClose: () => void;
};

export const TeamBridgeResponderDialog: FC<TeamBridgeResponderDialogProps> = ({
	open,
	channelName,
	agentName,
	onClose,
}) => {
	useI18nLocale();
	const tier = RESPONDER_DEFAULT_TIER;
	const minIndex = TEAM_BRIDGE_ALERT_SEVERITIES.indexOf(
		RESPONDER_DEFAULT_MIN_SEVERITY,
	);
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<DialogContent className="max-w-[520px] gap-4" data-responder-dialog="">
				<DialogTitle>
					{t("ui.teamBridge.alerts.responder.title", { channel: channelName })}
				</DialogTitle>
				<DialogDescription className="text-[13px] text-ink-muted">
					{t("ui.teamBridge.alerts.responder.description", {
						agent: agentName,
					})}
				</DialogDescription>
				<p
					role="note"
					data-responder-read-only=""
					className="flex gap-2 rounded-sm bg-info-wash px-3 py-2 text-[13px] text-ink"
				>
					<Info
						size={16}
						aria-hidden="true"
						className="mt-0.5 shrink-0 text-info"
					/>
					<span>
						{t("ui.teamBridge.alerts.responder.read_only", {
							agent: agentName,
						})}
					</span>
				</p>
				{/* A STATIC SUMMARY, NOT A FORM (design D6). Nothing here can be
				    changed, so nothing wears a control's affordance: rows sit on
				    `hairline` (decoration, not the 3:1 control edge), there is no
				    radio or checkbox glyph, and the defaults are marked by a ground
				    step plus the Default badge. A list, so a screen reader hears
				    items rather than disabled inputs it might try to change. */}
				<section
					className="flex flex-col gap-2"
					aria-labelledby="responder-tier-heading"
				>
					<h3
						id="responder-tier-heading"
						className="font-medium text-[13px] text-ink"
					>
						{t("ui.teamBridge.alerts.responder.tier_label", {
							agent: agentName,
						})}
					</h3>
					<ul className="flex flex-col gap-2">
						{TIERS.map((option) => {
							const selected = option === tier;
							const locked = LOCKED_TIERS.has(option);
							return (
								<li
									key={option}
									data-responder-tier={option}
									data-selected={selected || undefined}
									className={cn(
										"flex flex-col gap-0.5 rounded-sm border border-hairline px-3 py-2",
										selected && "bg-sunken",
									)}
								>
									<span className="flex items-center gap-2">
										<span
											className={cn(
												"text-[13px] text-ink",
												selected && "font-medium",
												locked && "text-ink-muted",
											)}
										>
											{t("ui.teamBridge.alerts.responder.tier_name", {
												tier: option,
											})}
										</span>
										{option === RESPONDER_DEFAULT_TIER && (
											<Badge variant="neutral" className="py-0 leading-4">
												{t("ui.teamBridge.alerts.responder.default_badge")}
											</Badge>
										)}
										{locked && (
											<Badge variant="neutral" className="py-0 leading-4">
												<Lock aria-hidden="true" />
												{t("ui.teamBridge.alerts.responder.locked_badge")}
											</Badge>
										)}
									</span>
									<span className="text-meta text-ink-muted">
										{t("ui.teamBridge.alerts.responder.tier_detail", {
											tier: option,
										})}
									</span>
								</li>
							);
						})}
					</ul>
				</section>
				<section
					className="flex flex-col gap-2"
					aria-labelledby="responder-severity-heading"
				>
					<h3
						id="responder-severity-heading"
						className="font-medium text-[13px] text-ink"
					>
						{t("ui.teamBridge.alerts.responder.severity_label", {
							agent: agentName,
						})}
					</h3>
					{/* Only the severities that wake the agent are listed: static
					    text chips, no checkmarks, no unselected "options". */}
					<ul className="flex flex-wrap gap-2" data-responder-severities="">
						{TEAM_BRIDGE_ALERT_SEVERITIES.slice(0, minIndex + 1).map(
							(severity) => (
								<li
									key={severity}
									data-selected=""
									className="flex h-7 items-center rounded-sm border border-hairline bg-sunken px-2.5 text-meta text-ink"
								>
									{t("ui.teamBridge.alerts.severity", {
										level: severity.slice(3),
										worst: "no",
									})}
								</li>
							),
						)}
					</ul>
					<p className="text-meta text-ink-muted">
						{t("ui.teamBridge.alerts.responder.severity_hint", {
							agent: agentName,
						})}
					</p>
				</section>
				<DialogFooter>
					<Button type="button" variant="tonal" onClick={onClose}>
						{t("ui.teamBridge.alerts.responder.close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
