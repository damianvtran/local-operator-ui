import type { SystemPromptUpdate } from "@shared/api/local-operator/types";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button, Label } from "@shared/components/ui";
import { useSystemPrompt } from "@shared/hooks/use-system-prompt";
import { useUpdateSystemPrompt } from "@shared/hooks/use-update-system-prompt";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { formatCalendarDateTime } from "@shared/utils/date-utils";
import { NotebookPen, Save } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FC } from "react";
import { SettingsSection } from "./settings-section";
import { SystemPromptEditor } from "./system-prompt-editor";

/**
 * The prompt prepended to every agent in the environment.
 *
 * The editor is deliberately uncontrolled by the server between saves: local
 * state is the draft, and `isEdited` compares it against the fetched content
 * rather than tracking keystrokes, so retyping the original value correctly
 * disarms save and reset.
 */
export const SystemPrompt: FC = () => {
	useI18nLocale();
	const { data: systemPromptData, isLoading, error } = useSystemPrompt();
	const updateSystemPromptMutation = useUpdateSystemPrompt();
	const [systemPrompt, setSystemPrompt] = useState("");
	const [isEdited, setIsEdited] = useState(false);
	const dirtyRef = useRef(false);
	const baselineRef = useRef("");
	const [revision, setRevision] = useState(0);
	const [localDraftActive, setLocalDraftActive] = useState(false);
	const [sourceVersion, setSourceVersion] = useState(0);
	const observedServerVersion = useRef<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);

	// Cache refreshes can arrive while typing (including another consumer's
	// invalidation). Only pristine drafts may adopt server content implicitly.
	// Adopt before paint so a fetched tagged prompt never flashes an empty rich
	// editor (or lets a first interaction target that temporary editor).
	useLayoutEffect(() => {
		const serverVersion = systemPromptData
			? JSON.stringify([
					systemPromptData.content,
					systemPromptData.last_modified,
				])
			: null;
		if (serverVersion !== observedServerVersion.current) {
			observedServerVersion.current = serverVersion;
			setSourceVersion((value) => value + 1);
		}
		// A node-local dialog owns unapplied text, not canonical Markdown.
		// Retain that owner on refetch, but advance its version so Apply cannot
		// overwrite changed server content. Cancel can then adopt the new base.
		if (dirtyRef.current || localDraftActive) return;
		const next = systemPromptData?.content ?? "";
		if (next !== baselineRef.current) {
			baselineRef.current = next;
			setSystemPrompt(next);
			setRevision((value) => value + 1);
		}
		setIsEdited(false);
	}, [systemPromptData, localDraftActive]);

	const handleInputChange = useCallback((newValue: string) => {
		setSystemPrompt(newValue);
		// Compare against the draft's accepted baseline, not a newer refetch.
		dirtyRef.current = newValue !== baselineRef.current;
		setIsEdited(dirtyRef.current);
		setSaveError(null);
	}, []);

	const handleSave = async () => {
		if (!isEdited || updateSystemPromptMutation.isPending) return;

		setSaveError(null);
		try {
			const update: SystemPromptUpdate = {
				content: systemPrompt,
			};
			await updateSystemPromptMutation.mutateAsync(update);
			baselineRef.current = systemPrompt;
			dirtyRef.current = false;
			setIsEdited(false);
		} catch (err) {
			setSaveError(
				err instanceof Error
					? err.message
					: t("ui.common.errors.system_prompt_update_unknown"),
			);
		}
	};

	const handleReset = () => {
		dirtyRef.current = false;
		baselineRef.current = systemPromptData?.content ?? "";
		setSystemPrompt(baselineRef.current);
		setRevision((value) => value + 1);
		setSaveError(null);
		setIsEdited(false);
	};

	const isSaving = updateSystemPromptMutation.isPending;

	const renderContent = () => (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Label htmlFor="app-system-prompt">
					{t("ui.settings.model.system_prompt.instructions")}
				</Label>
				<SystemPromptEditor
					key={revision}
					value={systemPrompt}
					onChange={handleInputChange}
					onLocalDraftActiveChange={setLocalDraftActive}
					sourceVersion={sourceVersion}
					disabled={isSaving}
				/>
			</div>

			{saveError && <Alert variant="danger">{saveError}</Alert>}
			<div className="flex flex-wrap gap-3">
				<Button
					variant="primary"
					onClick={handleSave}
					disabled={!isEdited || isSaving}
				>
					{/*
					 * The spinner carries no label here: the button's own text
					 * already says t("ui.settings.model.system_prompt.saving"), and a labelled spinner would
					 * announce the same fact a second time.
					 */}
					{isSaving ? <Spinner size="sm" /> : <Save />}
					{isSaving
						? t("ui.settings.model.system_prompt.saving")
						: t("ui.settings.model.system_prompt.save_changes")}
				</Button>

				<Button onClick={handleReset} disabled={!isEdited || isSaving}>
					{t("ui.settings.model.system_prompt.cancel")}
				</Button>
			</div>

			{systemPromptData?.last_modified && (
				<p className="text-ink-dim text-meta">
					{t("ui.settings.model.system_prompt.last_modified")}{" "}
					{/* A timestamp is machine voice, so the value is monospace. */}
					<span className="font-mono text-mono-sm">
						{formatCalendarDateTime(systemPromptData.last_modified)}
					</span>
				</p>
			)}
		</div>
	);

	return (
		<SettingsSection
			title={t("ui.settings.model.system_prompt.system_prompt")}
			icon={NotebookPen}
			description={t(
				"ui.settings.model.system_prompt.every_local_operator_agent_receives_this_prompt_in_addition_to_it",
			)}
		>
			{isLoading ? (
				// Reserves the editor's height so the section does not jump once
				// the prompt arrives.
				<div className="flex min-h-50 items-center justify-center">
					<Spinner
						size="lg"
						label={t("ui.settings.model.system_prompt.loading_system_prompt")}
					/>
				</div>
			) : error && !systemPromptData && !isEdited ? (
				<Alert variant="danger">
					{t("ui.settings.model.system_prompt.load_failed", {
						reason:
							error instanceof Error
								? error.message
								: t("ui.settings.model.system_prompt.unknown_error"),
					})}
				</Alert>
			) : (
				renderContent()
			)}
		</SettingsSection>
	);
};
