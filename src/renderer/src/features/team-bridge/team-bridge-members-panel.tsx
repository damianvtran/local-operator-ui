import { PanelEdge } from "@shared/components/common/panel-edge";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import { Tooltip } from "@shared/components/ui/tooltip";
import { isolateLtr, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { LogOut, Search, UserPlus, UserRoundX, X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
} from "../../../../shared/team-bridge-contract";
/*
 * The transcript's hover-reveal rule, imported rather than re-spelled (the
 * add-members dialog does the same): hover, focus-within, and always shown
 * where there is no hover, so a keyboard or touch reader still meets the
 * row's action.
 */
import { actionRowVisibility } from "../chat/canonical/message-actions";
import {
	MEMBER_PANEL_SEARCH_THRESHOLD,
	type TeamBridgeMemberPanelRow,
	type TeamBridgeMemberRowAction,
	groupByKind,
	matchesMemberQuery,
	memberPanelNote,
	memberPanelRows,
} from "./team-bridge-members-model";
import { composeChiefLabel } from "./team-bridge-model";
import { TeamBridgeAvatar } from "./team-bridge-profile-card";
import { manageThreadFocus } from "./team-bridge-thread-focus";

/*
 * THE MEMBERS PANEL: the header's member count, opened (operator 2026-11-04:
 * "currently there's no great way to see all the members in a channel/group").
 *
 * It is the Slack pattern - the count is a button, the room opens in the right
 * drawer, and each row carries the one action its reader may take - placed in
 * the SAME slot, with the same geometry, as the thread pane, so the two never
 * compete: the page opens one or the other, never both.
 *
 * Presentation only. Who may do what is `memberPanelRows` (the hub's own
 * authority rules, see `team-bridge-members-model.ts`); what a confirmed action
 * does is the page's `onAction`, which reaches the server and resolves or
 * rejects. A refusal is shown here, inline, under the header.
 */

export type TeamBridgeMembersPanelProps = {
	conversation: TeamBridgeConversation;
	/** The conversation's organization directory: photos and current names. */
	people: readonly TeamBridgeDirectoryMember[];
	selfAccountId?: string;
	/** The conversation as its header names it, for the confirm copy. */
	conversationName: string;
	/** Present only when the reader may invite (`canInviteMembers`). */
	onAddMembers?: () => void;
	/**
	 * Perform a confirmed row action. Resolves when the server accepted it; a
	 * rejection keeps the panel open with the refusal stated inline.
	 */
	onAction?: (
		row: TeamBridgeMemberPanelRow,
		action: TeamBridgeMemberRowAction,
	) => Promise<unknown>;
	onClose: () => void;
	/**
	 * THE SUB-IDENTITY SEAM (B3, truthful sender). An agent row today reads one
	 * label - "Aida (Damian Tran)" - for every agent. B3 will distinguish an
	 * owner's chief of staff from their task agents, but its label grammar is
	 * not settled (design: ~/radient-ml/qa-evidence/b3-truthful-sender/DESIGN.md,
	 * not yet written). When it is, return the chip for an agent row here; the
	 * row renders it after the name and before the role/state chips. Absent,
	 * nothing extra is drawn.
	 */
	agentIdentityChip?: (row: TeamBridgeMemberPanelRow) => ReactNode;
	/** Story/test seed: the search query on mount. */
	initialQuery?: string;
	/** Story/test seed: open the confirm for this row key on mount. */
	initialConfirmKey?: string;
	/** Story/test seed: show the inline refusal on mount. */
	initialError?: boolean;
};

const GROUP_HEADING = "px-5 pt-3 pb-1 text-meta text-ink-dim";

/** The rows' avatar: the directory row is the photo's only source. */
function MemberAvatar({
	row,
	people,
}: {
	row: TeamBridgeMemberPanelRow;
	people: readonly TeamBridgeDirectoryMember[];
}) {
	const { member } = row;
	/* A participant missing from the directory (a departed account, a roster
	   still loading) gets a minimal synthetic row with no `avatar_url`, so the
	   plate falls back to the initial / Bot glyph, never a broken image. */
	const person = people.find(
		(entry) => entry.account_id === member.account_id,
	) ?? {
		account_id: member.account_id,
		display_label: row.label,
		role: "member",
		bridge_enabled: false,
		bridge_state: "none" as const,
	};
	const endpoint = (member as { endpoint_id?: unknown }).endpoint_id;
	return (
		<TeamBridgeAvatar
			member={person}
			kind={member.kind}
			/* The plate asks `useIdentityAvatar` for the DPR-appropriate variant of
			   this CSS size, so a 28px row on a 2x panel reads the sharper file. */
			endpointId={typeof endpoint === "string" ? endpoint : undefined}
			label={row.label}
			size={28}
			/* No radius here: the plate is `rounded-full` since #1668 (§ 5's avatar
			   shape), and a host radius would win through tailwind-merge. */
			className="size-7 text-meta"
		/>
	);
}

/** The icon, accessible name and tooltip of a row's action. */
function actionPresentation(
	action: TeamBridgeMemberRowAction,
	label: string,
): { icon: ReactNode; name: string; tooltip: string } {
	switch (action) {
		case "leave":
			return {
				icon: <LogOut aria-hidden="true" />,
				name: t("ui.teamBridge.members_panel.leave_label"),
				tooltip: t("ui.teamBridge.members_panel.leave_tooltip"),
			};
		case "decline":
			return {
				icon: <UserRoundX aria-hidden="true" />,
				name: t("ui.teamBridge.members_panel.decline_label", { name: label }),
				tooltip: t("ui.teamBridge.members_panel.decline_tooltip"),
			};
		default:
			return {
				icon: <UserRoundX aria-hidden="true" />,
				name: t("ui.teamBridge.members.remove_label", { name: label }),
				tooltip: t("ui.teamBridge.members.remove_tooltip"),
			};
	}
}

export function TeamBridgeMembersPanel({
	conversation,
	people,
	selfAccountId,
	conversationName,
	onAddMembers,
	onAction,
	onClose,
	agentIdentityChip,
	initialQuery = "",
	initialConfirmKey,
	initialError = false,
}: TeamBridgeMembersPanelProps) {
	const locale = useI18nLocale();
	const chiefLabel = useCallback(
		(agent: string, person: string) =>
			composeChiefLabel(agent, person, {
				named: (agentName, personName) =>
					t("ui.teamBridge.chief.label", {
						agent: agentName,
						person: personName,
					}),
				unnamed: (personName) =>
					t("ui.teamBridge.chief.unnamed", { person: personName }),
			}),
		[],
	);
	/* Derived from the cached conversation alone, so a refetch or a join/leave
	   membership event re-renders the panel; it keeps no copy of the room. */
	const rows = useMemo(
		() =>
			memberPanelRows(conversation, people, selfAccountId, chiefLabel, locale),
		[conversation, people, selfAccountId, chiefLabel, locale],
	);
	const [query, setQuery] = useState(initialQuery);
	const searchable = rows.length > MEMBER_PANEL_SEARCH_THRESHOLD;
	const shownRows = searchable
		? rows.filter(({ label }) => matchesMemberQuery(label, query))
		: rows;
	const { people: humans, agents } = groupByKind(
		shownRows,
		(row) => row.member.kind,
	);
	const groups = [
		{
			key: "people",
			heading: t("ui.teamBridge.members.group.people"),
			rows: humans,
		},
		{
			key: "agents",
			heading: t("ui.teamBridge.members.group.agents_v2"),
			rows: agents,
		},
		// A heading over nothing reads as a load failure, so an empty group is dropped.
	].filter((group) => group.rows.length > 0);
	const note = memberPanelNote(conversation);

	const [confirm, setConfirm] = useState<{
		row: TeamBridgeMemberPanelRow;
		action: TeamBridgeMemberRowAction;
	} | null>(() => {
		const row = rows.find((entry) => entry.key === initialConfirmKey);
		return row?.action ? { row, action: row.action } : null;
	});
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(initialError);
	/* The row whose action opened the confirm: focus goes back to it on Cancel
	   or a refusal, so the keyboard reader is not dropped at the top. */
	const actionButtons = useRef(new Map<string, HTMLButtonElement>());
	const returnTo = useRef<string | null>(null);
	/*
	 * THE ROW WHOSE TOOLTIP STAYS SHUT after focus is handed back to it (QA
	 * round 1, N1). Radix's trigger opens its tooltip on ANY focus, and the
	 * confirm (or `settleFocus`) returning focus to the row action is not a
	 * reader asking for the label; the open tooltip is then the topmost
	 * dismissable layer, swallows the next Escape (`preventDefault`), and the
	 * panel took two Escapes to close. Held until the pointer arrives or focus
	 * leaves, so a real hover or a fresh Tab still shows the label.
	 */
	const [quietTooltip, setQuietTooltip] = useState<string | null>(null);
	/* The armed row left the room (a refetch removed it): its question is moot. */
	useEffect(() => {
		if (confirm && !rows.some((row) => row.key === confirm.row.key))
			setConfirm(null);
	}, [rows, confirm]);

	/*
	 * FOCUS AND ESCAPE, the thread pane's rule (`manageThreadFocus`): focus moves
	 * to the close button on open, Escape inside the panel closes it (after an
	 * open menu or listbox has had its chance), and on unmount focus returns to
	 * the control that opened it - the header's count button. The confirm dialog
	 * is a portal outside the panel, so its own Escape never reaches this one.
	 */
	const pane = useRef<HTMLElement>(null);
	const close = useRef(onClose);
	close.current = onClose;
	useEffect(() => {
		if (pane.current)
			return manageThreadFocus(pane.current, () => close.current());
	}, []);

	const settleFocus = (key: string | null) => {
		if (!key) return;
		setQuietTooltip(key);
		queueMicrotask(() => actionButtons.current.get(key)?.focus());
	};
	const runConfirmed = () => {
		if (!confirm || !onAction || pending) return;
		const { row, action } = confirm;
		setPending(true);
		setFailed(false);
		onAction(row, action).then(
			() => {
				setPending(false);
				setConfirm(null);
			},
			() => {
				setPending(false);
				setConfirm(null);
				setFailed(true);
				settleFocus(returnTo.current);
			},
		);
	};

	return (
		<aside
			ref={pane}
			aria-label={t("ui.teamBridge.members_panel.title")}
			/* THE PANEL IS THE THIRD PLANE, like the thread pane it alternates with
			   (#1668, visual refresh § 3.2): `surface` beside the `canvas` timeline,
			   with the one sanctioned `PanelEdge` seam on its leading edge (`relative`
			   is the seam's containing block). Before #1668 both side panes were
			   `canvas`; keeping this one there would make the members panel and the
			   thread read as two different planes in the same slot. The box that
			   paints the ground wears `panel-top-pad`, so the ground reaches the
			   window edge and only the content clears the titlebar. */
			className="panel-top-pad relative flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col bg-surface"
		>
			<PanelEdge side="start" />
			<header className="flex h-11 shrink-0 items-center justify-between px-5">
				<h2 className="font-semibold text-[15px] text-ink">
					{t("ui.teamBridge.members_panel.title")}
				</h2>
				<Button
					data-thread-close
					size="icon-sm"
					variant="ghost"
					onClick={onClose}
					aria-label={t("ui.teamBridge.members_panel.close")}
				>
					<X size={16} />
				</Button>
			</header>
			{onAddMembers && (
				<div className="shrink-0 px-3 pb-1">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="w-full justify-start"
						onClick={onAddMembers}
					>
						<UserPlus size={14} aria-hidden="true" />
						{t("ui.teamBridge.members.menu")}
					</Button>
				</div>
			)}
			{searchable && (
				<div className="relative shrink-0 px-5 pt-1 pb-2">
					<Search
						size={14}
						aria-hidden="true"
						className="pointer-events-none absolute start-8 top-1/2 -translate-y-1/2 text-ink-dim"
					/>
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("ui.teamBridge.members.search")}
						aria-label={t("ui.teamBridge.members.search")}
						className="ps-9"
					/>
				</div>
			)}
			{note && (
				<p className={cn("shrink-0 px-5 pb-2 text-meta text-ink-dim")}>
					{note === "dm"
						? t("ui.teamBridge.members_panel.note.dm")
						: /* The channel name rides as an argument, isolated LTR (i18n audit
						     UR-M3): `#` is a weak bidi character, so a literal "#general"
						     inside an RTL sentence displays as "general#". The catalogue may
						     not carry bidi controls, so the isolate is added here. */
							t(`ui.teamBridge.members_panel.note.${note}`, {
								channel: isolateLtr(`#${note}`),
							})}
				</p>
			)}
			{failed && (
				<p
					role="alert"
					className={cn("shrink-0 px-5 pb-2 text-[13px] text-danger")}
				>
					{t("ui.teamBridge.members.mutation_error")}
				</p>
			)}
			{/* The scroll area spans the panel's full width and the rows carry the
			    horizontal padding, so the scrollbar sits in the gutter and never
			    narrows the measure when it appears. */}
			<ScrollArea className="min-h-0 flex-1">
				<div className="pb-4">
					{groups.length === 0 ? (
						<p className="px-5 py-3 text-body-sm text-ink-dim">
							{t("ui.teamBridge.members.current_no_matches")}
						</p>
					) : (
						groups.map((group) => (
							<section key={group.key} aria-label={group.heading}>
								<h3 className={GROUP_HEADING}>{group.heading}</h3>
								<ul>
									{group.rows.map((row) => {
										const action = onAction ? row.action : null;
										const presentation = action
											? actionPresentation(action, row.label)
											: null;
										const armed = confirm?.row.key === row.key;
										return (
											<li
												key={row.key}
												/* `group` scopes the action's reveal to this row;
												   hover is a colour step only, nothing moves.
												   THE STEP IS UP FROM THIS GROUND (design review round 1,
												   D2: fill vs ground >= ~1.05:1 in light). The aside is
												   `surface` since #1668, so the step is `elevated` - the
												   same hover the thread pane's compact rows make on the same
												   ground. `elevated` on `surface` measures min 1.062:1 across
												   all 59 palettes (cyberpunk; light min mintLight 1.065:1),
												   where `row-hover` on `surface` dips to 1.045:1 (rosePine).
												   Coupled to the aside's `bg-surface`: change them together. */
												className={cn(
													"group flex min-h-10 items-center gap-2.5 px-5 py-1.5 hover:bg-elevated",
												)}
											>
												<MemberAvatar row={row} people={people} />
												<p className="min-w-0 flex-1 truncate text-body-sm text-ink">
													{row.label}
													{row.self && (
														<span className="text-ink-dim">
															{" "}
															{t("ui.teamBridge.members.you")}
														</span>
													)}
													{/* OWNER IS A ROLE, NOT A STATE (design review round 1, D4):
													    quiet text after the name, the way "(you)" reads, so the
													    end column's chips are only the states that want action. */}
													{row.member.role === "owner" && (
														<span className="text-ink-dim">
															{" · "}
															{t("ui.teamBridge.members.role.owner")}
														</span>
													)}
												</p>
												{row.member.kind === "agent" &&
													agentIdentityChip?.(row)}
												{row.state === "invited" && (
													<Badge variant="neutral" className="shrink-0">
														{t("ui.teamBridge.members.state.invited_short")}
													</Badge>
												)}
												{row.state === "pending_approval" && (
													<Badge variant="neutral" className="shrink-0">
														{t(
															"ui.teamBridge.members_panel.state.pending_approval",
														)}
													</Badge>
												)}
												{/* ONE ACTION SLOT ON EVERY ROW, filled or not, so the role and
												    state chips share one end edge down the list instead of
												    stepping in wherever a hidden action reserves its width. */}
												<span className="flex size-7 shrink-0 items-center justify-center">
													{action && presentation && (
														<span
															className={cn(
																"shrink-0",
																actionRowVisibility(armed),
															)}
														>
															<Tooltip
																content={presentation.tooltip}
																suppressed={quietTooltip === row.key}
																discardWhileSuppressed
															>
																<Button
																	ref={(node) => {
																		if (node)
																			actionButtons.current.set(row.key, node);
																		else actionButtons.current.delete(row.key);
																	}}
																	type="button"
																	size="icon-sm"
																	variant="ghost"
																	disabled={pending}
																	aria-label={presentation.name}
																	aria-haspopup="dialog"
																	onPointerEnter={() => {
																		if (quietTooltip === row.key)
																			setQuietTooltip(null);
																	}}
																	onBlur={() => {
																		if (quietTooltip === row.key)
																			setQuietTooltip(null);
																	}}
																	onClick={() => {
																		returnTo.current = row.key;
																		setFailed(false);
																		setConfirm({ row, action });
																	}}
																>
																	{presentation.icon}
																</Button>
															</Tooltip>
														</span>
													)}
												</span>
											</li>
										);
									})}
								</ul>
							</section>
						))
					)}
				</div>
			</ScrollArea>
			<TeamBridgeMemberConfirmDialog
				subject={confirm}
				conversationName={conversationName}
				pending={pending}
				onClose={() => {
					if (pending) return;
					setConfirm(null);
					settleFocus(returnTo.current);
				}}
				onConfirm={runConfirmed}
			/>
		</aside>
	);
}

