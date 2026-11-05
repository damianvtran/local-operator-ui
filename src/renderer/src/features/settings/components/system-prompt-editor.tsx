import { WysiwygMarkdownEditor } from "@features/chat/components/canvas/wysiwyg-markdown-editor";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { Alert, Button, Textarea } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useCallback, useId, useMemo, useState } from "react";
import { canRichEditPrompt } from "./system-prompt-markdown";

/** Settings owns canonical Markdown and its explicit Save boundary. Mode switches
 * never serialize the rich DOM: only an actual user edit may change the draft. */
export const SystemPromptEditor = ({
	value,
	onChange,
	disabled = false,
}: {
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
}) => {
	const id = useId();
	const [safe, setSafe] = useState(() => canRichEditPrompt(value));
	const [source, setSource] = useState(() => !safe);
	const [generation, setGeneration] = useState(0);
	// Stable document identity during typing keeps selection, undo and scroll.
	// Re-entering rich mode mounts the latest canonical source, not a stale DOM.
	const [richInitial, setRichInitial] = useState(value);
	const document = useMemo<CanvasDocument>(
		() => ({
			id: `system-prompt-draft-${id}-${generation}`,
			title: "system-prompt.md",
			path: "",
			type: "markdown",
			content: richInitial,
		}),
		[id, generation, richInitial],
	);
	const richChange = useCallback(
		(markdown: string) => onChange(markdown),
		[onChange],
	);
	const draft = useMemo(
		() => ({
			onChange: richChange,
			disabled,
			label: t("ui.settings.model.system_prompt.instructions"),
		}),
		[richChange, disabled],
	);
	const enterRich = () => {
		const supported = canRichEditPrompt(value);
		setSafe(supported);
		if (!supported) return;
		setRichInitial(value);
		setGeneration((n) => n + 1);
		setSource(false);
	};

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<fieldset
				className="flex flex-wrap gap-2"
				aria-label={t("ui.settings.model.system_prompt.instructions")}
			>
				<Button
					variant="ghost"
					className={!source ? "bg-sunken font-semibold text-ink" : undefined}
					aria-pressed={!source}
					disabled={disabled}
					onClick={enterRich}
				>
					{t("ui.settings.model.system_prompt.rich_text")}
				</Button>
				<Button
					variant="ghost"
					className={source ? "bg-sunken font-semibold text-ink" : undefined}
					aria-pressed={source}
					disabled={disabled}
					onClick={() => setSource(true)}
				>
					{t("ui.settings.model.system_prompt.source")}
				</Button>
			</fieldset>
			{!safe && (
				<Alert>{t("ui.settings.model.system_prompt.source_required")}</Alert>
			)}
			{source ? (
				<Textarea
					id="app-system-prompt"
					name="systemPrompt"
					aria-label={t("ui.settings.model.system_prompt.instructions")}
					value={value}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
					placeholder={t(
						"ui.settings.model.system_prompt.enter_instructions_for_how_all_agents_should_behave_and_respond_t",
					)}
					className="min-h-72 max-h-[65vh] resize-y font-mono"
				/>
			) : (
				<div
					className="h-[min(32rem,65vh)] min-h-64 min-w-0 overflow-hidden rounded-lg bg-surface"
					{...(disabled ? { inert: "" } : {})}
				>
					<WysiwygMarkdownEditor
						key={document.id}
						document={document}
						draft={draft}
						measure="fill"
					/>
				</div>
			)}
		</div>
	);
};
