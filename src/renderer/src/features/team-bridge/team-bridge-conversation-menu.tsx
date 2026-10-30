import { Button } from "@shared/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Archive, Bell, BellOff, MoreHorizontal, UserPlus } from "lucide-react";
import type { FC } from "react";
import type { TeamBridgeNotify } from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_AGENT_NOTIFY_OPTIONS,
	TEAM_BRIDGE_NOTIFY_OPTIONS,
	asTeamBridgeNotify,
	notificationPreference,
	toggledMuteNotify,
} from "./team-bridge-model";

/**
 * The conversation header's Slack-style menu: mute now, or pick a level.
 *
 * WHY TWO CONTROLS FOR ONE VALUE. Slack made the immediate toggle and the
 * preference list different gestures on purpose: a reader who wants silence
 * for the next hour should not have to find a radio row, and a reader who
 * wants only mentions should not have to mute first. Both write the SAME
 * `notify` field, so the checked row and the toggle can never disagree — the
 * menu reads its value through `notificationPreference`, which is also what
 * the rail's bell glyph and the optimistic write use.
 *
 * KEYBOARD AND FOCUS. Radix owns roving focus, arrow navigation,
 * Escape-to-close and focus return to the trigger; this component adds no
 * key handler and does not steal focus on select, because that would duplicate
 * (and could contradict) the primitive. A radio select closes the menu, which
 * is the confirmation a preference pick needs.
 *
 * The caller owns the optimistic write: `onNotifyChange` is called with the
 * next value and the menu closes as soon as it returns. If the server refuses,
 * the hook rolls its cache back and the checked row reappears at the old
 * value on the next paint.
 *
 * YOUR AGENT. When the reader's own agent is an active member, a second radio
 * group sets how often THAT AGENT is woken here: every message (the hub's
 * default; the agent decides whether a reply is needed), @-mentions plus
 * replies in threads it follows, or never - not even for an @-mention. The
 * label is a sentence the rows complete ("Wake your agent for") so the group
 * cannot be scanned as a second copy of the reader's own preferences above it
 * (design round 1, D3). It is a separate group with its own label because it writes a
 * different member row: muting your own banners must never silence your agent,
 * and vice versa. Absent `ownAgent`, nothing is drawn: an invited agent is
 * answered on the Invitations screen and a stranger's agent is not yours to set.
 */
export const TeamBridgeConversationMenu: FC<{
	conversation: { notify?: TeamBridgeNotify; muted: boolean };
	onNotifyChange: (notify: TeamBridgeNotify) => void;
	/**
	 * Present only when the caller may archive this channel (the server's
	 * `can_administer`; never a built-in). Opens the confirm dialog, which is
	 * where the consequence is stated; the menu item itself changes nothing.
	 */
	onArchive?: () => void;
	/** Present only when the server says this caller may administer membership. */
	onAddMembers?: () => void;
	/**
	 * Present only when the reader's own agent is an ACTIVE member here.
	 * `notify` is the level the server reports for that agent row, or null when
	 * it reports none (then no row is checked rather than a guessed one).
	 */
	ownAgent?: { notify: TeamBridgeNotify | null };
	onAgentNotifyChange?: (notify: TeamBridgeNotify) => void;
	/** Story/capture seed only: opens the menu so its rows are visible. */
	defaultOpen?: boolean;
}> = ({
	conversation,
	onNotifyChange,
	onArchive,
	onAddMembers,
	ownAgent,
	onAgentNotifyChange,
	defaultOpen = false,
}) => {
	useI18nLocale();
	const notify = notificationPreference(conversation);
	const muted = notify === "mute";

	return (
		<DropdownMenu defaultOpen={defaultOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					size="icon-sm"
					variant="ghost"
					aria-label={t("ui.teamBridge.menu.label")}
					title={t("ui.teamBridge.menu.label")}
				>
					<MoreHorizontal size={16} aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				{onAddMembers && (
					<>
						<DropdownMenuItem onSelect={onAddMembers}>
							<UserPlus size={16} aria-hidden="true" />
							<span>{t("ui.teamBridge.members.menu")}</span>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuItem
					onSelect={() => onNotifyChange(toggledMuteNotify(notify))}
				>
					{muted ? (
						<Bell size={16} aria-hidden="true" />
					) : (
						<BellOff size={16} aria-hidden="true" />
					)}
					<span>
						{muted
							? t("ui.teamBridge.menu.unmute")
							: t("ui.teamBridge.menu.mute")}
					</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>{t("ui.teamBridge.notify.label")}</DropdownMenuLabel>
				{/*
				 * The visible label above names the group for a sighted reader; the
				 * aria-label repeats it for a screen reader, which does not associate a
				 * plain menu label with the radio group by proximity.
				 */}
				<DropdownMenuRadioGroup
					value={notify}
					aria-label={t("ui.teamBridge.notify.label")}
					onValueChange={(next) => onNotifyChange(asTeamBridgeNotify(next))}
				>
					{TEAM_BRIDGE_NOTIFY_OPTIONS.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value}>
							<span className="min-w-0 flex-1 truncate">
								{t(option.labelKey)}
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{ownAgent && onAgentNotifyChange && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>
							{t("ui.teamBridge.agentNotify.label")}
						</DropdownMenuLabel>
						{/* Radix's value "" checks no row: the server reported no level. */}
						<DropdownMenuRadioGroup
							value={ownAgent.notify ?? ""}
							aria-label={t("ui.teamBridge.agentNotify.label")}
							onValueChange={(next) =>
								onAgentNotifyChange(asTeamBridgeNotify(next))
							}
						>
							{TEAM_BRIDGE_AGENT_NOTIFY_OPTIONS.map((option) => (
								<DropdownMenuRadioItem key={option.value} value={option.value}>
									<span className="min-w-0 flex-1 truncate">
										{t(option.labelKey)}
									</span>
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</>
				)}
				{onArchive && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={onArchive}>
							<Archive size={16} aria-hidden="true" />
							<span>{t("ui.teamBridge.archive.menu.archive")}</span>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
