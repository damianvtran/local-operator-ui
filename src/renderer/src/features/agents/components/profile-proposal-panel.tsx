/**
 * Human review of a proposed account-profile edit, in the profile's own pane.
 * The bearer-authenticated desktop action is the consent, just as in the editor;
 * no mesh membership, signing key, or biometric prompt is required. Core still
 * validates the image and checks the base under its definition lock.
 *
 * Keep a decided card's sentence until this record unmounts: an invalidated list
 * removes accepted/rejected rows, but that must not remove the only answer to
 * the person's click. A stale base is never silently rebased. Ask the originating
 * conversation for a fresh proposal; Reject remains safe and available.
 */
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import {
	useAcceptProposal,
	useProfileProposal,
	useProfileProposals,
	useRejectProposal,
} from "@shared/api/local-operator/profile-proposal-hooks";
import {
	PROFILE_PROPOSAL_STALE,
	type ProfileProposalDetail,
	type ProfileProposalKind,
	editedAfterBody,
	proposalsFor,
} from "@shared/api/local-operator/profile-proposals";
import { UnifiedDiff } from "@shared/components/common/unified-diff";
import { Button } from "@shared/components/ui/button";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../../../../../i18n/messages";

function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
	return (
		<div role="alert" className="space-y-2 text-body-sm text-danger">
			<p>{userFacingMessage(error, t("ui.agents.proposals.load_error"))}</p>
			<Button size="sm" variant="outline" onClick={retry}>
				{t("ui.agents.proposals.retry")}
			</Button>
		</div>
	);
}

