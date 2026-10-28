import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
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
import { useEffect, useId, useMemo, useState } from "react";
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
	onRetryPeople?: () => void;
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
	onRetryPeople,
	onAdd,
	onRemove,
}: TeamBridgeAddMembersViewProps) {
	useI18nLocale();
	const headingId = useId();
	const searchId = useId();
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	useEffect(() => {
		if (open) {
			setQuery("");
			setSelected(new Set());
		}
	}, [open]);

	const chiefLabel = (agent: string, person: string) =>
		agent.trim()
			? t("ui.teamBridge.chief.label", { agent, person })
			: t("ui.teamBridge.chief.unnamed", { person });
	const candidates = memberCandidates(
		conversation,
		people,
		selfAccountId,
		chiefLabel,
	);
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
				className="max-h-[min(780px,90dvh)] max-w-2xl overflow-hidden p-0"
				closeDisabled={pending}
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
						<div className="min-h-0 space-y-1 md:overflow-y-auto md:pe-2">
							{members.length === 0 ? (
								<p className="text-sm text-ink-muted">
									{t("ui.teamBridge.members.current_empty")}
								</p>
							) : (
								members.map(({ member, label, state, removable }) => {
									const removing = pendingKey === `remove:${member.account_id}`;
									return (
										<div
											key={`${member.kind}:${member.account_id}:${state}`}
											className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2"
										>
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
														: state === "invited"
															? t("ui.teamBridge.members.state.invited")
															: t("ui.teamBridge.members.state.left")}
													{removing &&
														` · ${t("ui.teamBridge.members.removing")}`}
												</p>
											</div>
											{removable && (
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
													onClick={() => onRemove(member.account_id)}
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
								{onRetryPeople && (
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={onRetryPeople}
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
										value={query}
										onChange={(event) => setQuery(event.target.value)}
										placeholder={t("ui.teamBridge.members.search")}
										aria-label={t("ui.teamBridge.members.search")}
										className="ps-9"
										disabled={!canInvite || pending}
									/>
								</div>
								<div className="min-h-0 space-y-1 md:overflow-y-auto md:pe-2">
									{filtered.length === 0 ? (
										<p className="px-2 py-4 text-sm text-ink-muted">
											{people.length === 0
												? t("ui.teamBridge.members.empty")
												: t("ui.teamBridge.members.no_matches")}
										</p>
									) : (
										filtered.map((candidate, index) => {
											const key = recipientKey(candidate.recipient);
											const checked =
												selected.has(key) && candidate.disabledReason === null;
											const disabled =
												!canInvite ||
												candidate.disabledReason !== null ||
												pending;
											const reasonId = `${searchId}-reason-${index}`;
											return (
												<label
													key={key}
													className={cn(
														"flex w-full items-start gap-3 rounded-md border border-transparent px-2 py-2",
														disabled
															? "cursor-not-allowed"
															: "cursor-pointer hover:bg-row-hover",
														checked && "border-control bg-surface",
													)}
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
															className={cn(
																"block truncate text-sm",
																disabled ? "text-ink-dim" : "text-ink",
															)}
														>
															{candidate.recipient.label}
														</span>
														<span
															id={reasonId}
															className="block text-meta-sm text-ink-muted"
														>
															{candidate.disabledReason
																? reasonCopy(candidate.disabledReason)
																: candidate.recipient.kind === "agent"
																	? t("ui.teamBridge.members.agent_invitation")
																	: t("ui.teamBridge.members.human_invitation")}
														</span>
													</span>
													{/*
													 * A native checkbox, not role="checkbox": the app's base
													 * layer already gives it the control cursor and the
													 * disabled rule. `aria-describedby` carries the reason, so
													 * an unavailable row explains itself to a screen reader.
													 */}
													<input
														type="checkbox"
														className="mt-1 shrink-0"
														checked={checked}
														disabled={disabled}
														onChange={() => toggle(candidate)}
														aria-describedby={reasonId}
													/>
												</label>
											);
										})
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
				<div className="flex items-center justify-between gap-3 border-t border-hairline px-6 py-4">
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
							{t("ui.teamBridge.members.add")}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
