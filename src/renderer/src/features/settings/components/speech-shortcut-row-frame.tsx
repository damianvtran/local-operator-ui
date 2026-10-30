import { Button, Input, Label } from "@shared/components/ui";
import { t } from "@shared/i18n";
import {
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
} from "react";

/**
 * The layout both Speech to text rows share: the rank ("Primary" /
 * "Secondary"), the action it performs, the capture field, Reset, and the
 * notes under it. Only the capture rules differ between the rows, so those
 * stay with the rows and arrive here as handlers.
 */
export function SpeechShortcutRowFrame({
	id,
	rank,
	action,
	settingKey,
	help,
	hint,
	ariaLabel,
	value,
	fieldRef,
	saving,
	showReset,
	onReset,
	onKeyDown,
	onKeyUp,
	onBlur,
	notes,
	error,
	focusKey,
}: {
	id: string;
	rank: "primary" | "secondary";
	/** The action's name, with how it is performed: "Start recording (press)". */
	action: string;
	settingKey: string;
	help: string;
	hint: string;
	ariaLabel: string;
	value: string;
	fieldRef: RefObject<HTMLInputElement>;
	saving: boolean;
	showReset: boolean;
	onReset: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	onKeyUp?: (event: KeyboardEvent<HTMLInputElement>) => void;
	onBlur?: () => void;
	notes?: ReactNode;
	/** The last refusal or failure; shown after the saving cue, as it always was. */
	error?: string | null;
	/** The registry key a `?setting=` deep link names; matching it focuses the field. */
	focusKey?: string | null;
}) {
	/*
	 * A PROMOTED ROW OWNS ITS OWN DEEP-LINK REVEAL (QA Q-1): the Backend section's
	 * `focusKey` is suppressed for promoted keys, so landing on this section alone
	 * left the focus on <body>. Once per link, as the sibling promoted rows do.
	 */
	const focused = useRef(false);
	useEffect(() => {
		if (focusKey !== settingKey || focused.current) return;
		const field = fieldRef.current;
		if (!field) return;
		focused.current = true;
		field.scrollIntoView?.({ block: "center" });
		field.focus();
	}, [focusKey, settingKey, fieldRef]);
	return (
		/*
		 * The settings search indexes a promoted registry key through THIS page row
		 * (`PROMOTED_SETTING_SECTIONS` drops it from the registry half), so the row
		 * carries the markers or the key would be findable nowhere. The label is
		 * the action's name, which the rendered "Primary"/"Secondary" rank is not;
		 * the key is a term so a reader typing it still lands here.
		 */
		<div
			className="group flex min-w-0 flex-col gap-1"
			data-speech-rank={rank}
			data-search-row={`keyboard.${settingKey}`}
			data-search-label={action}
			data-search-terms={settingKey}
			data-search-control
		>
			<div className="flex flex-wrap items-center gap-2">
				<div className="flex w-32 flex-col">
					<Label htmlFor={id} className="text-body-sm text-ink">
						{rank === "primary"
							? t("ui.settings.shortcuts.speech.primary")
							: t("ui.settings.shortcuts.speech.secondary")}
					</Label>
					<span className="text-meta text-ink-muted">{action}</span>
				</div>
				<Input
					ref={fieldRef}
					id={id}
					aria-label={ariaLabel}
					aria-describedby={`${id}-hint ${id}-notes ${id}-status`}
					aria-invalid={error ? true : undefined}
					aria-busy={saving}
					data-shortcut-action={settingKey}
					className="w-52 text-left font-mono text-body-sm"
					value={value}
					readOnly
					onKeyDown={onKeyDown}
					onKeyUp={onKeyUp}
					onBlur={onBlur}
				/>
				{showReset && (
					<Button
						variant="secondary"
						size="sm"
						disabled={saving}
						aria-label={t(
							"ui.settings.shortcuts.keyboard_shortcuts_section.reset_label_to_its_default",
							{ label: action },
						)}
						onClick={onReset}
					>
						{t("ui.settings.shortcuts.keyboard_shortcuts_section.reset")}
					</Button>
				)}
			</div>
			<div className="ml-0 max-w-88 text-meta text-ink-muted sm:ml-34">
				<p>{help}</p>
				<p id={`${id}-hint`} className="hidden group-focus-within:block">
					{hint}
				</p>
				<div id={`${id}-notes`}>{notes}</div>
				{/*
				 * ONE PERSISTENT LIVE REGION for the saving cue and the refusal. A
				 * region that is created together with its text is not reliably
				 * announced; this one exists empty and is filled, and the field names
				 * it in `aria-describedby`, so a refusal is spoken and also read on
				 * return to the field.
				 */}
				<output id={`${id}-status`} className="block" aria-live="polite">
					{saving ? (
						t("ui.settings.configuration.backend_setting_row.saving")
					) : error ? (
						<span className="text-danger">{error}</span>
					) : null}
				</output>
			</div>
		</div>
	);
}