function ProposalCard({
	id,
	kind,
	name,
	highlighted,
	onDecided,
}: {
	id: string;
	kind: ProfileProposalKind;
	name: string;
	highlighted: boolean;
	onDecided: (proposal: ProfileProposalDetail) => void;
}) {
	const detail = useProfileProposal(id);
	const accept = useAcceptProposal();
	const reject = useRejectProposal();
	const [editing, setEditing] = useState(false);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [conflict, setConflict] = useState(false);
	const section = useRef<HTMLElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const editToggle = useRef<HTMLButtonElement>(null);
	// Leaving edit mode by Cancel (button or Escape) must discard the draft:
	// the textarea re-seeds from `drafts`, and Accept sends `drafts`, so a kept
	// draft would let a later Edit → Accept write text the person cancelled
	// (QA Q-1). Focus goes back to the toggle so keyboard users land on the
	// control they used (UX U14). A different proposal remounts this card
	// (keyed by id), so its drafts never leak across records.
	const cancelEditing = () => {
		setDrafts({});
		setEditing(false);
		setError(null);
		editToggle.current?.focus({ preventScroll: true });
	};
	useEffect(() => {
		if (highlighted && detail.data) {
			section.current?.scrollIntoView?.({ block: "nearest" });
			heading.current?.focus({ preventScroll: true });
		}
	}, [highlighted, detail.data]);
	if (detail.isPending)
		return <output>{t("ui.agents.proposals.loading")}</output>;
	if (detail.isError)
		return (
			<LoadError error={detail.error} retry={() => void detail.refetch()} />
		);
	const proposal = detail.data;
	if (proposal.kind !== kind || proposal.name !== name) return null;
	const decided =
		proposal.state === "accepted" || proposal.state === "rejected";
	const stale = conflict || proposal.stale || proposal.state === "stale";
	const pending = proposal.state === "pending" || proposal.state === "stale";
	const busy = accept.isPending || reject.isPending;
	const decide = async (action: "accept" | "reject") => {
		if (busy || !pending || (action === "accept" && stale)) return;
		setError(null);
		try {
			const answer =
				action === "accept"
					? await accept.mutateAsync({
							id,
							...(editing
								? { after: editedAfterBody(proposal.changes, drafts) }
								: {}),
						})
					: await reject.mutateAsync({ id });
			// A preview is not an applied change. Only a server-declared terminal
			// state may replace this card with the success sentence.
			if (
				answer.proposal.state === "accepted" ||
				answer.proposal.state === "rejected"
			)
				onDecided(answer.proposal);
			else setError(t("ui.agents.proposals.not_applied"));
		} catch (cause) {
			if ((cause as { code?: string })?.code === PROFILE_PROPOSAL_STALE)
				setConflict(true);
			setError(
				cause instanceof SyntaxError
					? t("ui.agents.proposals.invalid_json")
					: userFacingMessage(cause, t("ui.agents.proposals.action_error")),
			);
		} finally {
			heading.current?.focus({ preventScroll: true });
		}
	};
	return (
		<section
			ref={section}
			data-proposal-id={id}
			className="space-y-3 rounded-md border border-hairline p-3"
		>
			<h3
				ref={heading}
				tabIndex={-1}
				className="font-medium text-ink outline-none"
			>
				{proposal.operation === "create"
					? t("ui.agents.proposals.title_create", { name })
					: t("ui.agents.proposals.title", { name })}
			</h3>
			{decided ? (
				<output>
					{t(
						proposal.state === "accepted"
							? "ui.agents.proposals.accepted"
							: "ui.agents.proposals.rejected",
						{ name },
					)}
				</output>
			) : (
				<>
					<p className="text-meta text-ink-muted">
						{/* The labels each diff is headed by, not raw field ids (UX U4). */}
						{t("ui.agents.proposals.fields", {
							fields: proposal.changes
								.map((change) => change.label || change.field)
								.join(", "),
						})}
					</p>
					{proposal.origin.trust === "untrusted" && (
						<p className="text-meta text-warning">
							{t("ui.agents.proposals.untrusted")}
						</p>
					)}
					{proposal.origin.session_id && (
						<Link
							className="text-meta text-accent underline"
							to={`/chat/${encodeURIComponent(proposal.origin.session_id)}`}
						>
							{t("ui.agents.proposals.open_conversation")}
						</Link>
					)}
					{stale && (
						<p role="alert" className="text-body-sm text-warning">
							{t("ui.agents.proposals.stale", { name })}
						</p>
					)}
					{!pending && (
						<output className="text-ink-muted">
							{t("ui.agents.proposals.unavailable")}
						</output>
					)}
					{proposal.changes.map((change) => (
						<div key={change.field} className="space-y-2">
							<label
								htmlFor={`${id}-${change.field}`}
								className="block text-body-sm font-medium"
							>
								{change.label || change.field}
							</label>
							{editing && (
								<textarea
									id={`${id}-${change.field}`}
									value={drafts[change.field] ?? change.after_text ?? ""}
									onChange={(event) =>
										setDrafts((current) => ({
											...current,
											[change.field]: event.target.value,
										}))
									}
									onKeyDown={(event) => {
										// Escape confirms an IME candidate while composing;
										// only a plain Escape cancels, and it stops here so
										// no enclosing surface also closes on it (QA Q-2).
										if (event.key !== "Escape" || event.nativeEvent.isComposing)
											return;
										event.preventDefault();
										event.stopPropagation();
										cancelEditing();
									}}
									disabled={busy || stale}
									rows={6}
									className="w-full rounded-sm border border-hairline bg-sunken p-2 font-mono text-mono-sm text-ink focus-visible:outline-accent"
								/>
							)}
							<UnifiedDiff
								before={change.before_text ?? ""}
								after={
									editing
										? (drafts[change.field] ?? change.after_text ?? "")
										: (change.after_text ?? "")
								}
								labels={{
									before: t("ui.agents.proposals.current"),
									after: t("ui.agents.proposals.proposed"),
								}}
								// Stable while the draft is typed into, so folds and the
								// next-change position survive each keystroke (UX U7).
								resetKey={`${id}:${change.field}`}
								maxHeight={360}
							/>
						</div>
					))}
					{pending && (
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								variant="outline"
								data-testid="proposal-accept"
								disabled={busy || stale}
								onClick={() => void decide("accept")}
							>
								{busy && accept.isPending
									? t("ui.agents.proposals.applying")
									: editing
										? t("ui.agents.proposals.accept_edits")
										: t("ui.agents.proposals.accept")}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								ref={editToggle}
								disabled={busy || stale}
								onClick={() => {
									if (editing) cancelEditing();
									else {
										setEditing(true);
										setError(null);
									}
								}}
							>
								{t(
									editing
										? "ui.agents.proposals.cancel_edit"
										: "ui.agents.proposals.edit",
								)}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								data-testid="proposal-reject"
								onClick={() => void decide("reject")}
							>
								{reject.isPending
									? t("ui.agents.proposals.rejecting")
									: t("ui.agents.proposals.reject")}
							</Button>
							{/*
							 * Also after ANY failed decision: the error sentence tells the
							 * person to refresh before retrying, so the control must exist
							 * whenever it is shown (UX U8), not only for a stale base.
							 */}
							{(stale || error) && (
								<Button
									size="sm"
									variant="ghost"
									disabled={busy}
									onClick={() => {
										setError(null);
										void detail.refetch();
									}}
								>
									{t("ui.agents.proposals.refresh")}
								</Button>
							)}
						</div>
					)}
					{error && (
						<p role="alert" className="text-body-sm text-danger">
							{error}
						</p>
					)}
				</>
			)}
		</section>
	);
}

