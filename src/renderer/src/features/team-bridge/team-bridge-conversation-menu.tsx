import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@shared/components/ui/dialog";
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
import { isolateLtr, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	Archive,
	Bell,
	BellOff,
	Bot,
	BotOff,
	LogIn,
	LogOut,
	MoreHorizontal,
	UserPlus,
	Users,
} from "lucide-react";
import { type FC, Fragment, type ReactNode } from "react";
import type { TeamBridgeNotify } from "../../../../shared/team-bridge-contract";
import type {
	TeamBridgeConversationMenuItem,
	TeamBridgeMenuDisabledReason,
} from "./team-bridge-conversation-menu-model";
import {
	TEAM_BRIDGE_AGENT_NOTIFY_OPTIONS,
	TEAM_BRIDGE_NOTIFY_OPTIONS,
	asTeamBridgeNotify,
	notificationPreference,
	toggledMuteNotify,
} from "./team-bridge-model";

/**
 * The conversation's Slack-style menu, drawn by THREE openers from ONE item
 * list: the header "…", a rail row's hover/focus "…", and a right-click on that
 * row. `sections` comes from `conversationMenuSections`
 * (`team-bridge-conversation-menu-model.ts`), which owns order and authority;
 * this component only maps item ids to rows, so the openers cannot drift.
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
 * key handler. A radio select closes the menu, which is the confirmation a
 * preference pick needs.
 *
 * RIGHT-CLICK IS THE SAME MENU, NOT A SECOND ONE. The repo's `context-menu.tsx`
 * wrapper carries items only (no radio group, label or separator), and a second
 * component drawing the notify radios would be a second spelling of this one.
 * So a row's `onContextMenu` opens THIS dropdown, controlled through `open` /
 * `onOpenChange`, anchored at the row's trigger.
 *
 * YOUR AGENT. The wake group sets how often the reader's OWN active agent is
 * woken here; it writes a different member row, so muting your banners never
 * silences your agent and vice versa ("Wake your agent for", design round 1 D3).
 *
 * DISABLED, WITH A REASON. An item the hub would refuse here (Leave #general,
 * Remove your agent from #agents) stays in place, disabled, with the reason on
 * a second line: a missing item reads as a bug, a disabled one with its reason
 * tells the reader what to do instead.
 */
export type TeamBridgeConversationMenuHandlers = {
	onNotifyChange?: (notify: TeamBridgeNotify) => void;
	onAgentNotifyChange?: (notify: TeamBridgeNotify) => void;
	onViewMembers?: () => void;
	onAddMembers?: () => void;
	onJoin?: () => void;
	/** Opens the own-agent confirm; the menu itself writes nothing. */
	onOwnAgent?: (
		item: Extract<
			TeamBridgeConversationMenuItem,
			{ id: "remove_agent" | "add_agent" }
		>,
	) => void;
	/** Opens the leave confirm; the menu itself writes nothing. */
	onLeave?: () => void;
	/** Opens the archive confirm (only offered with `can_administer`). */
	onArchive?: () => void;
};

/*
 * The reason a drawn item is disabled. The built-in channel names ride as
 * `{channel}`, isolated LTR, like the members panel's notes (i18n audit on
 * #1670): a literal `#agents` inside right-to-left text reorders to `agents#`.
 */
function reasonText(reason: TeamBridgeMenuDisabledReason): string {
	switch (reason) {
		case "org_wide_membership":
			return t("ui.teamBridge.conversation_menu.reason.org_wide");
		case "agents_builtin":
			return t("ui.teamBridge.conversation_menu.reason.agents_builtin", {
				channel: isolateLtr("#agents"),
			});
		case "general_not_member_yet":
			return t(
				"ui.teamBridge.conversation_menu.reason.general_not_member_yet",
				{
					channel: isolateLtr("#general"),
				},
			);
		case "agent_not_permitted":
			return t("ui.teamBridge.conversation_menu.reason.agent_not_permitted");
	}
}

/** One action row; a disabled one names why underneath its label. */
const ActionRow: FC<{
	icon: ReactNode;
	label: string;
	reason?: TeamBridgeMenuDisabledReason;
	destructive?: boolean;
	onSelect?: () => void;
	testId: string;
}> = ({ icon, label, reason, destructive, onSelect, testId }) => (
	<DropdownMenuItem
		disabled={reason !== undefined || !onSelect}
		destructive={destructive && reason === undefined}
		onSelect={onSelect}
		data-menu-item={testId}
		className={cn(reason && "items-start")}
	>
		{icon}
		<span className="flex min-w-0 flex-1 flex-col">
			<span className="truncate">{label}</span>
			{reason && (
				/* `ink-dim`, not the disabled ink: the reason is the useful part of a
				   row the reader cannot use, and must stay legible (WCAG 1.4.3 exempts
				   the disabled label, not its explanation). */
				<span className="whitespace-normal text-ink-dim text-meta-sm">
					{reasonText(reason)}
				</span>
			)}
		</span>
	</DropdownMenuItem>
);

