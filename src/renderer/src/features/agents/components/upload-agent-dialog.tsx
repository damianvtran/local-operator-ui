/**
 * @file upload-agent-dialog.tsx
 * @description The publish confirmation: what leaves the machine, what the hub refused, and what to do next.
 *
 * Three things happen here, and they are the three the hub contract asks of this
 * surface (§6.2-§6.4).
 *
 * **What is published is stated, not implied.** The old consent list named
 * "Conversation history", "Execution history", "Learnings and memory" and
 * "Current plan (if any)" — four things the backend has stripped from a published
 * archive for some time (contract D-1). The dialog was describing a leak that no
 * longer happens, which is the single most misleading string in this flow: an
 * author reading it cannot tell whether publishing is safe, and one who knows it
 * is stale cannot tell what the dialog is worth. The list now says what a
 * publication IS — an instruction set — and says plainly what does not leave.
 *
 * **The refusals are separate, and each gets its own next step.** A name somebody
 * else holds, a name the built-ins reserve, instructions the reviewer refused, a
 * review that could not run at all, a document the validator refused, a listing
 * that belongs to another account — all of those used to arrive as one prose
 * toast. They are rendered IN this dialog (not as a toast) because the owner of
 * the surface is the user's next action, and because the toast manager collapses
 * two messages that share a sentence inside five seconds, which is how two
 * different refusals arrive as one.
 *
 * **What can be checked locally is checked before submitting** (§6.3): the
 * document's own rules, the built-ins' reserved names, and — live, as the user
 * types — whether the hub already holds the name. Submit is disabled while a
 * local rule is broken, and it says why, because a disabled button with no
 * explanation is the failure the branding contract's "disabled changes colour,
 * never opacity" exists to expose.
 */

import type {
	PublicationDocumentOverride,
	PublishedListing,
} from "@shared/api/local-operator/agents-api";
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import { useProfiles } from "@shared/api/local-operator/profile-hooks";
import { isPublicationError } from "@shared/api/local-operator/publication-errors";
import { RadientAuthButtons } from "@shared/components/auth/radient-auth-buttons";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Checkbox,
	Input,
	Label,
} from "@shared/components/ui";
import { useAgentSystemPrompt } from "@shared/hooks/use-agent-system-prompt";
import { usePublishedListing } from "@shared/store/published-listings-store";
import type { FC } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentNameAvailability } from "../hooks/use-agent-name-availability";
import { usePublishAgent } from "../hooks/use-publish-agent";
import {
	type PublicationAction,
	type PublicationFailure,
	publicationTreatment,
} from "../utils/publication-failure";
import {
	isReservedBuiltinName,
	publicationIssues,
	toolsFromAgentTags,
} from "../utils/publication-validation";

/**
 * Props for the UploadAgentDialog component.
 *
 * The dialog owns the whole publish decision, including the request: three
 * surfaces mount it (the agents page header, the agent list's row menu, and the
 * legacy agent settings page), and every one of them used to wire its own handler
 * — one of which published nothing at all and silently closed. One component
 * with one implementation is the only version of this that cannot disagree with
 * itself.
 */
type UploadAgentDialogProps = {
	/** Whether the dialog is open */
	open: boolean;
	/** Callback when the dialog is closed */
	onClose: () => void;
	/** The local agent being published, or null when nothing is selected */
	agent: {
		id: string;
		name: string;
		description: string;
		tags?: string[];
	} | null;
	/** Whether the user is authenticated with Radient */
	isAuthenticated: boolean;
	/** Optional callback for after successful sign-in via the dialog */
	onSignInSuccess?: () => void;
	/** Called when the hub accepts a publication, with its result */
	onPublished?: (listing: PublishedListing, republished: boolean) => void;
};

/** A publication the hub accepted, as the dialog reports it. */
type PublishedOutcome = {
	name: string;
	hubAgentId: string | null;
	republished: boolean;
};

