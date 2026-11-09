import { SourcePreservingMarkdown } from "@features/chat/components/canvas/source-preserving-markdown";
import { WysiwygMarkdownEditor } from "@features/chat/components/canvas/wysiwyg-markdown-editor";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { Button, Textarea } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useCallback, useId, useMemo, useState } from "react";

/** Settings owns canonical Markdown and its explicit Save boundary. Mode switches
 * never serialize the rich DOM: only an actual user edit may change the draft. */
export const SystemPromptEditor = ({
	value,
	onChange,
	onLocalDraftActiveChange,
	sourceVersion = 0,
	disabled = false,
}: {
	value: string;
	onChange: (value: string) => void;
	onLocalDraftActiveChange?: (active: boolean) => void;
	sourceVersion?: number;
	disabled?: boolean;
}) => {
	const locale = useI18nLocale();
	const id = useId();
	const sourceLabelId = `${id}-source-label`;
	const emptyTaskLabelId = `${id}-empty-task-label`;
	const [source, setSource] = useState(false);
	const [codec] = useState(
		() =>
			new SourcePreservingMarkdown(
				t("ui.settings.model.system_prompt.source_edit"),
				t("ui.canvas.wysiwyg_markdown_editor.checklist"),
				{ source: sourceLabelId, emptyTask: emptyTaskLabelId },
			),
	);
	const [generation, setGeneration] = useState(0);
	// Stable document identity during typing keeps selection, undo and scroll.
	// Re-entering rich mode mounts the latest canonical source, not a stale DOM.
	const [richInitial, setRichInitial] = useState(value);
	const document = useMemo<CanvasDocument>(
		() => ({
			id: `system-prompt-draft-${id}-${generation}`,
			title: "system-prompt.md", // i18n: ignore Internal synthetic document filename, not interface copy
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: locale invalidates translated draft labels while callbacks remain stable.
	const draft = useMemo(
		() => ({
			onChange: richChange,
			onLocalDraftActiveChange,
			sourceVersion,
			disabled,
			label: t("ui.settings.model.system_prompt.instructions"),
			codec,
			sourceLabel: t("ui.settings.model.system_prompt.source_edit"),
			sourceStaleLabel: t("ui.settings.model.system_prompt.source_stale"),
		}),
		[
			richChange,
			disabled,
			codec,
			onLocalDraftActiveChange,
			sourceVersion,
			locale,
		],
	);
	const enterRich = () => {
		setRichInitial(value);
		setGeneration((n) => n + 1);
		setSource(false);
	};

	return (
		<div className="flex min-w-0 flex-col gap-2">
			{/* Localized presentation lives outside the observed rich document.
			    Stable references survive undo/redo snapshots without recording a
			    locale switch as an edit or restoring an old-language label. */}
			<span id={sourceLabelId} className="sr-only">
				{t("ui.settings.model.system_prompt.source_edit")}
			</span>
			<span id={emptyTaskLabelId} className="sr-only">
				{t("ui.canvas.wysiwyg_markdown_editor.checklist")}
			</span>
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
