/**
 * Borderless inline editing, in the interaction the chat title already ships.
 *
 * WHY THIS EXISTS BESIDE `EditableField`. `EditableField` is a form control:
 * a labelled, bordered field with an explicit Save step, because it edits agent
 * configuration that is persisted server-side and a stray blur must not write
 * it. Settings forms depend on exactly that. The Library preview is the other
 * kind of surface: the value is the content (a name, a description, a tag row),
 * not a field in a form, and the operator's requirement is that it reads as
 * text until the reader chooses to change it - no box, no label above a header,
 * no save/cancel pair floating over the value.
 *
 * So this is a second primitive rather than a mode on the first. The gesture
 * set is the chat title's (`chat-header.tsx`), deliberately: hover reveals a
 * pencil in a RESERVED gutter, the pencil turns into an X while editing,
 * double-click opens it too, Enter saves, Escape cancels, blur saves, the
 * editor opens focused with the text selected, and a failed save keeps the
 * editor open with the typed value. The chat title's code is not imported - it
 * is welded to session rename commands and the titlebar's one-line clip - but
 * the interaction is the same one, not a second interpretation of it.
 *
 * THE GUTTER IS A REAL FLEX SIBLING, never an absolutely positioned control.
 * That is the defect this module exists to end: the preview's pencil and clear
 * buttons were painted at `end-1.5` over the value, so long names ran under
 * them. A sibling takes width, the text truncates against it, and the slot is
 * reserved whether or not the icon is visible (only opacity changes on hover,
 * so nothing reflows under the pointer).
 *
 * `outline-none` on the editor is the programmatic-focus exemption
 * `styles/index.css` names for the focus-ring rule: focus is moved here by the
 * gesture that opened the edit (the pencil press or the menu's edit command),
 * and the thing that says "editing" is the X in the gutter, the caret and the
 * selected text.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Badge } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
	ChangeEvent,
	FC,
	KeyboardEvent,
	MouseEvent as ReactMouseEvent,
} from "react";

type InlineEditTextProps = {
	/** The committed value. */
	value: string;
	/**
	 * Persist `value`. The returned promise is what the editor awaits before it
	 * closes; rejecting it is how a refusal keeps the editor open with the
	 * typed text (the caller owns the toast that explains why).
	 */
	onSave: (value: string) => Promise<void>;
	/** Names the field in the edit/cancel controls' accessible labels. */
	label: string;
	/** Shown as quiet text when the value is empty, and is itself the add affordance. */
	placeholder?: string;
	/** Description-style editor: Enter commits, Shift+Enter inserts a line break. */
	multiline?: boolean;
	/** Rows for the multiline editor. */
	rows?: number;
	/**
	 * Type step and weight shared by the read text and the editor. The editor
	 * must look like the text it replaced, or opening it reads as a mode change.
	 */
	textClassName?: string;
	/** A value the field accepts as valid when emptied. Names do not. */
	allowEmpty?: boolean;
	/**
	 * A counter a menu command bumps to open the editor without a pointer. It is
	 * read as a CHANGE, never as a mount value: the value present at mount may
	 * belong to whatever was on screen before (see the effect below).
	 */
	startSignal?: number;
	/** Stable rig hook naming the field (`name`, `description`). */
	field?: string;
	/** Extra classes for the row wrapper. */
	className?: string;
};

/**
 * The chat-title interaction, borderless.
 *
 * The reveal is `group/inline`, and the gutter is 20px - one icon-sm slot - in
 * the header's scale. It is visible while editing (the X is the mode's own
 * control, not a hover affordance) and while saving (the spinner states why
 * the field is frozen).
 */