/** The items, section by section; shared by every opener. */
export const TeamBridgeConversationMenuItems: FC<{
	sections: TeamBridgeConversationMenuItem[][];
	conversation: { notify?: TeamBridgeNotify; muted: boolean };
	/** The reader's own agent's served wake level (null: none reported). */
	agentNotify?: TeamBridgeNotify | null;
	handlers: TeamBridgeConversationMenuHandlers;
}> = ({ sections, conversation, agentNotify = null, handlers }) => {
	const notify = notificationPreference(conversation);
	const muted = notify === "mute";
	const row = (item: TeamBridgeConversationMenuItem): ReactNode => {
		switch (item.id) {
			case "view_members":
				return (
					<ActionRow
						testId={item.id}
						icon={<Users size={16} aria-hidden="true" />}
						label={t("ui.teamBridge.conversation_menu.view_members")}
						onSelect={handlers.onViewMembers}
					/>
				);
			case "add_members":
				return (
					<ActionRow
						testId={item.id}
						icon={<UserPlus size={16} aria-hidden="true" />}
						label={t("ui.teamBridge.members.menu")}
						onSelect={handlers.onAddMembers}
					/>
				);
			case "join":
				return (
					<ActionRow
						testId={item.id}
						icon={<LogIn size={16} aria-hidden="true" />}
						label={t("ui.teamBridge.conversation_menu.join")}
						onSelect={handlers.onJoin}
					/>
				);
			case "notify":
				return (
					<>
						<DropdownMenuItem
							data-menu-item="mute"
							onSelect={() =>
								handlers.onNotifyChange?.(toggledMuteNotify(notify))
							}
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
						<DropdownMenuLabel>
							{t("ui.teamBridge.notify.label")}
						</DropdownMenuLabel>
						{/*
						 * The visible label names the group for a sighted reader; the
						 * aria-label repeats it for a screen reader, which does not
						 * associate a plain menu label with the radio group by proximity.
						 */}
						<DropdownMenuRadioGroup
							value={notify}
							aria-label={t("ui.teamBridge.notify.label")}
							onValueChange={(next) =>
								handlers.onNotifyChange?.(asTeamBridgeNotify(next))
							}
						>
							{TEAM_BRIDGE_NOTIFY_OPTIONS.map((option) => (
								<DropdownMenuRadioItem key={option.value} value={option.value}>
									<span className="min-w-0 flex-1 truncate">
										{t(option.labelKey)}
									</span>
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</>
				);
			case "agent_notify":
				return (
					<>
						<DropdownMenuLabel>
							{t("ui.teamBridge.agentNotify.label")}
						</DropdownMenuLabel>
						{/* Radix's value "" checks no row: the server reported no level. */}
						<DropdownMenuRadioGroup
							value={agentNotify ?? ""}
							aria-label={t("ui.teamBridge.agentNotify.label")}
							onValueChange={(next) =>
								handlers.onAgentNotifyChange?.(asTeamBridgeNotify(next))
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
				);
			case "remove_agent":
				return (
					<ActionRow
						testId={item.id}
						icon={<BotOff size={16} aria-hidden="true" />}
						label={t("ui.teamBridge.conversation_menu.remove_agent", {
							name: item.agentName,
						})}
						reason={item.disabledReason}
						onSelect={
							handlers.onOwnAgent
								? () => handlers.onOwnAgent?.(item)
								: undefined
						}
					/>
				);
			case "add_agent":
				return (
					<ActionRow
						testId={item.id}
						icon={<Bot size={16} aria-hidden="true" />}
						label={t("ui.teamBridge.conversation_menu.add_agent", {
							name: item.agentName,
						})}
						reason={item.disabledReason}
						onSelect={
							handlers.onOwnAgent
								? () => handlers.onOwnAgent?.(item)
								: undefined
						}
					/>
				);
			case "leave":
				return (
					<ActionRow
						testId={item.id}
						destructive
						icon={<LogOut size={16} aria-hidden="true" />}
						label={
							item.kind === "group"
								? t("ui.teamBridge.conversation_menu.leave_group")
								: t("ui.teamBridge.conversation_menu.leave_channel")
						}
						reason={item.disabledReason}
						onSelect={handlers.onLeave}
					/>
				);
			case "archive":
				/* ARCHIVE IS LAST (operator 2026-10-29): the model appends it after
				   every other departure, so nothing can render beneath it. */
				return (
					<ActionRow
						testId={item.id}
						icon={<Archive size={16} aria-hidden="true" />}
						label={t("ui.teamBridge.archive.menu.archive")}
						onSelect={handlers.onArchive}
					/>
				);
		}
	};
	return (
		<>
			{sections.map((section, index) => (
				<Fragment key={section.map((item) => item.id).join(":")}>
					{index > 0 && <DropdownMenuSeparator />}
					{section.map((item) => (
						<Fragment key={item.id}>{row(item)}</Fragment>
					))}
				</Fragment>
			))}
		</>
	);
};

/**
 * The header's "…" (and a story's open menu). The rail row draws the same
 * items through `TeamBridgeRowConversationMenu` in `team-bridge-rail.tsx`.
 */
export const TeamBridgeConversationMenu: FC<{
	sections: TeamBridgeConversationMenuItem[][];
	conversation: { notify?: TeamBridgeNotify; muted: boolean };
	agentNotify?: TeamBridgeNotify | null;
	handlers: TeamBridgeConversationMenuHandlers;
	/** Story/capture seed only: opens the menu so its rows are visible. */
	defaultOpen?: boolean;
}> = ({
	sections,
	conversation,
	agentNotify,
	handlers,
	defaultOpen = false,
}) => {
	useI18nLocale();
	if (sections.length === 0) return null;
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
			<DropdownMenuContent align="end" className="w-64">
				<TeamBridgeConversationMenuItems
					sections={sections}
					conversation={conversation}
					agentNotify={agentNotify}
					handlers={handlers}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/** What the menu's confirm is asking about. */
export type TeamBridgeMenuConfirmSubject =
	| { kind: "leave"; conversationKind: "channel" | "group" }
	| {
			kind: "remove_agent" | "add_agent";
			agentName: string;
			action: "withdraw" | "decline" | "accept" | "add";
	  };

/**
 * The confirm for the menu's departures and the own-agent add, modelled on the
 * members panel's `TeamBridgeMemberConfirmDialog`: the title names the
 * conversation (and the agent), the body states the effect. Leaving and taking
 * your agent out are losses, so they confirm with `danger`; adding your agent
 * back is not, so it stays primary. Not closable while the write is in flight:
 * none of these writes is optimistic, so closing would leave the reader not
 * knowing whether it happened. A refusal is stated inside the dialog, which
 * stays open so Retry is the same button.
 */
export function TeamBridgeMenuConfirmDialog({
	subject,
	conversationName,
	pending,
	error,
	onClose,
	onConfirm,
}: {
	subject: TeamBridgeMenuConfirmSubject | null;
	conversationName: string;
	pending: boolean;
	/** `not_in_general`: the hub's 404 for a #general withdraw with no row yet. */
	error: "error" | "not_in_general" | null;
	onClose: () => void;
	onConfirm: () => void;
}) {
	useI18nLocale();
	const conversation = conversationName;
	const copy = !subject
		? null
		: subject.kind === "leave"
			? {
					title:
						subject.conversationKind === "group"
							? t("ui.teamBridge.conversation_menu.confirm.leave_group_title", {
									conversation,
								})
							: t(
									"ui.teamBridge.conversation_menu.confirm.leave_channel_title",
									{ conversation },
								),
					body: t("ui.teamBridge.conversation_menu.confirm.leave_body"),
					confirm: t("ui.teamBridge.members_panel.confirm.leave"),
					danger: true,
				}
			: subject.kind === "remove_agent"
				? {
						title: t(
							"ui.teamBridge.conversation_menu.confirm.remove_agent_title",
							{ name: subject.agentName, conversation },
						),
						body: t(
							"ui.teamBridge.conversation_menu.confirm.remove_agent_body",
							{ name: subject.agentName },
						),
						confirm: t("ui.teamBridge.members_panel.confirm.remove"),
						danger: true,
					}
				: {
						title: t(
							"ui.teamBridge.conversation_menu.confirm.add_agent_title",
							{ name: subject.agentName, conversation },
						),
						body: t("ui.teamBridge.conversation_menu.confirm.add_agent_body", {
							name: subject.agentName,
						}),
						confirm: t("ui.teamBridge.conversation_menu.confirm.add_agent"),
						danger: false,
					};
	return (
		<Dialog
			open={subject !== null}
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<DialogContent className="gap-4" closeDisabled={pending}>
				<DialogTitle>{copy?.title}</DialogTitle>
				<DialogDescription className="text-[13px] text-ink-muted">
					{copy?.body}
				</DialogDescription>
				{error && (
					<p role="alert" className="text-[12px] text-danger">
						{error === "not_in_general"
							? t("ui.teamBridge.conversation_menu.error.not_in_general", {
									channel: isolateLtr("#general"),
								})
							: t("ui.teamBridge.conversation_menu.error.generic")}
					</p>
				)}
				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						disabled={pending}
						onClick={onClose}
					>
						{t("ui.teamBridge.create.cancel")}
					</Button>
					<Button
						type="button"
						variant={copy?.danger ? "danger" : "primary"}
						disabled={pending}
						onClick={onConfirm}
					>
						{copy?.confirm}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
