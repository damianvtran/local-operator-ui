import type { AgentCreate } from "@shared/api/local-operator/types";
import { Spinner } from "@shared/components/common/spinner";
import { Button, Input, Label, Textarea } from "@shared/components/ui";
import { useCreateAgent } from "@shared/hooks";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Bot, ExternalLink } from "lucide-react";
import type { FC, FormEvent } from "react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../../../../i18n/messages";
import { BaseDialog, PrimaryButton, SecondaryButton } from "./base-dialog";

type CreateAgentDialogProps = {
	/**
	 * Whether the dialog is open
	 */
	open: boolean;
	/**
	 * Callback when the dialog is closed
	 */
	onClose: () => void;
	/**
	 * Called when an agent is created, with the identity needed to START A CHAT with
	 * it: the id, and the name the draft door keys a chat by.
	 *
	 * The name is here because the agent a caller wants to open is a DRAFT, not an
	 * address (issue #844): `stageDraft({ kind: "agent", name })` keys the row
	 * `draft:agent:<name>`, and `/chat/<agent id>` - the landing this callback used
	 * to feed - had no non-session fallback and always read as a legacy link. The
	 * backend's own name is preferred over the one typed (`result.name`), so an
	 * agent the server renamed is opened under the name it actually has.
	 */
	onAgentCreated?: (agent: { id: string; name: string }) => void;
};

/**
 * Dialog for creating a new agent
 *
 * Reusable component that can be used in different parts of the application
 */
export const CreateAgentDialog: FC<CreateAgentDialogProps> = ({
	open,
	onClose,
	onAgentCreated,
}) => {
	// Language refresh must preserve entered fields and any open confirmation.
	useI18nLocale();
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const nameFieldRef = useRef<HTMLInputElement>(null);

	const handleAgentHubClick = () => {
		onClose();
		setTimeout(() => {
			navigate("/agent-hub");
		}, 200);
	};

	const createAgentMutation = useCreateAgent();

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();

		if (!name.trim()) {
			return;
		}

		const newAgent: AgentCreate = {
			name: name.trim(),
			description: description.trim() || undefined,
		};

		try {
			const result = await createAgentMutation.mutateAsync(newAgent);
			// The created agent's identity, captured before the form resets: the chat a
			// caller opens is keyed by this name.
			const createdName = result?.name?.trim() || newAgent.name;
			// Reset form and close dialog on success
			setName("");
			setDescription("");

			// Call the onAgentCreated callback if provided
			if (onAgentCreated && result?.id) {
				onAgentCreated({ id: result.id, name: createdName });
			}

			onClose();
		} catch (error) {
			// Error is handled in the mutation
			console.error("Failed to create agent:", error);
		}
	};

	const isLoading = createAgentMutation.isPending;
	const isSubmitDisabled = isLoading || !name.trim();

	const dialogTitle = (
		<>
			<Bot size={19} className="text-accent" aria-hidden="true" />
			{t("ui.agents.dialogs.create.title")}
		</>
	);

	const dialogActions = (
		<>
			<SecondaryButton
				onClick={onClose}
				disabled={isLoading}
				data-tour-tag="create-agent-dialog-cancel-button"
			>
				{t("ui.agents.dialogs.create.cancel")}
			</SecondaryButton>
			<PrimaryButton
				type="submit"
				form="create-agent-form"
				disabled={isSubmitDisabled}
				startIcon={isLoading ? <Spinner /> : null}
			>
				{t("ui.agents.dialogs.create.submit")}
			</PrimaryButton>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="sm"
			dataTourTag="create-agent-dialog"
			dialogProps={{
				// The first tabbable element is the Agent Hub link, but the name
				// field is what the user opened this dialog to type into.
				onOpenAutoFocus: (event: Event) => {
					event.preventDefault();
					nameFieldRef.current?.focus();
				},
			}}
		>
			<p className="text-body-sm text-ink-muted">
				{t("ui.agents.dialogs.create.intro")}
			</p>
			<Button
				variant="link"
				onClick={handleAgentHubClick}
				className="mt-1 mb-4 text-body-sm"
			>
				{t("ui.agents.dialogs.create.hub_link")}
				<ExternalLink aria-hidden="true" />
			</Button>
			<form id="create-agent-form" onSubmit={handleSubmit}>
				<div className="flex flex-col gap-5">
					<div className="flex flex-col gap-2">
						<Label htmlFor="create-agent-name">
							{t("ui.agents.dialogs.create.name_label")}
						</Label>
						<Input
							ref={nameFieldRef}
							id="create-agent-name"
							inputSize="lg"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							disabled={isLoading}
							placeholder={t("ui.agents.dialogs.create.name_hint")}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="create-agent-description">
							{t("ui.agents.dialogs.create.description_label")}
						</Label>
						<Textarea
							id="create-agent-description"
							rows={2}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							disabled={isLoading}
							placeholder={t("ui.agents.dialogs.create.description_hint")}
						/>
					</div>
				</div>
			</form>
		</BaseDialog>
	);
};
