import type { AgentCreate } from "@shared/api/local-operator/types";
import { Spinner } from "@shared/components/common/spinner";
import { Button, Input, Label, Textarea } from "@shared/components/ui";
import { useCreateAgent } from "@shared/hooks";
import { Bot, ExternalLink } from "lucide-react";
import type { FC, FormEvent } from "react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
	 * Optional callback when an agent is successfully created
	 */
	onAgentCreated?: (agentId: string) => void;
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
			// Reset form and close dialog on success
			setName("");
			setDescription("");

			// Call the onAgentCreated callback if provided
			if (onAgentCreated && result?.id) {
				onAgentCreated(result.id);
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
			Create new agent
		</>
	);

	const dialogActions = (
		<>
			<SecondaryButton
				onClick={onClose}
				disabled={isLoading}
				data-tour-tag="create-agent-dialog-cancel-button"
			>
				Cancel
			</SecondaryButton>
			<PrimaryButton
				type="submit"
				form="create-agent-form"
				disabled={isSubmitDisabled}
				startIcon={isLoading ? <Spinner /> : null}
			>
				Create agent
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
				Configure your new AI assistant with a name and optional description
			</p>
			<Button
				variant="link"
				onClick={handleAgentHubClick}
				className="mt-1 mb-4 text-body-sm"
			>
				Browse Agent hub to fetch ready-made agents
				<ExternalLink aria-hidden="true" />
			</Button>
			<form id="create-agent-form" onSubmit={handleSubmit}>
				<div className="flex flex-col gap-5">
					<div className="flex flex-col gap-2">
						<Label htmlFor="create-agent-name">Agent name</Label>
						<Input
							ref={nameFieldRef}
							id="create-agent-name"
							inputSize="lg"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							disabled={isLoading}
							placeholder="Enter a name for your agent"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="create-agent-description">
							Description (optional)
						</Label>
						<Textarea
							id="create-agent-description"
							rows={2}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							disabled={isLoading}
							placeholder="Describe what this agent does"
						/>
					</div>
				</div>
			</form>
		</BaseDialog>
	);
};