/**
 * The confirm for a row action, modelled on `TeamBridgeArchiveDialog`: the
 * title names the member and the conversation, the body states the effect.
 *
 * Every action here is destructive for the reader's access or someone else's,
 * so the confirm is the `danger` button; "Decline" answers an invitation and
 * is not a loss of anything held, so it stays primary. Not closable while the
 * write is in flight: it is not optimistic, so closing would leave the reader
 * not knowing whether it happened.
 */
export function TeamBridgeMemberConfirmDialog({
	subject,
	conversationName,
	pending,
	onClose,
	onConfirm,
}: {
	subject: {
		row: TeamBridgeMemberPanelRow;
		action: TeamBridgeMemberRowAction;
	} | null;
	conversationName: string;
	pending: boolean;
	onClose: () => void;
	onConfirm: () => void;
}) {
	useI18nLocale();
	const action = subject?.action;
	const name = subject?.row.label ?? "";
	const copy =
		action === "leave"
			? {
					title: t("ui.teamBridge.members_panel.confirm.leave_title", {
						conversation: conversationName,
					}),
					body: t("ui.teamBridge.members_panel.confirm.leave_body"),
					confirm: t("ui.teamBridge.members_panel.confirm.leave"),
				}
			: action === "decline"
				? {
						title: t("ui.teamBridge.members_panel.confirm.decline_title", {
							name,
						}),
						body: t("ui.teamBridge.members_panel.confirm.decline_body", {
							name,
							conversation: conversationName,
						}),
						confirm: t("ui.teamBridge.members_panel.confirm.decline"),
					}
				: {
						title: t("ui.teamBridge.members_panel.confirm.remove_title", {
							name,
							conversation: conversationName,
						}),
						/* Removing an INVITED person takes back an invitation, not a seat
						   (review round 1, N3), so that row says so; the hub's DELETE
						   accepts either state. */
						body:
							action === "withdraw"
								? t("ui.teamBridge.members_panel.confirm.withdraw_body")
								: subject?.row.state === "invited"
									? t("ui.teamBridge.members_panel.confirm.remove_invited_body")
									: t("ui.teamBridge.members_panel.confirm.remove_body"),
						confirm: t("ui.teamBridge.members_panel.confirm.remove"),
					};
	return (
		<Dialog
			open={subject !== null}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className="gap-4" closeDisabled={pending}>
				<DialogTitle>{copy.title}</DialogTitle>
				<DialogDescription className="text-[13px] text-ink-muted">
					{copy.body}
				</DialogDescription>
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
						variant={action === "decline" ? "primary" : "danger"}
						disabled={pending}
						onClick={onConfirm}
					>
						{copy.confirm}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