export const InlineEditText: FC<InlineEditTextProps> = ({
	value,
	onSave,
	label,
	placeholder = "",
	multiline = false,
	rows = 3,
	textClassName,
	allowEmpty = false,
	startSignal,
	field,
	className,
}) => {
	useI18nLocale();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const [saving, setSaving] = useState(false);
	/*
	 * A phase latch, not just `editing`: a blur and an Enter can both submit the
	 * same edit, and a save that resolves after the reader cancelled must not
	 * reopen or close an editor that is no longer the one it belongs to. The
	 * chat title uses the same three phases for the same race.
	 */
	const phaseRef = useRef<"edit" | "saving" | "closed">("closed");
	const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
	const controlRef = useRef<HTMLButtonElement | null>(null);

	const startEditing = () => {
		if (phaseRef.current !== "closed") return;
		setDraft(value);
		phaseRef.current = "edit";
		setEditing(true);
	};

	const close = (restoreFocus: boolean) => {
		/* The latch closes before the node unmounts: a blur fired by that unmount
		 * must find the latch past `edit` so it cannot run a second save. Focus
		 * returns to the pencil on an explicit gesture (Enter, Escape, the X) and
		 * never on a blur, where the reader is already moving somewhere else - the
		 * chat title's rule, for the same reason. */
		phaseRef.current = "closed";
		if (restoreFocus) controlRef.current?.focus();
		setEditing(false);
	};

	const commit = async (restoreFocus: boolean) => {
		if (phaseRef.current !== "edit") return;
		const next = draft.trim();
		if ((!next && !allowEmpty) || next === value) {
			/* Empty (where empty is not a value) or unchanged: exit without a
			 * write. The cleared case for a description goes through - an empty
			 * description is an edit, not an invalid name. */
			close(restoreFocus);
			return;
		}
		phaseRef.current = "saving";
		setSaving(true);
		try {
			await onSave(next);
			if (phaseRef.current === "saving") close(restoreFocus);
		} catch {
			/* The caller reports the refusal; the editor stays open with the typed
			 * value and gets its focus back so the retry starts where the text is.
			 * Discarding the edit here is the defect this module's sibling comment
			 * records on `EditableField`'s first implementation. */
			if (phaseRef.current === "saving") {
				phaseRef.current = "edit";
				inputRef.current?.focus();
			}
		} finally {
			setSaving(false);
		}
	};

	useEffect(() => {
		if (!editing) return;
		/*
		 * DEFERRED ONE TASK, for the menu path: `Edit metadata` opens this editor
		 * from a dropdown item, and Radix restores focus to the menu's trigger as
		 * the menu closes. Focusing in the same commit let that restoration land
		 * after the field had focus, and the field's blur-commit then closed the
		 * editor the command had just opened. One task later, the restoration has
		 * already happened and this focus is the last word.
		 */
		const timer = setTimeout(() => {
			const input = inputRef.current;
			if (!input) return;
			input.focus();
			input.select();
			/*
			 * SELECTING A LONG VALUE SCROLLS THE FIELD TO THE CARET AT ITS END
			 * (QA round 1, Q1): Chromium paints the tail of the name while the
			 * reader has just opened the beginning of it, and an `<input>` cannot
			 * ellipsize. Scrolling back to the start makes the opened editor read
			 * from the value's first character, which is the only part the field
			 * can show without a truncation the platform does not offer.
			 */
			input.scrollLeft = 0;
			if (input instanceof HTMLTextAreaElement) input.scrollTop = 0;
		}, 0);
		return () => clearTimeout(timer);
	}, [editing]);

	/*
	 * A NEW `value` IS A NEW ASSET, not a refresh of this editor. The call site
	 * keys this component by asset id, so in the app a switch unmounts it; the
	 * guard is defensive (agent review round 1, M2). While the editor is closed
	 * the draft must track the committed value, or a later open would start from
	 * the previous text - and a refused save's refocus would put it back on
	 * screen.
	 */
	useEffect(() => {
		if (phaseRef.current === "closed") setDraft(value);
	}, [value]);

	/*
	 * A SIGNAL IS A CHANGE, NOT A MOUNT VALUE (agent review round 2, M2). The
	 * caller keys this editor by asset id, so a switch remounts it, and a command
	 * leaves its counter non-zero for the life of the preview. Firing on mount
	 * therefore opened the new asset's editor with nobody having asked - and the
	 * next keystroke would have renamed the wrong row. The counter present at
	 * mount is the baseline; only a later value can open the editor.
	 *
	 * A drop back to zero is a reset, not a command: the caller clears the
	 * counters when the asset changes, so this branch records the new baseline
	 * and does nothing else. Without it the reset itself would read as a change
	 * and open the editor on the asset the reader just switched to.
	 */
	const startSignalRef = useRef(startSignal);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the signal is a trigger, not a read.
	useEffect(() => {
		const previous = startSignalRef.current;
		startSignalRef.current = startSignal;
		if (startSignal === previous || !startSignal) return;
		startEditing();
	}, [startSignal]);

	const onKeyDown = (
		event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		/*
		 * AN IME'S ENTER IS NOT THIS FIELD'S ENTER (agent review round 1, M1).
		 * Accepting a zh-CN candidate fires `keydown` with `key === "Enter"` and
		 * `isComposing === true` (or `keyCode === 229` on hosts that report the
		 * process key); committing there would write the uncomposed preedit and
		 * close the editor before the candidate lands. The repository already
		 * guards this in `chat-tag-header.tsx` and `ask-answer-field.tsx`.
		 */
		if (event.nativeEvent.isComposing || event.keyCode === 229) return;
		if (event.key === "Enter") {
			/* Multiline: Enter commits and Shift+Enter keeps the line break, so
			 * writing a description has one predictable way to end the edit - the
			 * same rule the chat title applies, extended to the one multiline
			 * field this primitive serves. */
			if (multiline && event.shiftKey) return;
			event.preventDefault();
			void commit(true);
		} else if (event.key === "Escape") {
			/* Claimed so a cancel cannot also reach a surrounding Escape ladder. */
			event.preventDefault();
			/* A submitted save is committed (the chat title's rule): once the write
			 * is in flight its outcome is the backend's, and this control is the
			 * busy state rather than an abort. */
			if (phaseRef.current === "saving") return;
			close(true);
		}
	};

	const cancelPress = (event: ReactMouseEvent<HTMLButtonElement>) => {
		/* Consume the press's own mousedown while editing so the input does not
		 * blur on the way to this handler - a blur would commit the value the X
		 * was pressed to abandon. */
		if (editing) event.preventDefault();
	};

	const onChange = (
		event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		setDraft(event.target.value);
	};

	const renderedValue = value.trim();
	const readText = renderedValue ? (
		<span
			onDoubleClick={startEditing}
			className={cn(
				"block min-w-0 cursor-default select-none",
				multiline ? "whitespace-pre-wrap break-words" : "truncate",
				textClassName,
			)}
		>
			{value}
		</span>
	) : (
		/* THE EMPTY STATE IS AN ACTION, not a blank line: the placeholder text is
		 * the control that opens the editor, because a value that is absent has
		 * no text to double-click. */
		<button
			type="button"
			onClick={startEditing}
			className={cn(
				"block min-w-0 cursor-pointer truncate text-start text-ink-dim",
				"transition-colors duration-fast ease-out-quart hover:text-ink-muted",
				textClassName,
			)}
		>
			{placeholder}
		</button>
	);

	return (
		<div
			data-inline-edit={field}
			className={cn(
				"group/inline flex min-w-0 items-center gap-1",
				/*
				 * AT REST THE ROW IS AS WIDE AS ITS VALUE, so the pencil hugs the
				 * text the way the chat title's does; the wrapper around it owns the
				 * header's leftover width, and `max-w-full` is what lets a long value
				 * truncate against the gutter instead of pushing the action cluster
				 * out. While editing the row takes that whole width, so the field
				 * does not jump narrower or wider than the space reserved for it.
				 */
				!editing && "w-fit max-w-full",
				editing && "w-full",
				multiline && editing && "items-start",
				className,
			)}
		>
			{editing ? (
				multiline ? (
					<textarea
						data-inline-edit-input=""
						ref={(node) => {
							inputRef.current = node;
						}}
						value={draft}
						rows={rows}
						readOnly={saving}
						aria-label={label}
						aria-busy={saving || undefined}
						onChange={onChange}
						onKeyDown={onKeyDown}
						onBlur={() => void commit(false)}
						spellCheck={false}
						className={cn(
							"min-w-0 flex-1 resize-none border-0 bg-transparent p-0 outline-none",
							"text-ink",
							textClassName,
						)}
					/>
				) : (
					<input
						data-inline-edit-input=""
						ref={(node) => {
							inputRef.current = node;
						}}
						value={draft}
						readOnly={saving}
						aria-label={label}
						aria-busy={saving || undefined}
						onChange={onChange}
						onKeyDown={onKeyDown}
						onBlur={() => void commit(false)}
						spellCheck={false}
						className={cn(
							"min-w-0 flex-1 border-0 bg-transparent p-0 outline-none",
							"text-ink",
							textClassName,
						)}
					/>
				)
			) : (
				<div className="min-w-0 flex-1">{readText}</div>
			)}
			<button
				type="button"
				ref={controlRef}
				data-inline-edit-control=""
				/*
				 * THE LABEL STATES THE TRUE PHASE (the chat title's rule): the
				 * pencil's edit name, the X's cancel, and the busy state itself while
				 * the write is in flight, because a "Cancel" label over a no-op would
				 * be a lie.
				 */
				aria-label={
					saving
						? t("ui.common.forms.editable_field.saving")
						: editing
							? t("ui.common.forms.autocomplete_field.cancel_editing", {
									label,
								})
							: t("ui.common.forms.editable_field.edit_v2", { label })
				}
				title={
					saving
						? t("ui.common.forms.editable_field.saving")
						: editing
							? t("ui.common.forms.editable_field.cancel_escape")
							: t("ui.common.forms.editable_field.edit")
				}
				aria-busy={saving || undefined}
				aria-disabled={saving || undefined}
				onMouseDown={cancelPress}
				onClick={(event) => {
					if (event.detail > 1) return;
					if (phaseRef.current === "saving") return;
					if (editing) {
						close(true);
						return;
					}
					startEditing();
				}}
				className={cn(
					/*
					 * THE RESERVED GUTTER. `size-5` in the header's icon scale; it is
					 * a flex sibling, so the value's truncation point is the slot's
					 * edge and the pencil never covers a glyph. `shrink-0` keeps the
					 * slot at its width when the value wants the row.
					 */
					"inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs",
					"text-ink-dim transition-opacity duration-base ease-out-quart",
					"hover:text-ink-muted",
					/* Once the mode is open its own control must be visible without a
					 * pointer; only the read state hides it until hover/focus. */
					!editing &&
						"opacity-0 group-hover/inline:opacity-100 group-hover/inline:duration-fast",
					!editing &&
						"group-focus-within/inline:opacity-100 group-focus-within/inline:duration-fast",
				)}
			>
				{saving ? (
					<Spinner size="xs" />
				) : editing ? (
					<X className="size-3" aria-hidden="true" />
				) : (
					<Pencil className="size-3" aria-hidden="true" />
				)}
			</button>
		</div>
	);
};