export const UploadAgentDialog: FC<UploadAgentDialogProps> = ({
	open,
	onClose,
	agent,
	isAuthenticated,
	onSignInSuccess,
	onPublished,
}) => {
	const [agreedToTerms, setAgreedToTerms] = useState(false);
	// The name is editable, and it is the field every name refusal points at: a
	// taken name has exactly one useful next step, and it is this control.
	const [name, setName] = useState("");
	const [failure, setFailure] = useState<PublicationFailure | null>(null);
	const [published, setPublished] = useState<PublishedOutcome | null>(null);
	const nameInput = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();
	const publish = usePublishAgent();
	const listing = usePublishedListing(agent?.id ?? null);

	// Generated rather than a literal: three surfaces mount this dialog and two
	// can be in the tree at once, so a fixed id would make one label toggle the
	// other dialog's checkbox.
	const termsCheckboxId = useId();
	const nameInputId = useId();

	const { data: instructions } = useAgentSystemPrompt(
		open && agent ? agent.id : "",
	);
	const { data: profiles } = useProfiles(open);

	/*
	 * Seeded from the agent rather than from the store: the store remembers which
	 * LISTING this row was published as, and the name the user edits is the one
	 * that will be published now.
	 */
	useEffect(() => {
		if (open) setName(agent?.name ?? "");
	}, [open, agent?.name]);

	useEffect(() => {
		if (!open) {
			setAgreedToTerms(false);
			setFailure(null);
			setPublished(null);
		}
	}, [open]);

	const builtinNames = useMemo(
		() =>
			(profiles ?? [])
				.filter((profile) => profile.source === "builtin")
				.map((profile) => profile.name),
		[profiles],
	);

	const reserved = isReservedBuiltinName(name, builtinNames);
	const availability = useAgentNameAvailability(name, open && isAuthenticated);

	/*
	 * The blocked-field list, extended rather than replaced: it was the dialog's
	 * one mechanism for "this cannot be submitted and here is why", and the
	 * document rules plus the locally-known reservation are more of the same
	 * question. The hub's own answers (a name it already holds, a rule it cites)
	 * come back as a treatment below instead, because they arrive with a code and a
	 * different next step.
	 */
	const issues = useMemo(() => {
		const list = publicationIssues({
			name,
			description: agent?.description ?? "",
			// `null` while the body is still loading, which is not a violation.
			instructions: instructions ?? null,
			tools: toolsFromAgentTags(agent?.tags),
		});
		if (reserved) {
			// The same sentence the hub's `name_reserved_builtin` refusal gets, taken
			// from the treatment table rather than written twice.
			list.unshift({
				field: "name",
				message: publicationTreatment(
					{ code: "name_reserved_builtin", message: "" },
					{ name, hubAgentId: null },
				).body,
			});
		}
		return list;
	}, [name, agent?.description, agent?.tags, instructions, reserved]);

	const treatment = failure
		? publicationTreatment(failure, {
				name,
				hubAgentId: listing?.hubAgentId ?? null,
			})
		: null;

	const submitting = publish.isPending;

	const submit = async () => {
		if (!agent || submitting || issues.length > 0) return;
		setFailure(null);
		try {
			/*
			 * Only the name is overridden. Everything else in the document is read
			 * from the local row by the backend, which is where the instruction body
			 * actually lives — a second copy of it here is a second thing that can
			 * drift out of step with what the author wrote.
			 */
			const document: PublicationDocumentOverride = { name: name.trim() };
			const response = await publish.mutateAsync({
				agentId: agent.id,
				document,
				hubAgentId: listing?.hubAgentId ?? null,
			});
			const result = response.result;
			const outcome: PublishedOutcome = {
				name: result?.name ?? name.trim(),
				hubAgentId: result?.agent_id ?? null,
				republished: Boolean(listing?.hubAgentId),
			};
			setPublished(outcome);
			// Only when the hub returned a listing to point at: there is nothing to
			// report about a publication whose own result the wire did not carry.
			if (result) onPublished?.(result, outcome.republished);
		} catch (error) {
			// The refusal stays in the dialog. `isPublicationError` is the typed half;
			// anything else keeps whatever sentence the transport authored, which is
			// what an older backend's prose is.
			setFailure(
				isPublicationError(error)
					? {
							code: error.code,
							message: error.message,
							details: error.details,
						}
					: {
							message: userFacingMessage(
								error,
								"The agent could not be published. Try again.",
							),
						},
			);
		}
	};

	const runAction = (action: PublicationAction) => {
		switch (action) {
			case "focus-name":
				// The refusal is cleared because it is about the name that is no longer
				// in the field: leaving it up while the user types would keep answering
				// the previous question.
				setFailure(null);
				setName("");
				requestAnimationFrame(() => nameInput.current?.focus());
				break;
			case "update-listing": {
				const existing = failure?.details?.existing_agent_id;
				if (existing) {
					onClose();
					navigate(`/agent-hub/${existing}`);
				}
				break;
			}
			case "install-builtin": {
				const builtin =
					failure?.details?.builtin_name ?? availability.builtinName;
				if (builtin) {
					onClose();
					navigate(`/agents/${encodeURIComponent(builtin)}`);
				}
				break;
			}
			case "edit-instructions":
				// The instruction body is edited on the agent's own page; this dialog
				// has no field for it, and inventing one would be a second editor with
				// its own save path.
				if (agent) {
					onClose();
					navigate(`/agents/${agent.id}`);
				}
				break;
			case "refresh-hub":
				onClose();
				navigate("/agent-hub");
				break;
			case "retry":
				void submit();
				break;
		}
	};

	const agentName = agent?.name ?? "";
	const title = listing
		? `Update the Agent hub listing for "${agentName}"?`
		: `Publish "${agentName}" to the Agent hub?`;

	const actions = published ? (
		<>
			<SecondaryButton
				onClick={onClose}
				data-tour-tag="upload-agent-dialog-cancel-button"
			>
				Close
			</SecondaryButton>
			{published.hubAgentId && (
				<PrimaryButton
					onClick={() => {
						onClose();
						navigate(`/agent-hub/${published.hubAgentId}`);
					}}
				>
					Open the listing
				</PrimaryButton>
			)}
		</>
	) : treatment ? (
		<>
			<SecondaryButton
				onClick={onClose}
				data-tour-tag="upload-agent-dialog-cancel-button"
			>
				Close
			</SecondaryButton>
			{treatment.actions.map((action, index) =>
				// The first action is the primary: the order is the contract's, and it
				// puts the one step that resolves the refusal first.
				index === 0 ? (
					<PrimaryButton
						key={action}
						onClick={() => runAction(action)}
						disabled={submitting}
					>
						{ACTION_LABEL[action]}
					</PrimaryButton>
				) : (
					<SecondaryButton
						key={action}
						onClick={() => runAction(action)}
						disabled={submitting}
					>
						{ACTION_LABEL[action]}
					</SecondaryButton>
				),
			)}
		</>
	) : (
		<>
			<SecondaryButton
				onClick={onClose}
				data-tour-tag="upload-agent-dialog-cancel-button"
			>
				Cancel
			</SecondaryButton>
			{isAuthenticated && (
				<PrimaryButton
					data-testid="publish-submit"
					onClick={() => void submit()}
					disabled={
						!agreedToTerms || issues.length > 0 || !name.trim() || submitting
					}
				>
					{submitting ? "Publishing…" : listing ? "Update listing" : "Publish"}
				</PrimaryButton>
			)}
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={title}
			maxWidth="sm"
			fullWidth
			actions={actions}
			dataTourTag="upload-agent-dialog"
		>
			<div className="flex flex-col gap-4">
				{!isAuthenticated ? (
					<div className="flex flex-col items-center gap-6 text-center">
						<p className="text-body text-ink">
							You need to be signed in to Radient to publish agents to the Agent
							hub.
						</p>
						<RadientAuthButtons
							titleText="Sign in to continue"
							descriptionText=""
							onSignInSuccess={onSignInSuccess}
						/>
					</div>
				) : published ? (
					/*
					 * `aria-live` alone rather than `role="status"`: the role asks for an
					 * `<output>` element, which this callout is not (it is the shared
					 * Alert), and the polite live region is the part that actually
					 * announces the outcome. Polite rather than `alert` because this
					 * confirms work that is already done instead of interrupting it —
					 * the same reasoning `working-line.tsx` records for its own region.
					 */
					<Alert variant="success" aria-live="polite">
						<AlertTitle>
							{published.republished
								? "Listing updated"
								: "Published to the hub"}
						</AlertTitle>
						<AlertDescription>
							{published.republished
								? `The hub now holds the current instruction set of "${published.name}".`
								: `"${published.name}" is on the hub as an instruction set. Anyone can read and install it.`}
						</AlertDescription>
						<AlertDescription className="text-ink-muted">
							Nothing else left this machine: no conversation, no execution
							history, no memory, no plan and no machine-specific configuration.
						</AlertDescription>
					</Alert>
				) : treatment && failure ? (
					/*
					 * `role="alert"` here rather than on the Alert primitive: this node
					 * MOUNTS in response to the user submitting, which is the case the
					 * primitive's own comment says belongs to the caller.
					 */
					<Alert variant={treatment.variant} role="alert">
						<AlertTitle>{treatment.headline}</AlertTitle>
						<AlertDescription>{treatment.body}</AlertDescription>
						{treatment.note && (
							<AlertDescription className="text-ink-muted">
								{treatment.note}
							</AlertDescription>
						)}
					</Alert>
				) : null}

				{!published && !treatment && (
					<>
						<p className="text-body text-ink">
							You are about to publish this agent's instruction set to the
							public Agent hub. What is published is what describes the agent:
						</p>
						<ul className="list-disc space-y-1 pl-5 text-body text-ink-muted">
							<li>Its name and description</li>
							<li>Its instructions</li>
							<li>Its tool surface, effort and delegation, when it has them</li>
						</ul>
						<p className="text-body text-ink">
							Nothing else leaves this machine: no conversation, no execution
							history, no memory or learnings, no plan, and no machine-specific
							configuration. Anyone can read and install what you publish.
						</p>

						{issues.length > 0 && (
							// The one boundary inside the dialog: this list has to read as a
							// blocker rather than as more body copy, and it is what disables
							// the submit button.
							<Alert variant="danger">
								<AlertTitle>This agent cannot be published yet</AlertTitle>
								<ul className="list-disc space-y-1 pl-5">
									{issues.map((issue) => (
										<li key={`${issue.field}:${issue.message}`}>
											{issue.message}
										</li>
									))}
								</ul>
							</Alert>
						)}

						<div className="flex flex-col gap-1.5">
							<Label htmlFor={nameInputId}>Name on the hub</Label>
							<Input
								id={nameInputId}
								ref={nameInput}
								value={name}
								onChange={(event) => setName(event.target.value)}
								autoComplete="off"
								spellCheck={false}
								aria-invalid={issues.some((issue) => issue.field === "name")}
								aria-describedby={`${nameInputId}-hint`}
							/>
							<p
								id={`${nameInputId}-hint`}
								className="text-meta text-ink-muted"
							>
								No spaces, and no "/", "\" or ":". Up to 128 characters.
							</p>
							{availabilityLine(availability, name)}
						</div>

						<div className="flex gap-3">
							{/* The box is centred in the first line of the consent text
							    rather than nudged with a margin, so it stays aligned if the
							    copy rewraps. */}
							<span className="flex h-5 shrink-0 items-center">
								<Checkbox
									id={termsCheckboxId}
									name="termsAgreement"
									// A stable hook for the stories that have to SUBMIT to reach
									// a refusal: the states this dialog exists for cannot be
									// photographed without pressing the two controls that get
									// there.
									data-testid="publish-consent"
									checked={agreedToTerms}
									onCheckedChange={(checked) =>
										setAgreedToTerms(checked === true)
									}
								/>
							</span>
							<Label
								htmlFor={termsCheckboxId}
								className="block font-normal text-body text-ink"
							>
								I confirm that I have read and agree to the{" "}
								{/* An anchor is interactive content, so clicking it does not
								    also toggle the checkbox the label owns. */}
								<a
									href="https://radienthq.com/terms"
									target="_blank"
									rel="noopener noreferrer"
									className="text-accent underline-offset-4 hover:text-accent-hover hover:underline"
								>
									terms and conditions
								</a>{" "}
								and that this agent does not contain malicious content or
								violate usage policies.
							</Label>
						</div>
					</>
				)}

				{(published || treatment) && agentName && (
					// The refusal is about this agent, and the dialog's own title is the
					// only other place that says which one — worth restating once the
					// title has scrolled out of the reader's attention.
					<p className="text-meta text-ink-muted">Agent: {agentName}</p>
				)}
			</div>
		</BaseDialog>
	);
};

