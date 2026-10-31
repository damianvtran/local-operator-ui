import { Spinner } from "@shared/components/common/spinner";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Tooltip } from "@shared/components/ui/tooltip";
import { formatNumber, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, Search, UserRoundX } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMemberInput,
	TeamBridgeParticipant,
} from "../../../../shared/team-bridge-contract";
/*
 * The chat transcript's hover-reveal for row actions, imported rather than
 * re-spelled: one reveal rule (hover, focus-within, always shown where there is
 * no hover) is what keeps a keyboard or touch reader from meeting an action
 * that exists only under a mouse.
 */
import { actionRowVisibility } from "../chat/canonical/message-actions";
import {
	type TeamBridgeCurrentMember,
	type TeamBridgeMemberCandidate,
	currentMembers,
	groupByKind,
	matchesMemberQuery,
	memberCandidates,
} from "./team-bridge-members-model";
import { recipientKey, recipientMemberInput } from "./team-bridge-model";
import { TeamBridgeAvatar } from "./team-bridge-profile-card";

export type TeamBridgeAddMembersViewProps = {
	open: boolean;
	conversation: TeamBridgeConversation;
	people: readonly TeamBridgeDirectoryMember[];
	selfAccountId?: string;
	peopleState: "loading" | "error" | "ready";
	/** The invite route's prerequisites, from the caller's own member row. */
	canInvite: boolean;
	/** The remove route's prerequisite: the caller is the conversation owner. */
	canRemove: boolean;
	mutationError?: boolean;
	/** Which row is settling: "add", or "remove:<account id>". */
	pendingKey?: string | null;
	onClose: () => void;
	/** Re-run the directory read for one organization, named by tenant id. */
	onRetryMembers?: (tenantId: string) => void;
	onAdd: (members: TeamBridgeMemberInput[]) => void;
	onRemove: (accountId: string) => void;
};

/*
 * SHORT REASONS, TRAILING. An ineligible row is one line: the name truncates
 * first and the reason sits at the end, so the reason has to be a few words
 * ("Not on Team Bridge"), not the sentence the old two-line row carried.
 */
function reasonCopy(
	reason: TeamBridgeMemberCandidate["disabledReason"],
): string {
	switch (reason) {
		case "bridge_unavailable":
			return t("ui.teamBridge.members.reason_short.bridge_unavailable");
		case "agent_unavailable":
			return t("ui.teamBridge.members.reason_short.agent_unavailable");
		case "agent_not_permitted":
			return t("ui.teamBridge.members.reason_short.agent_not_permitted");
		default:
			return "";
	}
}

/*
 * One row geometry for BOTH columns (design spec, 2026-10-30): a 36px minimum
 * with a 24px avatar, so a member row and an invite row line up across the
 * divide and neither column's rhythm depends on whether a row has a badge.
 */
const ROW = "flex min-h-9 items-center gap-2 rounded-md px-2 py-1";
const GROUP_HEADING = "px-2 pt-3 pb-1 text-meta text-ink-dim";

/**
 * The avatar a row shows. The directory row is the photo's only source, so a
 * participant missing from `people` (a deleted account, a roster still
 * loading) gets a minimal synthetic row: no `avatar_url`, so the plate falls
 * back to initials - never to a broken image or a blank square.
 */
function MemberAvatar({
	accountId,
	label,
	kind,
	people,
}: {
	accountId: string;
	label: string;
	kind: "human" | "agent";
	people: readonly TeamBridgeDirectoryMember[];
}) {
	const member = people.find((person) => person.account_id === accountId) ?? {
		account_id: accountId,
		display_label: label,
		role: "member",
		bridge_enabled: false,
		bridge_state: "none" as const,
	};
	return (
		<TeamBridgeAvatar
			member={member}
			label={label}
			size={24}
			className="size-6 rounded-md text-meta"
			/* The message list's agent treatment: the owner's directory row with a
			   Bot glyph as the fallback plate, so an agent reads as an agent in
			   every Team Bridge surface. A person falls back to their initial. */
			fallback={kind === "agent" ? <Bot size={14} /> : undefined}
		/>
	);
}