type InlineTagEditorProps = {
	value: string[];
	/** Receives the full next list; the caller owns creation and assignment. */
	onChange: (tags: string[]) => void;
	/** Field name, used as the add input's accessible label. */
	label: string;
	/** The add affordance's text; also the input's placeholder. */
	addLabel: string;
	/** A write is in flight: the row's controls are inert and the spinner takes the add slot. */
	saving?: boolean;
	/**
	 * A counter a menu command bumps to open the add input without a pointer,
	 * read as a CHANGE rather than as a mount value for the reason
	 * `InlineEditText`'s prop records.
	 */
	startSignal?: number;
};

/**
 * The tag row: shared `Badge` pills, an X per pill, and one inline add control.
 *
 * Same two rules as `InlineEditText`: the chips are the shared `Badge` (no
 * second chip language, no new radii or padding), and the add control is a
 * sibling in the row rather than a bordered input container. Empty is the
 * affordance itself, never a box with nothing in it.
 *
 * Enter commits, Escape closes, blur commits a non-empty draft. Blur commits
 * because the alternative silently discards typed text, and the operator's
 * rule for the other two fields on this surface is that blur applies.
 */
export const InlineTagEditor: FC<InlineTagEditorProps> = ({
	value,
	onChange,
	label,
	addLabel,
	saving = false,
	startSignal,
}) => {
	/* The chip X's accessible name is a translated string; subscribing to the
	 * locale is what re-renders the row when the reader switches language, the
	 * same reason `InlineEditText` calls it. */
	useI18nLocale();
	const [adding, setAdding] = useState(false);
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const rowRef = useRef<HTMLDivElement | null>(null);

	const startAdding = () => {
		if (saving || adding) return;
		setAdding(true);
	};

	const close = () => {
		setDraft("");
		setAdding(false);
	};

	const commit = (keepOpen: boolean) => {
		const next = draft.trim().toLowerCase();
		if (next && !value.some((tag) => tag.toLowerCase() === next)) {
			onChange([...value, next]);
		}
		setDraft("");
		if (keepOpen) {
			/* Stay in add mode after a commit: adding one tag is rarely the whole
			 * intent, and closing would make the second tag a fresh hover. */
			inputRef.current?.focus();
		} else {
			setAdding(false);
		}
	};

	/*
	 * THE OPENING FOCUS AND THE RESUMING ONE ARE NOT THE SAME GESTURE. The
	 * effect runs twice for one tag: once when the reader opens the input, and
	 * once when a write settles and the input returns.
	 *
	 * `saving` IS A DEPENDENCY BECAUSE THE COMMIT UNMOUNTS THIS INPUT (agent
	 * review round 1, N3): `commit(true)` focuses synchronously, but the
	 * caller's save flips `saving` on the same tick and the add slot becomes a
	 * `Spinner`, so the focus had no node to land on. When the write settles and
	 * the input returns, this effect runs again and puts the caret back where the
	 * next tag can be typed.
	 *
	 * THE RESUME MUST NOT STEAL FOCUS (agent review round 2, N3 residual). If
	 * the reader clicked the name - or anything else outside this row - while
	 * the write was in flight, they have chosen a new place to be; pulling them
	 * back into the tag input would swallow their next keystroke. `BODY` is where
	 * a removed focused node leaves the caret, so body and anything still inside
	 * the row count as "nobody moved"; anywhere else does not. The opening run
	 * has no such test: the gesture that opened the row owns focus, and the menu
	 * path's restored trigger is outside the row by design.
	 *
	 * Deferred for the same dropdown-focus reason `InlineEditText` records:
	 * `Edit tags` opens this input while the menu is closing, and Radix's
	 * focus restoration would otherwise blur it and close it a tick later.
	 */
	const resumingRef = useRef(false);
	useEffect(() => {
		if (saving) {
			resumingRef.current = true;
			return;
		}
		if (!adding) {
			resumingRef.current = false;
			return;
		}
		const resuming = resumingRef.current;
		resumingRef.current = false;
		const timer = setTimeout(() => {
			if (resuming) {
				const active = document.activeElement;
				const row = rowRef.current;
				const stayed =
					!active || active === document.body || !!row?.contains(active);
				if (!stayed) return;
			}
			inputRef.current?.focus();
		}, 0);
		return () => clearTimeout(timer);
	}, [adding, saving]);

	/*
	 * The signal is read as a change for the reason `InlineEditText`'s effect
	 * records (agent review round 2, M2): a mount carrying the previous asset's
	 * counter must not open this row on the asset now selected.
	 */
	const startSignalRef = useRef(startSignal);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the signal is a trigger, not a read.
	useEffect(() => {
		const previous = startSignalRef.current;
		startSignalRef.current = startSignal;
		if (startSignal === previous || !startSignal) return;
		startAdding();
	}, [startSignal]);

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing || event.keyCode === 229) return;
		if (event.key === "Enter") {
			event.preventDefault();
			commit(true);
		} else if (event.key === "Escape") {
			event.preventDefault();
			close();
		}
	};

	const addControl = saving ? (
		<Spinner size="xs" />
	) : adding ? (
		<input
			ref={inputRef}
			value={draft}
			aria-label={label}
			onChange={(event) => setDraft(event.target.value)}
			onKeyDown={onKeyDown}
			onBlur={() => (draft.trim() ? commit(false) : close())}
			spellCheck={false}
			className={cn(
				"w-28 min-w-0 border-0 bg-transparent p-0 outline-none",
				"text-body-sm text-ink placeholder:text-ink-dim",
			)}
			placeholder={addLabel}
		/>
	) : (
		<button
			type="button"
			onClick={startAdding}
			className={cn(
				"inline-flex items-center gap-1 rounded-xs text-ink-dim",
				"text-body-sm transition-colors duration-fast ease-out-quart hover:text-ink-muted",
			)}
		>
			<Plus className="size-3" aria-hidden="true" />
			{addLabel}
		</button>
	);

	return (
		<div
			ref={rowRef}
			data-inline-tags=""
			className="flex min-w-0 flex-wrap items-center gap-2"
		>
			{value.map((tag) => (
				<Badge
					key={tag}
					variant="neutral"
					shape="pill"
					className="gap-1 pe-1 text-ink"
				>
					{tag}
					<button
						type="button"
						aria-label={t("ui.chat.tags.remove_named", { name: tag })}
						disabled={saving}
						onClick={() =>
							onChange(value.filter((existing) => existing !== tag))
						}
						className={cn(
							/*
							 * A 12px GLYPH IN A 20px TARGET (design round 1, D2). The pill is
							 * 23.4px tall, so a 24px target cannot sit inside it without
							 * growing the silhouette - 20px is the ceiling. `-m-1` pulls the
							 * target back to the glyph's old 12px layout box, so the pill,
							 * its gap and its trailing padding measure exactly as before;
							 * only the pointer's reach grows.
							 */
							"inline-flex size-5 -m-1 items-center justify-center rounded-xs",
							"text-ink-dim",
							"transition-colors duration-fast ease-out-quart",
							"hover:text-danger disabled:text-ink-disabled",
						)}
					>
						<X className="size-3" aria-hidden="true" />
					</button>
				</Badge>
			))}
			{addControl}
		</div>
	);
};
