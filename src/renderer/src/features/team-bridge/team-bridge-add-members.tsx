import { Spinner } from "@shared/components/common/spinner";
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
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, Search, UserRound, UserRoundX } from "lucide-react";
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
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeMemberCandidate,
	currentMembers,
	memberCandidates,
} from "./team-bridge-members-model";
import { recipientKey, recipientMemberInput } from "./team-bridge-model";

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

function reasonCopy(
	reason: TeamBridgeMemberCandidate["disabledReason"],
): string {
	switch (reason) {
		case "already_member":
			return t("ui.teamBridge.members.reason.already_member");
		case "bridge_unavailable":
			return t("ui.teamBridge.members.reason.bridge_unavailable");
		case "agent_unavailable":
			return t("ui.teamBridge.members.reason.agent_unavailable");
		case "agent_not_permitted":
			return t("ui.teamBridge.members.reason.agent_not_permitted");
		default:
			return "";
	}
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
	useI18nLocale();
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
		() => memberCandidates(conversation, people, selfAccountId, chiefLabel),
		[conversation, people, selfAccountId, chiefLabel],
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
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const filtered = useMemo(
		() =>
			candidates.filter(({ recipient }) =>
				recipient.label.toLocaleLowerCase().includes(normalizedQuery),
			),
		// `recipient.label` carries no id, so the list itself is the dependency.
		[candidates, normalizedQuery],
	);
	const members = currentMembers(
		conversation,
		people,
		selfAccountId,
		chiefLabel,
		canRemove,
	);
	/*
	 * TWO GROUPS, IN THE ORDER THE OPERATOR THINKS ABOUT THEM.
	 *
	 * Slack separates people from bots in its invite picker for a reason that
	 * holds here: a person and that person's chief of staff are two invitations
	 * with different consequences - a human joins on accept, an agent joins
	 * muted only after its owner consents - and one flat list hides that behind
	 * an icon at the row's edge. The directory is the source of both, so the
	 * split is the row's `kind`, never a second server call.
	 *
	 * A group with no rows after filtering is dropped rather than drawn empty:
	 * a heading over nothing reads as a loading failure, not as a filter result.
	 */
	const groups = [
		{
			key: "people",
			heading: t("ui.teamBridge.members.group.people"),
			rows: filtered.filter(({ recipient }) => recipient.kind === "human"),
		},
		{
			key: "agents",
			heading: t("ui.teamBridge.members.group.agents"),
			rows: filtered.filter(({ recipient }) => recipient.kind === "agent"),
		},
	].filter((group) => group.rows.length > 0);
	const selectedMembers = candidates.filter(
		({ recipient, disabledReason }) =>
			disabledReason === null && selected.has(recipientKey(recipient)),
	);
	const pending = pendingKey !== null;

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

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent
				ref={contentRef}
				tabIndex={-1}
				className="max-h-[min(780px,90dvh)] max-w-2xl overflow-hidden p-0"
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
			>
				<DialogHeader className="px-6 pt-6 pe-12">
					<DialogTitle>{t("ui.teamBridge.members.title")}</DialogTitle>
					<DialogDescription>
						{t("ui.teamBridge.members.description")}
					</DialogDescription>
				</DialogHeader>
				<div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-2 md:overflow-hidden">
					<section
						className="flex min-h-64 flex-col gap-3 px-6 pb-5 md:min-h-0 md:overflow-hidden md:pe-3"
						aria-labelledby={`${headingId}-current`}
					>
						<h3
							id={`${headingId}-current`}
							className="text-sm font-medium text-ink"
						>
							{t("ui.teamBridge.members.current")}
						</h3>
						<div className="min-h-0 space-y-1 [scrollbar-gutter:stable] md:overflow-y-auto md:pe-2">
							{members.length === 0 ? (
								<p className="text-sm text-ink-muted">
									{t("ui.teamBridge.members.current_empty")}
								</p>
							) : (
								members.map(({ member, label, state, removable }) => {
									const removing = pendingKey === `remove:${member.account_id}`;
									return (
										/*
										 * THE ARMED CONTROLS GET THEIR OWN LINE. Rendered inside the
										 * row's flex line they took ~170px of a 290px column and
										 * truncated the very name the confirmation exists to state
										 * ("Ben T..."). The row keeps its width; the question sits
										 * under it, aligned to the end.
										 */
										<div
											key={`${member.kind}:${member.account_id}:${state}`}
											className="flex min-w-0 flex-col gap-1 rounded-md px-2 py-2"
										>
											<div className="flex min-w-0 items-center gap-2">
												{member.kind === "agent" ? (
													<Bot
														size={16}
														className="shrink-0 text-ink-dim"
														aria-hidden="true"
													/>
												) : (
													<UserRound
														size={16}
														className="shrink-0 text-ink-dim"
														aria-hidden="true"
													/>
												)}
												<div className="min-w-0 flex-1">
													<p className="truncate text-sm text-ink">{label}</p>
													<p className="text-meta-sm text-ink-muted">
														{member.role === "owner"
															? t("ui.teamBridge.members.role.owner")
															: t("ui.teamBridge.members.role.member")}
														{" · "}
														{state === "active"
															? t("ui.teamBridge.members.state.active")
															: t("ui.teamBridge.members.state.invited")}
														{removing &&
															` · ${t("ui.teamBridge.members.removing")}`}
													</p>
												</div>
											</div>
											{/*
											 * A REMOVAL IS ASKED TWICE. The archive path next door
											 * confirms, and a member leaves with one stray click in a
											 * list whose rows sit beside a checkbox column - so the
											 * first press only arms the row, and the armed row states
											 * the person it would remove.
											 */}
											{removable && armed === member.account_id && (
												<div className="flex shrink-0 items-center justify-end gap-1">
													<Button
														type="button"
														size="sm"
														variant="ghost"
														disabled={pending}
														onClick={() => setArmed(null)}
													>
														{t("ui.teamBridge.create.cancel")}
													</Button>
													<Button
														type="button"
														size="sm"
														variant="secondary"
														disabled={pending}
														onClick={() => {
															setArmed(null);
															onRemove(member.account_id);
														}}
													>
														{t("ui.teamBridge.members.remove", {
															name: label,
														})}
													</Button>
												</div>
											)}
											{removable && armed !== member.account_id && (
												<Button
													type="button"
													size="icon-sm"
													variant="ghost"
													disabled={pending}
													aria-label={t("ui.teamBridge.members.remove", {
														name: label,
													})}
													title={t("ui.teamBridge.members.remove", {
														name: label,
													})}
													onClick={() => setArmed(member.account_id)}
												>
													<UserRoundX size={15} aria-hidden="true" />
												</Button>
											)}
										</div>
									);
								})
							)}
						</div>
					</section>
					<section
						className="flex min-h-80 flex-col gap-3 px-6 py-5 md:min-h-0 md:overflow-hidden md:ps-3 md:pt-0"
						aria-labelledby={searchId}
					>
						<div className="flex items-center justify-between gap-2">
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
										disabled={!canInvite || pending}
									/>
								</div>
								<div className="min-h-0 space-y-1 [scrollbar-gutter:stable] md:overflow-y-auto md:pe-2">
									{filtered.length === 0 ? (
										<p className="px-2 py-4 text-sm text-ink-muted">
											{people.length === 0
												? t("ui.teamBridge.members.empty")
												: t("ui.teamBridge.members.no_matches")}
										</p>
									) : (
										groups.map((group) => (
											/*
											 * A FIELDSET, NOT A DIV WITH role="group": the heading names the group, so a
											 * screen reader hears "People, Sherman Tsui" and then "Agents and chiefs of
											 * staff, Orion (Sherman Tsui)" - the split the eye gets. The name comes from
											 * `aria-labelledby` rather than a `<legend>`, whose own box would fight this
											 * heading's register; the classes reset the fieldset's default frame.
											 */
											<fieldset
												key={group.key}
												className="m-0 min-w-0 border-0 p-0"
												aria-labelledby={`${searchId}-${group.key}`}
											>
												<p
													id={`${searchId}-${group.key}`}
													className="px-2 pt-2 pb-1 text-ink-dim text-meta"
												>
													{group.heading}
												</p>
												{group.rows.map((candidate, index) => {
													const key = recipientKey(candidate.recipient);
													const checked =
														selected.has(key) &&
														candidate.disabledReason === null;
													const disabled =
														!canInvite ||
														candidate.disabledReason !== null ||
														pending;
													const labelId = `${searchId}-${group.key}-${index}-label`;
													const reasonId = `${searchId}-${group.key}-${index}-reason`;
													return (
														<div
															key={key}
															className={cn(
																"flex w-full items-start gap-3 rounded-md px-2 py-2",
																disabled
																	? "cursor-not-allowed"
																	: "cursor-pointer hover:bg-row-hover",
																/*
																 * Selection is a GROUND step, never a stroke: the checkbox
																 * is the control and already states the fact.
																 */
																checked && "bg-row-selected",
															)}
															/*
															 * ONE click handler, which ignores a click that landed on the
															 * checkbox: the box toggles itself, and a row handler that also
															 * fired would toggle it straight back. The keyboard twin keeps the
															 * row's pointer and key targets agreeing; the checkbox stays the
															 * tab stop.
															 */
															onClick={(event) => {
																if (
																	(event.target as HTMLElement).closest?.(
																		"[data-row-checkbox]",
																	)
																)
																	return;
																toggle(candidate);
															}}
															onKeyDown={(event) => {
																if (event.key !== "Enter" && event.key !== " ")
																	return;
																event.preventDefault();
																toggle(candidate);
															}}
														>
															{candidate.recipient.kind === "agent" ? (
																<Bot
																	size={16}
																	className="mt-0.5 shrink-0 text-ink-dim"
																	aria-hidden="true"
																/>
															) : (
																<UserRound
																	size={16}
																	className="mt-0.5 shrink-0 text-ink-dim"
																	aria-hidden="true"
																/>
															)}
															<span className="min-w-0 flex-1">
																<span
																	id={labelId}
																	className={cn(
																		"block truncate text-sm",
																		disabled ? "text-ink-dim" : "text-ink",
																	)}
																>
																	{candidate.recipient.label}
																</span>
																{/*
																 * ONLY A REASON IS SAID PER ROW. "Person; joins after
																 * accepting the invitation" used to repeat on every addable row,
																 * adding a line to each and pushing the Agents group below the
																 * fold at 720px - a heading over nothing, which is what this
																 * component's own rule forbids. The footer already states the
																 * consequence once, for the whole invitation.
																 */}
																{candidate.disabledReason && (
																	<span
																		id={reasonId}
																		className="block text-meta-sm text-ink-muted"
																	>
																		{reasonCopy(candidate.disabledReason)}
																	</span>
																)}
															</span>
															{/*
															 * The house `Checkbox`, not a raw input: a native box paints
															 * Chromium's accent and ignores every theme (design review D1).
															 * The row's handler skips clicks that land inside this
															 * wrapper, so a tick on the box toggles exactly once.
															 */}
															<span
																className="mt-0.5 shrink-0"
																data-row-checkbox=""
															>
																<Checkbox
																	checked={checked}
																	disabled={disabled}
																	onCheckedChange={() => toggle(candidate)}
																	aria-labelledby={labelId}
																	{...(candidate.disabledReason
																		? { "aria-describedby": reasonId }
																		: {})}
																/>
															</span>
														</div>
													);
												})}
											</fieldset>
										))
									)}
								</div>
							</>
						)}
					</section>
				</div>
				{mutationError && (
					<p role="alert" className="px-6 text-sm text-danger">
						{t("ui.teamBridge.members.mutation_error")}
					</p>
				)}
				<div className="flex items-center justify-between gap-3 rounded-b-lg bg-surface px-6 py-4">
					<p className="max-w-sm text-meta-sm text-ink-muted">
						{t("ui.teamBridge.members.invitation_note")}
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
							{t("ui.teamBridge.members.add", {
								count: selectedMembers.length,
							})}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
