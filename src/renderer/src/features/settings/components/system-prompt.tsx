import type { SystemPromptUpdate } from "@shared/api/local-operator/types";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button, Label, Textarea } from "@shared/components/ui";
import { useSystemPrompt } from "@shared/hooks/use-system-prompt";
import { useUpdateSystemPrompt } from "@shared/hooks/use-update-system-prompt";
import { NotebookPen, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChangeEvent, FC } from "react";
import { SettingsSection } from "./settings-section";

/**
 * The prompt prepended to every agent in the environment.
 *
 * The editor is deliberately uncontrolled by the server between saves: local
 * state is the draft, and `isEdited` compares it against the fetched content
 * rather than tracking keystrokes, so retyping the original value correctly
 * disarms save and reset.
 */
export const SystemPrompt: FC = () => {
	const {
		data: systemPromptData,
		isLoading,
		error,
		refetch,
	} = useSystemPrompt();
	const updateSystemPromptMutation = useUpdateSystemPrompt();
	const [systemPrompt, setSystemPrompt] = useState("");
	const [isEdited, setIsEdited] = useState(false);

	// Adopts the fetched prompt as the draft. Also clears `isEdited`, so a
	// refetch that lands while the field is open does not leave save armed
	// against content the user can no longer see.
	useEffect(() => {
		setSystemPrompt(systemPromptData?.content ?? "");
		setIsEdited(false);
	}, [systemPromptData]);

	const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
		const newValue = e.target.value;
		setSystemPrompt(newValue);
		// Compared against the fetched content, so an undo by hand disarms save.
		setIsEdited(newValue !== (systemPromptData?.content ?? ""));
	};

	const handleSave = async () => {
		if (!isEdited || updateSystemPromptMutation.isPending) return;

		try {
			const update: SystemPromptUpdate = {
				content: systemPrompt,
			};
			await updateSystemPromptMutation.mutateAsync(update);
			await refetch();
			setIsEdited(false);
		} catch (err) {
			// A failed save leaves the draft dirty and only logs, so the user's
			// text is never lost — but nothing on screen says it failed yet.
			console.error("Error updating system prompt:", err);
		}
	};

	const handleReset = () => {
		setSystemPrompt(systemPromptData?.content ?? "");
		setIsEdited(false);
	};

	const isSaving = updateSystemPromptMutation.isPending;

	const renderContent = () => (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Label htmlFor="app-system-prompt">Instructions</Label>
				<Textarea
					id="app-system-prompt"
					name="systemPrompt"
					value={systemPrompt}
					onChange={handleInputChange}
					placeholder="Enter instructions for how all agents should behave and respond to your requests..."
					className="min-h-50"
				/>
			</div>

			<div className="flex gap-3">
				<Button
					variant="primary"
					onClick={handleSave}
					disabled={!isEdited || isSaving}
				>
					{/*
					 * The spinner carries no label here: the button's own text
					 * already says "Saving...", and a labelled spinner would
					 * announce the same fact a second time.
					 */}
					{isSaving ? <Spinner size="sm" /> : <Save />}
					{isSaving ? "Saving..." : "Save changes"}
				</Button>

				<Button onClick={handleReset} disabled={!isEdited || isSaving}>
					Cancel
				</Button>
			</div>

			{systemPromptData?.last_modified && (
				<p className="text-ink-dim text-meta">
					Last modified:{" "}
					{/* A timestamp is machine voice, so the value is monospace. */}
					<span className="font-mono text-mono-sm">
						{new Date(systemPromptData.last_modified).toLocaleString()}
					</span>
				</p>
			)}
		</div>
	);

	return (
		<SettingsSection
			title="System prompt"
			icon={NotebookPen}
			description="Every Local Operator agent receives this prompt in addition to its own instructions, so it is the place for baseline expectations and for details you want every agent to know about you, such as your name, location, or preferences. It is sent to your selected hosting provider."
		>
			{isLoading ? (
				// Reserves the editor's height so the section does not jump once
				// the prompt arrives.
				<div className="flex min-h-50 items-center justify-center">
					<Spinner size="lg" label="Loading system prompt" />
				</div>
			) : error ? (
				<Alert variant="danger">
					Failed to load system prompt:{" "}
					{error instanceof Error ? error.message : "Unknown error"}
				</Alert>
			) : (
				renderContent()
			)}
		</SettingsSection>
	);
};