/** The key a member row is addressed by, for focus return and React. */
function memberRowKey(member: TeamBridgeParticipant): string {
	return `${member.kind}:${member.account_id}`;
}

/**
 * Existing membership and new invitations share one dialog so the inviter can
 * see the post-state without mistaking an invited agent for an active member.
 * Every unavailable candidate stays visible with its reason instead of being
 * silently dropped. Authorization is still the hub's; these flags only decide
 * what is worth offering, and each mirrors the route it unlocks.
 */
export function TeamBridgeAddMembersView({
	open,
	conversation,
	people,
	selfAccountId,
	peopleState,
	canInvite,
	canRemove,
	mutationError = false,
	pendingKey = null,
	onClose,
	onRetryMembers,
	onAdd,
	onRemove,
}: TeamBridgeAddMembersViewProps) {
	const locale = useI18nLocale();
	const headingId = useId();
	const searchId = useId();
	const searchRef = useRef<HTMLInputElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	/** The member row whose removal is armed; one at a time, cleared on close. */
	const [armed, setArmed] = useState<string | null>(null);
	useEffect(() => {
		if (open) {
			setQuery("");
			setSelected(new Set());
			setArmed(null);
		}
	}, [open]);

	const chiefLabel = useCallback(
		(agent: string, person: string) =>
			agent.trim()
				? t("ui.teamBridge.chief.label", { agent, person })
				: t("ui.teamBridge.chief.unnamed", { person }),
		[],
	);
	/*
	 * `candidates` is memoized on the things it is derived from - the
	 * conversation (a new object on every refresh), the roster and the reader -
	 * so the filtered list below actually re-filters when they change instead of
	 * on every keystroke-driven render.
	 */
	const candidates = useMemo(
		() =>
			memberCandidates(conversation, people, selfAccountId, chiefLabel, locale),
		[conversation, people, selfAccountId, chiefLabel, locale],
	);

	/*
	 * A TICK THAT BECAME A MEMBERSHIP IS CLEARED, NOT KEPT IN RESERVE.
	 *
	 * When the hub accepts an invitation its rows turn into "already active or
	 * invited" and stop rendering ticked - but the key would otherwise sit in
	 * `selected` and re-arm itself the moment that person left the room again,
	 * offering to invite someone the reader had since removed. Re-derive the
	 * tick set from what is actually addable for the conversation as it is now.
	 */
	useEffect(() => {
		setSelected((current) => {
			const addable = new Set(
				candidates
					.filter(({ disabledReason }) => disabledReason === null)
					.map(({ recipient }) => recipientKey(recipient)),
			);
			let dropped = false;
			const next = new Set<string>();
			for (const id of current) {
				if (addable.has(id)) next.add(id);
				else dropped = true;
			}
			return dropped ? next : current;
		});
	}, [candidates]);
	/*
	 * ONE SEARCH, BOTH COLUMNS. The field sits over the invite list, but a
	 * reader looking for "Ben" wants to know whether Ben is already here as
	 * much as whether he can be invited - so the query narrows the members
	 * column too, and each column says its own "no results".
	 */
	const filtered = useMemo(
		() =>
			candidates.filter(({ recipient }) =>
				matchesMemberQuery(recipient.label, query),
			),
		// `recipient.label` carries no id, so the list itself is the dependency.
		[candidates, query],
	);
	// Memoized for the reason `candidates` is: the inputs change on refresh,
	// not on the keystroke-driven renders the search causes.
	const members = useMemo(
		() =>
			currentMembers(
				conversation,
				people,
				selfAccountId,
				chiefLabel,
				canRemove,
				locale,
			),
		[conversation, people, selfAccountId, chiefLabel, canRemove, locale],
	);
	const shownMembers = members.filter(({ label }) =>
		matchesMemberQuery(label, query),
	);
	const searching = query.trim() !== "";
	/*
	 * TWO GROUPS, IN THE ORDER THE OPERATOR THINKS ABOUT THEM, IN BOTH COLUMNS.
	 *
	 * Slack separates people from bots in its invite picker for a reason that
	 * holds here: a person and that person's chief of staff are two invitations
	 * with different consequences - a human joins on accept, an agent joins
	 * only after its owner consents - and one flat list hides that behind an
	 * icon at the row's edge. The directory is the source of both, so the
	 * split is the row's `kind`, never a second server call.
	 *
	 * A group with no rows after filtering is dropped rather than drawn empty:
	 * a heading over nothing reads as a loading failure, not as a filter result.
	 */
	const groupsOf = <T,>(
		rows: readonly T[],
		kindOf: (row: T) => "human" | "agent",
	) => {
		const { people: humans, agents } = groupByKind(rows, kindOf);
		return [
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
		].filter((group) => group.rows.length > 0);
	};
	const groups = groupsOf(filtered, ({ recipient }) => recipient.kind);
	const memberGroups = groupsOf(shownMembers, ({ member }) => member.kind);
	const selectedMembers = candidates.filter(
		({ recipient, disabledReason }) =>
			disabledReason === null && selected.has(recipientKey(recipient)),
	);
	const pending = pendingKey !== null;

	/*
	 * FOCUS FOLLOWS THE CONFIRMATION. Arming moves the keyboard to Cancel (the
	 * safe answer, so a second Enter never removes), and disarming returns it
	 * to the icon that armed it - otherwise focus falls to <body> and a
	 * keyboard reader loses their place in the list.
	 */
	const cancelRef = useRef<HTMLButtonElement>(null);
	const removeButtons = useRef(new Map<string, HTMLButtonElement>());
	useEffect(() => {
		if (armed) cancelRef.current?.focus();
	}, [armed]);
	const disarm = () => {
		const id = armed;
		setArmed(null);
		if (id) removeButtons.current.get(id)?.focus();
	};
	/*
	 * AN ARMED ROW THAT IS NO LONGER ON SCREEN IS DISARMED. A search that hides
	 * it, or a refresh that drops the member, would otherwise leave `armed` set
	 * with no row to show it - and the next Esc would be spent disarming an
	 * invisible question instead of closing the dialog (review M1).
	 */
	const armedVisible =
		armed !== null &&
		shownMembers.some(
			({ member, removable }) => removable && member.account_id === armed,
		);
	useEffect(() => {
		if (armed !== null && !armedVisible) setArmed(null);
	}, [armed, armedVisible]);
	/*
	 * FOCUS SURVIVES A FAILED REMOVAL. Confirming unmounts the focused button
	 * and the row's icon gives way to "Removing…", so focus falls out of the
	 * list. If the write is refused the icon comes back - return the keyboard
	 * to it then, so the reader can retry from where they were (review M2).
	 * A removal that succeeds drops the row; focus then rests on the dialog.
	 */
	const lastRemoval = useRef<string | null>(null);
	useEffect(() => {
		if (pendingKey !== null || !mutationError) return;
		const id = lastRemoval.current;
		lastRemoval.current = null;
		if (id) removeButtons.current.get(id)?.focus();
	}, [pendingKey, mutationError]);

	const toggle = (candidate: TeamBridgeMemberCandidate) => {
		if (!canInvite || candidate.disabledReason !== null || pending) return;
		const key = recipientKey(candidate.recipient);
		setSelected((previous) => {
			const next = new Set(previous);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const memberRow = ({
		member,
		label,
		state,
		self,
		removable,
	}: TeamBridgeCurrentMember) => {
		const id = member.account_id;
		const removing = pendingKey === `remove:${id}`;
		const isArmed = removable && armed === id;
		return (
			<div
				key={`${memberRowKey(member)}:${state}`}
				/*
				 * `group` scopes the remove action's reveal to THIS row. The armed
				 * row keeps the dialog's own ground on purpose: the outline danger
				 * button has no fill, and on `row-selected` its label and edge fell
				 * below the contrast floors in 6 and 12 themes (design review D2).
				 * The open confirmation line and the pinned icon already tie the
				 * question to the row. `scripts/contrast-contract.mjs` pins this
				 * button on `elevated`.
				 */
				className={cn(
					"group rounded-md",
					!isArmed && removable && "hover:bg-row-hover",
				)}
				/* Esc on an armed row answers the row's question, not the dialog's:
				   it is handled in `onEscapeKeyDown` below, because Radix reads
				   Escape in the capture phase, before any row handler. */
			>
				<div className={ROW}>
					<MemberAvatar
						accountId={id}
						label={label}
						kind={member.kind}
						people={people}
					/>
					<p
						className={cn(
							"min-w-0 flex-1 truncate text-body-sm",
							removing ? "text-ink-muted" : "text-ink",
						)}
					>
						{label}
						{self && (
							<span className="text-ink-dim">
								{" "}
								{t("ui.teamBridge.members.you")}
							</span>
						)}
					</p>
					{/*
					 * BADGES ONLY FOR THE EXCEPTIONS. "Member" and "Active" were on
					 * every row and said nothing; Owner and Invited are the two facts
					 * that change what a row means, so only they get a mark.
					 */}
					{member.role === "owner" && (
						<Badge variant="neutral" className="shrink-0">
							{t("ui.teamBridge.members.role.owner")}
						</Badge>
					)}
					{state === "invited" && (
						<Badge variant="neutral" className="shrink-0">
							{t("ui.teamBridge.members.state.invited_short")}
						</Badge>
					)}
					{removing && (
						<span className="shrink-0 text-meta text-ink-dim">
							{t("ui.teamBridge.members.removing_v2")}
						</span>
					)}
					{/*
					 * THE REMOVE ACTION STAYS ON THE ROW'S LINE. It used to wrap under
					 * the name as a stray icon on its own line. Only `removable` rows
					 * render it at all (owner caller, human row, not self - the DELETE
					 * route is human-keyed; see `currentMembers`), and it is revealed
					 * on hover / focus-within, pinned while its row is armed or
					 * removing so the control never fades out from under the press.
					 */}
					{removable && !removing && (
						<span className={cn("shrink-0", actionRowVisibility(isArmed))}>
							<Tooltip content={t("ui.teamBridge.members.remove_tooltip")}>
								<Button
									ref={(node) => {
										if (node) removeButtons.current.set(id, node);
										else removeButtons.current.delete(id);
									}}
									type="button"
									size="icon-sm"
									variant="ghost"
									disabled={pending}
									aria-label={t("ui.teamBridge.members.remove_label", {
										name: label,
									})}
									aria-expanded={isArmed}
									onClick={() => setArmed(isArmed ? null : id)}
								>
									<UserRoundX aria-hidden="true" />
								</Button>
							</Tooltip>
						</span>
					)}
				</div>
				{/*
				 * A REMOVAL IS ASKED TWICE, INLINE. The first press only arms the
				 * row; the confirmation names the person on its own end-aligned
				 * line, so the name above it is never truncated to make room.
				 */}
				{isArmed && (
					<div className="flex items-center justify-end gap-1 px-2 pb-1.5">
						<Button
							ref={cancelRef}
							type="button"
							size="sm"
							variant="ghost"
							disabled={pending}
							onClick={disarm}
						>
							{t("ui.teamBridge.create.cancel")}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="danger"
							disabled={pending}
							onClick={() => {
								setArmed(null);
								lastRemoval.current = id;
								onRemove(id);
							}}
						>
							{t("ui.teamBridge.members.remove", { name: label })}
						</Button>
					</div>
				)}
			</div>
		);
	};

	const candidateRow = (
		candidate: TeamBridgeMemberCandidate,
		groupKey: string,
		index: number,
	) => {
		const key = recipientKey(candidate.recipient);
		const label = candidate.recipient.label;
		const avatar = (
			<MemberAvatar
				accountId={candidate.recipient.accountId}
				label={label}
				kind={candidate.recipient.kind}
				people={people}
			/>
		);
		if (candidate.disabledReason !== null) {
			const reason = reasonCopy(candidate.disabledReason);
			/*
			 * AN INELIGIBLE ROW IS INFORMATION, NOT A CONTROL. No checkbox (a
			 * disabled box read as "already ticked" in the operator's screenshot),
			 * no reserved box column, no hover step and no tab stop - the reader
			 * learns why the person is here without being offered a dead control.
			 * The reason rides the row's accessible name so a screen reader hears
			 * it with the name.
			 */
			return (
				<fieldset
					key={key}
					aria-disabled="true"
					aria-label={t("ui.teamBridge.members.ineligible_label", {
						name: label,
						reason,
					})}
					data-ineligible=""
					/* A fieldset only for its implicit group role; the reset strips
					   the browser's frame so it wears the shared row geometry. */
					className={cn(ROW, "m-0 min-w-0 border-0")}
				>
					{avatar}
					<span className="min-w-0 flex-1 truncate text-body-sm text-ink-muted">
						{label}
					</span>
					<span className="shrink-0 text-end text-meta text-ink-dim">
						{reason}
					</span>
				</fieldset>
			);
		}
		const checked = selected.has(key);
		const disabled = !canInvite || pending;
		const labelId = `${searchId}-${groupKey}-${index}-label`;
		return (
			<div
				key={key}
				className={cn(
					ROW,
					disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-row-hover",
					/*
					 * Selection is a GROUND step, never a stroke: the checkbox
					 * is the control and already states the fact.
					 */
					checked && "bg-row-selected",
				)}
				/*
				 * ONE click handler, which ignores a click that landed on the
				 * checkbox: the box toggles itself, and a row handler that also
				 * fired would toggle it straight back. The checkbox stays the
				 * only tab stop.
				 */
				onClick={(event) => {
					if ((event.target as HTMLElement).closest?.("[data-row-checkbox]"))
						return;
					toggle(candidate);
				}}
				// The keyboard twin keeps the row's pointer and key targets agreeing;
				// the checkbox stays the only tab stop.
				onKeyDown={(event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					// preventDefault also cancels the focused box's own Space click,
					// so a key on the checkbox toggles once, through this handler.
					event.preventDefault();
					toggle(candidate);
				}}
			>
				{avatar}
				<span
					id={labelId}
					className={cn(
						"min-w-0 flex-1 truncate text-body-sm",
						disabled ? "text-ink-muted" : "text-ink",
					)}
				>
					{label}
				</span>
				{/*
				 * The house `Checkbox`, not a raw input: a native box paints
				 * Chromium's accent and ignores every theme (design review D1).
				 */}
				<span className="flex shrink-0" data-row-checkbox="">
					<Checkbox
						checked={checked}
						disabled={disabled}
						onCheckedChange={() => toggle(candidate)}
						aria-labelledby={labelId}
					/>
				</span>
			</div>
		);
	};

	/*
	 * THE SCROLL COLUMNS. `[scrollbar-gutter:stable]` keeps the bar in its own
	 * gutter so rows never shift when it appears; `pb-2` is the air under the
	 * last row so it ends fully visible above the footer instead of flush with
	 * the clip edge.
	 */
	const scrollColumn =
		"min-h-0 space-y-0.5 pb-2 [scrollbar-gutter:stable] md:flex-1 md:overflow-y-auto md:pe-2";

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent
				ref={contentRef}
				tabIndex={-1}
				/*
				 * A FIXED HEIGHT WHILE OPEN, not a max: with `max-h` the dialog
				 * shrank to its content as the search narrowed the lists, and being
				 * centred it moved the search field the user was typing in (design
				 * review D1: input y 187 -> 311 -> 321). The body below is
				 * `flex-1 min-h-0`, so each column scrolls inside this box.
				 */
				className="h-[min(780px,90dvh)] max-w-2xl gap-0 overflow-hidden p-0"
				closeDisabled={pending}
				/*
				 * THE SEARCH FIELD TAKES THE FIRST FOCUS, NEVER A ROW'S CONTROLS.
				 * Radix focuses the dialog's first focusable node, and the first section
				 * here is the CURRENT-MEMBERS list whose rows carry a remove control - so
				 * the default put the keyboard's Enter on a destructive action the moment
				 * the picker opened. `preventDefault` is unconditional: when the roster is
				 * still loading (or failed) there is no filter to focus, and the dialog's
				 * own container takes the focus instead. Letting Radix choose there would
				 * reintroduce exactly the control this rule exists to keep Enter off.
				 */
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					(searchRef.current ?? contentRef.current)?.focus();
				}}
				/*
				 * Radix listens for Escape on the document in the CAPTURE phase, so a
				 * row's own handler runs too late to keep the dialog open. While a
				 * removal is armed, Esc disarms it instead of dismissing the picker.
				 */
				onEscapeKeyDown={(event) => {
					if (armed) {
						event.preventDefault();
						disarm();
					}
				}}
			>
				<DialogHeader className="px-6 pt-6 pb-4 pe-12">
					<DialogTitle>{t("ui.teamBridge.members.title")}</DialogTitle>
					<DialogDescription>
						{t("ui.teamBridge.members.description")}
					</DialogDescription>
				</DialogHeader>
				<div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-2 md:overflow-hidden">
					<section
						className="flex min-h-64 flex-col gap-3 px-6 md:min-h-0 md:overflow-hidden md:pe-3"
						aria-labelledby={`${headingId}-current`}
					>
						<h3
							id={`${headingId}-current`}
							className="flex h-8 items-center gap-2 text-sm font-medium text-ink"
						>
							{t("ui.teamBridge.members.current")}
							<span className="font-normal text-ink-dim tabular-nums">
								{/* The room's size, deliberately NOT the search's match count:
								    the title names the room, and a number that shrank while
								    typing would read as members leaving. */}
								{formatNumber(members.length, undefined, locale)}
							</span>
						</h3>
						<div className={scrollColumn}>
							{members.length === 0 ? (
								<p className="px-2 py-4 text-sm text-ink-muted">
									{t("ui.teamBridge.members.current_empty")}
								</p>
							) : memberGroups.length === 0 ? (
								<p className="px-2 py-4 text-sm text-ink-muted">
									{t("ui.teamBridge.members.current_no_matches")}
								</p>
							) : (
								memberGroups.map((group, groupIndex) => (
									<fieldset
										key={group.key}
										aria-labelledby={`${headingId}-current-${group.key}`}
										className="m-0 min-w-0 space-y-0.5 border-0 p-0"
									>
										<p
											id={`${headingId}-current-${group.key}`}
											className={cn(GROUP_HEADING, groupIndex === 0 && "pt-0")}
										>
											{group.heading}
										</p>
										{group.rows.map(memberRow)}
									</fieldset>
								))
							)}
						</div>
					</section>
					<section
						className="flex min-h-80 flex-col gap-3 px-6 py-5 md:min-h-0 md:overflow-hidden md:ps-3 md:py-0"
						aria-labelledby={searchId}
					>
						<div className="flex h-8 items-center justify-between gap-2">
							<h3 id={searchId} className="text-sm font-medium text-ink">
								{t("ui.teamBridge.members.invite")}
							</h3>
							{!canInvite && (
								<span className="text-meta-sm text-ink-dim">
									{t("ui.teamBridge.members.read_only")}
								</span>
							)}
						</div>
						{peopleState === "loading" ? (
							<Spinner size="sm" label={t("ui.teamBridge.members.loading")} />
						) : peopleState === "error" ? (
							<div className="flex flex-col items-start gap-2">
								<p className="text-sm text-ink-muted">
									{t("ui.teamBridge.members.load_error")}
								</p>
								{onRetryMembers && (
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => onRetryMembers(conversation.tenant_id)}
									>
										{t("ui.teamBridge.list.retry")}
									</Button>
								)}
							</div>
						) : (
							<>
								<div className="relative">
									<Search
										size={15}
										aria-hidden="true"
										className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-dim"
									/>
									<Input
										ref={searchRef}
										value={query}
										onChange={(event) => setQuery(event.target.value)}
										placeholder={t("ui.teamBridge.members.search")}
										aria-label={t("ui.teamBridge.members.search")}
										className="ps-9"
										/*
										 * Enabled for a read-only caller too: the query also
										 * filters the current-members column, which every member
										 * may read (review M3). Invite rows and the Invite button
										 * carry their own `canInvite` guard.
										 */
										disabled={pending}
									/>
								</div>
								<div className={scrollColumn}>
									{filtered.length === 0 ? (
										<p className="px-2 py-4 text-sm text-ink-muted">
											{candidates.length === 0 && !searching
												? t("ui.teamBridge.members.empty")
												: /*
													 * The query found someone, but only among current
													 * members - who are filtered out of this list. Say
													 * so, or the reader concludes the person does not
													 * exist.
													 */
													searching && shownMembers.length > 0
													? t("ui.teamBridge.members.no_invitable_matches", {
															query: query.trim(),
														})
													: t("ui.teamBridge.members.no_matches")}
										</p>
									) : (
										groups.map((group, groupIndex) => (
											/*
											 * A FIELDSET, NOT A DIV WITH role="group": the heading names the group, so a
											 * screen reader hears "People, Sherman Tsui" and then "Agents, Orion
											 * (Sherman Tsui)" - the split the eye gets. The name comes from
											 * `aria-labelledby` rather than a `<legend>`, whose own box would fight this
											 * heading's register; the classes reset the fieldset's default frame.
											 */
											<fieldset
												key={group.key}
												className="m-0 min-w-0 space-y-0.5 border-0 p-0"
												aria-labelledby={`${searchId}-${group.key}`}
											>
												<p
													id={`${searchId}-${group.key}`}
													className={cn(
														GROUP_HEADING,
														groupIndex === 0 && "pt-0",
													)}
												>
													{group.heading}
												</p>
												{group.rows.map((candidate, index) =>
													candidateRow(candidate, group.key, index),
												)}
											</fieldset>
										))
									)}
								</div>
							</>
						)}
					</section>
				</div>
				{mutationError && (
					<p role="alert" className="px-6 pt-2 text-sm text-danger">
						{t("ui.teamBridge.members.mutation_error")}
					</p>
				)}
				<div className="mt-2 flex items-center justify-between gap-3 rounded-b-lg border-hairline border-t bg-surface px-6 py-4">
					<p className="max-w-sm text-meta text-ink-muted">
						{t("ui.teamBridge.members.invitation_note_v3")}
					</p>
					<div className="flex shrink-0 gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={onClose}
							disabled={pending}
						>
							{t("ui.teamBridge.create.cancel")}
						</Button>
						<Button
							type="button"
							variant="primary"
							disabled={!canInvite || selectedMembers.length === 0 || pending}
							onClick={() =>
								onAdd(
									selectedMembers.map(({ recipient }) =>
										recipientMemberInput(recipient),
									),
								)
							}
						>
							{t("ui.teamBridge.members.invite_count", {
								count: selectedMembers.length,
							})}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