/**
 * What the hub says about the name being typed, or nothing at all.
 *
 * Deliberately never a semantic ink, and never a reason to disable submit on its
 * own: `taken` and `reserved` come from a courtesy check that can be a second
 * stale, and a client gate built on a stale answer blocks a publication the hub
 * would accept. The refusal that counts arrives from the publication itself,
 * where it comes with a code and a next step. What this line buys is that the
 * author usually finds out before submitting.
 */
const availabilityLine = (
	availability: { state: string; builtinName: string | null },
	name: string,
) => {
	switch (availability.state) {
		case "checking":
			return (
				<p className="text-meta text-ink-muted">
					Checking whether this name is free…
				</p>
			);
		case "available":
			return <p className="text-meta text-ink-muted">This name is free.</p>;
		case "taken":
			return (
				<p className="text-meta text-ink">
					This name is already published on the hub.
				</p>
			);
		case "reserved":
			return (
				<p className="text-meta text-ink">
					{availability.builtinName
						? `"${availability.builtinName}" is the name of a built-in agent, which the hub reserves.`
						: `"${name.trim()}" is a name the hub reserves for its built-in agents.`}
				</p>
			);
		default:
			// "unknown" renders nothing: an unanswered courtesy check is not a refusal,
			// and a sentence saying so would put a warning on a name that is probably
			// fine.
			return null;
	}
};

/** The label each treatment action carries (contract §6.2). */
const ACTION_LABEL: Record<PublicationAction, string> = {
	"focus-name": "Choose another name",
	"update-listing": "Update the existing listing",
	"install-builtin": "Install the built-in instead",
	retry: "Try again",
	"edit-instructions": "Edit the instructions",
	"refresh-hub": "Refresh the hub",
};

/** Re-exported so a story can build the same dialog with mocked inputs. */
export type { UploadAgentDialogProps };