/** Focus once, not on each badge poll or ref callback reattachment. */
function DecisionNotice({
	proposal,
	name,
}: { proposal: ProfileProposalDetail; name: string }) {
	const result = useRef<HTMLOutputElement>(null);
	useEffect(() => {
		result.current?.focus({ preventScroll: true });
	}, []);
	return (
		<output
			ref={result}
			tabIndex={-1}
			className="block rounded-md border border-hairline p-3 text-ink"
		>
			{t(
				proposal.state === "accepted"
					? "ui.agents.proposals.accepted"
					: "ui.agents.proposals.rejected",
				{ name },
			)}
		</output>
	);
}

export function ProfileProposalPanel({
	kind,
	name,
	enabled,
	proposalId,
}: {
	kind: ProfileProposalKind;
	name: string;
	enabled: boolean;
	proposalId?: string | null;
}) {
	useI18nLocale();
	const list = useProfileProposals(enabled);
	const [decisions, setDecisions] = useState<
		Record<string, ProfileProposalDetail>
	>({});
	if (!enabled) return null;
	const proposals = proposalsFor(list.data, kind, name);
	const ids = new Set(proposals.map((p) => p.id));
	// A direct link must still show the decided proposal after the pending list
	// drops it. The detail endpoint is the authority for its final state.
	if (proposalId) ids.add(proposalId);
	for (const id of Object.keys(decisions)) ids.delete(id);
	if (
		!list.isPending &&
		!list.isError &&
		!ids.size &&
		!Object.keys(decisions).length
	)
		return null;
	return (
		<section
			data-testid="profile-proposal-panel"
			aria-label={t("ui.agents.proposals.accessible")}
			className="mb-8 space-y-3 text-body-sm"
		>
			{list.isPending && (
				<output className="animate-pulse text-ink-muted">
					{t("ui.agents.proposals.loading")}
				</output>
			)}
			{list.isError && (
				<LoadError error={list.error} retry={() => void list.refetch()} />
			)}
			{[...ids].map((id) => (
				<ProposalCard
					key={id}
					id={id}
					kind={kind}
					name={name}
					highlighted={proposalId === id}
					onDecided={(proposal) =>
						setDecisions((current) => ({ ...current, [id]: proposal }))
					}
				/>
			))}
			{Object.values(decisions).map((proposal) => (
				<DecisionNotice key={proposal.id} proposal={proposal} name={name} />
			))}
		</section>
	);
}
