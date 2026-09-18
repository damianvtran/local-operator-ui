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
import { cn } from "@shared/lib/utils";
import {
	usePublishedListing,
	usePublishedListingsStore,
} from "@shared/store/published-listings-store";
import type { FC } from "react";
import {
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
	// Whether the sign-in control the `hub_unauthorized` refusal offers is open.
	const [reauthenticating, setReauthenticating] = useState(false);
	const nameInput = useRef<HTMLInputElement>(null);
	const resultRegion = useRef<HTMLDivElement>(null);
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
			setReauthenticating(false);
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

	/**
	 * Publish this agent, as a new listing unless the app remembers one for it.
	 *
	 * `asNewListing` OVERRIDES that memory, and it exists because the memory can
	 * be STALE: a listing that was delisted, or that belongs to another account,
	 * turns every later attempt into a republish of a row the user cannot address,
	 * and it is only this app's persisted note that made the attempt an update in
	 * the first place. The escape is offered on exactly those refusals, and it has
	 * to send the request the store's presence would otherwise prevent — reading
	 * the store again here would undo the action that was just pressed.
	 */
	const submit = async (options?: { asNewListing?: boolean }) => {
		if (!agent || submitting || issues.length > 0) return;
		setFailure(null);
		const hubAgentId = options?.asNewListing
			? null
			: (listing?.hubAgentId ?? null);
		/*
		 * Captured BEFORE the request. The accepted-publication path writes the
		 * store on the way back, so a receipt that read it afterwards would report
		 * "update" whatever actually happened — which is the title defect this
		 * value's one reader exists to remove.
		 */
		const republishing = Boolean(hubAgentId);
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
				hubAgentId,
			});
			const result = response.result;
			const outcome: PublishedOutcome = {
				name: result?.name ?? name.trim(),
				hubAgentId: result?.agent_id ?? null,
				republished: republishing,
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
				/*
				 * The refusal is cleared — it is about a name the user is about to change,
				 * and leaving it up while they type would keep answering the previous
				 * question — but the VALUE IS KEPT AND SELECTED. Clearing it made this
				 * dialog report "Name must not be empty." immediately afterwards, a failure
				 * the app caused, drawn as the user's; selecting the text is what typing
				 * over it needs, which is what the clear was for.
				 */
				setFailure(null);
				requestAnimationFrame(() => {
					nameInput.current?.focus();
					nameInput.current?.select();
				});
				break;
			case "update-listing": {
				// The refusal's own id first — it names the row the hub just said it holds —
				// and the remembered one as the fallback the treatment's gate also accepts.
				const existing =
					failure?.details?.existing_agent_id ?? listing?.hubAgentId;
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
					/*
					 * The reusable-PROFILE surface, which is where the Install control is.
					 * Not `/agents/<name>`: that route's param resolves through an id-keyed
					 * lookup (`GET /v1/agents/<param>`), and a built-in's name is not its
					 * id, so the name landed on that page's "No agent selected" empty state
					 * — an action that navigated somewhere and offered nothing.
					 */
					navigate(`/agents?kind=agent&name=${encodeURIComponent(builtin)}`);
				}
				break;
			}
			case "edit-instructions":
			case "edit-agent":
				// The instruction body, the description and the rest of the document are
				// edited on the agent's own page; this dialog has no field for them, and
				// inventing one would be a second editor with its own save path.
				if (agent) {
					onClose();
					navigate(`/agents/${agent.id}`);
				}
				break;
			case "publish-as-new":
				/*
				 * The escape from a remembered listing this account cannot address.
				 * Dropping the record is what makes the next attempt a publication of a NEW
				 * listing rather than an update of a row the user cannot reach; it is a
				 * deliberate press, so nothing is published that was not asked for.
				 */
				if (agent) usePublishedListingsStore.getState().forget(agent.id);
				void submit({ asNewListing: true });
				break;
			case "sign-in":
				// The remedy is a control this dialog already owns — the credential the
				// hub refused is the one the Radient sign-in replaces; the refusal state
				// simply had no way to reach it.
				setReauthenticating(true);
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
	/*
	 * The title describes the action, and once the action has been ANSWERED it
	 * describes what happened: a receipt is not a question about updating. WHY it is
	 * not derived from `listing` alone: an accepted publication writes
	 * `published-listings-store` while this dialog is still open, so a first publish
	 * flipped its own headline to "Update the Agent hub listing …" above a panel
	 * saying the listing was CREATED — and the two states became impossible to tell
	 * apart from their own frames.
	 */
	const title = published
		? published.republished
			? `Updated the Agent hub listing for "${agentName}"`
			: `Published "${agentName}" to the Agent hub`
		: listing
			? `Update the Agent hub listing for "${agentName}"?`
			: `Publish "${agentName}" to the Agent hub?`;

	/*
	 * Where focus goes when a RESULT renders, and why it goes to a SINK.
	 *
	 * WHAT WAS WRONG. Radix moves focus into the dialog container as the panel
	 * opens, and this dialog's own submit button leaves the DOM the moment an
	 * outcome replaces the form. Blink then resolves the focus that element was
	 * holding DURING that mutation, and the target it picks is not fixed: sometimes
	 * the container, sometimes the newly rendered action row. So the result states
	 * drew the theme's 2px accent ring around whatever won — a ring pointing at
	 * something nobody can use, the accent spent twice in the light themes — and
	 * left Enter doing nothing.
	 *
	 * WHY NOT "FOCUS THE PRIMARY ACTION", which is the obvious repair and the one
	 * this change shipped first. It does pin WHERE focus goes (a layout effect runs
	 * after the mutations and before the paint, so it beats the engine's fixup), but
	 * it does NOT pin whether the ring is DRAWN. `:focus-visible` for a
	 * programmatically focused element is decided from the engine's last-interaction
	 * modality — the app cannot set that, and in this rig a synthetic click does not
	 * set it deterministically — so the same code photographed a ringed primary
	 * action on one theme-pass and a bare one on the next. Measured: two
	 * twelve-theme passes of `published`, 1-2 themes flipping between exactly two
	 * hashes, the difference confined to the footer's action row (`204x72+604+520`,
	 * max delta 13/255, sub-perceptual, which is why a `-fuzz 5%` comparison had
	 * called it clean). A frame that records the engine's modality guess is not
	 * reproducible evidence.
	 *
	 * SO THE RING IS REMOVED INSTEAD, on a region that is not a control, and the
	 * panel's own container is silenced with it (`dialogProps` on the primitive
	 * below). The sink is a plain container: it carries `outline-none`, which is the
	 * stylesheet's own sanctioned case ("focus is moved there programmatically and a
	 * ring would be noise" — `styles/index.css`), and it is the only thing focused in
	 * these states, so no ring can appear wherever the engine's heuristic lands. The
	 * actions stay reachable in one Tab press, which is where their own rings come
	 * from.
	 *
	 * Keyed on the two pieces of state rather than on the derived treatment: the
	 * treatment object is rebuilt on every render, so an effect on it would steal
	 * focus back from the user while they type.
	 */
	useLayoutEffect(() => {
		if (!failure && !published) return;
		resultRegion.current?.focus();
	}, [failure, published]);

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
			{/*
			 * The pre-flight block names fields this dialog has NO control for (the
			 * description, the instruction body), so the block gets a route with them:
			 * the agent's own page holds both. Without it the state was a list of
			 * problems above a disabled button and nothing to do about them — the same
			 * defect the refusal treatments now answer for the fields they name.
			 */}
			{issues.some((issue) => issue.field !== "name") && (
				<SecondaryButton
					onClick={() => {
						if (agent) {
							onClose();
							navigate(`/agents/${agent.id}`);
						}
					}}
				>
					Edit the agent
				</SecondaryButton>
			)}
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
			/*
			 * The container is a focus SINK, not a control: Radix moves focus onto it as
			 * the panel opens, and it is the element that holds focus in every pre-submit
			 * state. A ring around the whole panel is a ring around something nobody can
			 * use — the defect design round 1 filed as D5 — and, because `:focus-visible`
			 * for a programmatically focused element is decided by the engine's
			 * last-interaction modality, whether that ring is DRAWN flips between
			 * otherwise-identical passes. That is what made `pre-validation-blocked`'s
			 * frames unreproducible even after the result states were pinned.
			 *
			 * Scoped to this dialog through `dialogProps` rather than changed in
			 * `BaseDialog`, deliberately: the primitive is shared with five other dialogs
			 * whose frames this change does not re-take, and a shared visual change would
			 * silently invalidate them. `outline-none` here is the stylesheet's own
			 * sanctioned case for it ("focus is moved there programmatically and a ring
			 * would be noise"), and it is why the container keeps `tabIndex` and the
			 * focus trap: only the ring goes.
			 */
			dialogProps={{ className: "outline-none" }}
		>
			{/*
			 * The result region is also the focus SINK for a refusal or a receipt: see
			 * the layout effect above for why focus is moved here rather than onto the
			 * action, and `styles/index.css` for the `outline-none` case it is the
			 * sanctioned example of. In the pre-submit states the sink is not focusable
			 * and the ring belongs to the name field, which is where Radix puts focus.
			 */}
			<div
				ref={resultRegion}
				tabIndex={failure || published ? -1 : undefined}
				className={cn(
					"flex flex-col gap-4",
					(failure || published) && "outline-none",
				)}
			>
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

				{treatment && reauthenticating && (
					/*
					 * The `hub_unauthorized` remedy. This is the sign-in control rather than
					 * the signed-out panel above because the two facts are different: the app's
					 * own `isAuthenticated` can be true while the hub refuses the credential
					 * this machine presents, which is exactly when the backend emits that code.
					 */
					<div className="flex flex-col items-center gap-6 text-center">
						<p className="text-body text-ink">
							Sign in to Radient again to replace the credential the hub
							refused.
						</p>
						<RadientAuthButtons
							titleText="Sign in again"
							descriptionText=""
							onSignInSuccess={() => {
								// The refusal was about the credential, so it stops being the question
								// on screen the moment a new one is in hand.
								setReauthenticating(false);
								setFailure(null);
								onSignInSuccess?.();
							}}
						/>
					</div>
				)}

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
								{/*
								 * No word about spaces. The hub is mid-relaxation on exactly that rule
								 * and stores names spelled the way a person spells them, so a hint
								 * promising "no spaces" would state a rule the server does not have
								 * — and a reader who believed it would stop typing the name they
								 * wanted. The separators and the cap are the rules that hold.
								 */}
								No "/", "\" or ":". Up to 128 characters.
							</p>
							{availabilityLine(availability)}
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
const availabilityLine = (availability: {
	state: string;
	builtinName: string | null;
}) => {
	switch (availability.state) {
		case "checking":
			return (
				<p className="text-meta text-ink-muted">
					Checking whether this name is free…
				</p>
			);
		case "available":
			/*
			 * "Looks free", not "is free". The availability route deliberately does
			 * not consult the seconds-long reservations a publish holds, so a name can
			 * read as free here and still come back `name_claim_in_flight` on submit —
			 * the expected shape of the two answers, and the submit's is the
			 * authoritative one. A promise of "free" here would make that refusal read
			 * as a bug.
			 */
			return <p className="text-meta text-ink-muted">This name looks free.</p>;
		case "taken":
			return (
				<p className="text-meta text-ink">
					This name is already published on the hub.
				</p>
			);
		case "reserved":
			/*
			 * The field line holds only what it uniquely holds: the built-in's canonical
			 * spelling — the one the author has to type — and that the reservation is the
			 * HUB's rather than this app's opinion. The refusal itself is the alert above,
			 * which already says that a built-in's name cannot be published; restating it
			 * here put one fact on screen twice, 40px apart, and made a courtesy line
			 * outrank the alert's refusal ink in the slot's own register (§9).
			 */
			return (
				<p className="text-meta text-ink-muted">
					{availability.builtinName
						? `The hub reserves "${availability.builtinName}" for one of its built-in agents.`
						: "The hub reserves this name for one of its built-in agents."}
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
	"edit-agent": "Edit the agent",
	"publish-as-new": "Publish as a new listing",
	"sign-in": "Sign in again",
	"refresh-hub": "Refresh the hub",
};

/** Re-exported so a story can build the same dialog with mocked inputs. */
export type { UploadAgentDialogProps };
