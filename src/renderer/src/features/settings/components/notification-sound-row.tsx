/**
 * One row of the notification-sound list (settings spec §3.1), and the inline
 * states a custom row can be in (rename §5.3, remove confirm §5.4).
 *
 * ANATOMY. 44px minimum (the preview target needs it), `px-2`, `gap-3`, a
 * hairline under each row. The radio mark carries the selected state; the row
 * ground never changes for selection, only for hover (`row-hover`): an
 * `accent` mark on `row-selected` is 4.24:1 worst and `border-control` on it
 * 2.77:1 worst (spec §9), so a selected ground would fight the mark.
 *
 * The whole row is the radio's label: clicking anywhere except its buttons
 * selects it. Buttons stop propagation so a preview press never selects.
 */

import { ICON_BUTTON_CLASS } from "@shared/components/common/icon-button-class";
import { Spinner } from "@shared/components/common/spinner";
import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
	RadioGroupItem,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { CirclePlay, CircleStop, Ellipsis } from "lucide-react";
import {
	type FC,
	type KeyboardEvent,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	type NotificationSound,
	formatSoundDuration,
	renameError,
} from "../notification-sound-model";

export type PreviewState = "idle" | "loading" | "playing" | "failed";

/**
 * Shared row chrome. `STATIC_ROW_CLASS` is the anatomy (pending, error and
 * empty rows use it: they are not choices, so they take no hover step);
 * `ROW_CLASS` adds the hover a selectable row has.
 */
export const STATIC_ROW_CLASS =
	"group/row flex min-h-11 items-center gap-3 border-b border-hairline px-2";
// Keep the complete selectable row literal: the row-state contract's AST
// scan must see every rung without evaluating a runtime substitution.
export const ROW_CLASS =
	"group/row flex min-h-11 items-center gap-3 border-b border-hairline px-2 hover:bg-row-hover";

/**
 * The radio ring's hover step. `border-control` on `row-hover` is under 3:1 in
 * 5 of 59 palettes, so the ring steps to `ink-muted` while the row is hovered
 * (spec §3.4). Not applied to a checked ring, which is already `accent`.
 */
const RADIO_HOVER_CLASS =
	"group-hover/row:not-data-[state=checked]:border-ink-muted";

type PreviewButtonProps = {
	sound: NotificationSound;
	state: PreviewState;
	onToggle: () => void;
	/** Built-in previews leave the tab order: arrowing the list previews (C6). */
	inTabOrder: boolean;
};

const PreviewButton: FC<PreviewButtonProps> = ({
	sound,
	state,
	onToggle,
	inTabOrder,
}) => {
	useI18nLocale();
	const playing = state === "playing";
	const label = playing
		? t("ui.settings.notifications.preview.stop", { name: sound.label })
		: t("ui.settings.notifications.preview.play", { name: sound.label });
	return (
		<button
			type="button"
			className={cn(
				ICON_BUTTON_CLASS,
				playing && "text-accent hover:text-accent",
			)}
			aria-label={label}
			aria-pressed={playing}
			tabIndex={inTabOrder ? undefined : -1}
			data-preview={sound.id}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onToggle();
			}}
		>
			{state === "loading" ? (
				<Spinner size="sm" />
			) : playing ? (
				<CircleStop className="size-4" aria-hidden="true" />
			) : (
				<CirclePlay className="size-4" aria-hidden="true" />
			)}
		</button>
	);
};

export type SoundRowProps = {
	sound: NotificationSound;
	/** The "Default" tag and its description suffix (Soft pulse only). */
	isDefault: boolean;
	preview: PreviewState;
	onPreview: () => void;
	/** Ids for `aria-describedby` (the group subhead on custom rows). */
	describedBy?: string;
	/** Second line under the name (the System row's description). */
	description?: string;
	/** No preview button: lop cannot play the OS sound (System row). */
	noPreview?: boolean;
};

/** A built-in or System row: radio, name, tag, preview. */
export const SoundRow: FC<SoundRowProps> = ({
	sound,
	isDefault,
	preview,
	onPreview,
	describedBy,
	description,
	noPreview = false,
}) => {
	useI18nLocale();
	const radioId = `notification-sound-${sound.id}`;
	const descriptionId = description ? `${radioId}-description` : undefined;
	return (
		<div className="flex flex-col">
			<label
				htmlFor={radioId}
				className={cn(ROW_CLASS, "cursor-pointer")}
				data-sound-row={sound.id}
			>
				<RadioGroupItem
					id={radioId}
					value={sound.id}
					className={RADIO_HOVER_CLASS}
					aria-describedby={
						[descriptionId, describedBy].filter(Boolean).join(" ") || undefined
					}
					// The default's tag is visible text, so it is spoken with the name.
					aria-label={
						isDefault
							? `${sound.label}, ${t("ui.settings.notifications.list.default_tag")}`
							: undefined
					}
				/>
				<span className="flex min-w-0 flex-1 flex-col py-2">
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate text-body text-ink" title={sound.label}>
							{sound.label}
						</span>
						{isDefault && (
							<Badge variant="neutral" className="shrink-0">
								{t("ui.settings.notifications.list.default_tag")}
							</Badge>
						)}
					</span>
					{description && (
						<span id={descriptionId} className="text-body-sm text-ink-muted">
							{description}
						</span>
					)}
				</span>
				{!noPreview && (
					<PreviewButton
						sound={sound}
						state={preview}
						onToggle={onPreview}
						inTabOrder={false}
					/>
				)}
			</label>
			{preview === "failed" && (
				<output className="block px-2 pt-1 pb-2 text-meta text-danger">
					{t("ui.settings.notifications.preview.failed")}
				</output>
			)}
		</div>
	);
};

export type CustomRowMode =
	| { kind: "idle" }
	| { kind: "renaming"; saving: boolean; error: string | null }
	| { kind: "confirm-remove"; removing: boolean; error: string | null };

export type CustomSoundRowProps = {
	sound: NotificationSound;
	selected: boolean;
	preview: PreviewState;
	onPreview: () => void;
	mode: CustomRowMode;
	maxNameChars: number;
	/** The "Your sounds" subhead, announced on entry (spec §8). */
	describedBy: string;
	/** Who owns focus for this row's More button after rename/remove. */
	moreRef: RefObject<HTMLButtonElement>;
	onStartRename: () => void;
	onRename: (name: string) => Promise<void>;
	onCancelRename: () => void;
	onStartRemove: () => void;
	onConfirmRemove: () => void;
	onCancelRemove: () => void;
};

/** A custom row: radio, name, duration, preview, More (Rename, Remove…). */
export const CustomSoundRow: FC<CustomSoundRowProps> = ({
	sound,
	selected,
	preview,
	onPreview,
	mode,
	maxNameChars,
	describedBy,
	moreRef,
	onStartRename,
	onRename,
	onCancelRename,
	onStartRemove,
	onConfirmRemove,
	onCancelRemove,
}) => {
	useI18nLocale();
	const radioId = `notification-sound-${sound.id}`;
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const duration = formatSoundDuration(sound.duration_s);

	/* Initial focus on Cancel: the safe default (spec §5.4). */
	useEffect(() => {
		if (mode.kind === "confirm-remove" && !mode.removing) {
			const timer = setTimeout(() => cancelRef.current?.focus(), 0);
			return () => clearTimeout(timer);
		}
	}, [mode]);

	if (mode.kind === "confirm-remove") {
		const sentence = selected
			? t("ui.settings.notifications.custom.remove_confirm_selected", {
					name: sound.label,
				})
			: t("ui.settings.notifications.custom.remove_confirm", {
					name: sound.label,
				});
		return (
			<div
				className="flex flex-col gap-2 border-b border-hairline px-2 py-2"
				data-sound-row={sound.id}
				data-row-mode="confirm-remove"
				onKeyDown={(event: KeyboardEvent) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						onCancelRemove();
					}
				}}
			>
				<div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2">
					<p className="min-w-0 flex-1 text-body-sm text-ink">{sentence}</p>
					<div className="flex shrink-0 items-center gap-2">
						<Button
							variant="danger"
							size="sm"
							onClick={onConfirmRemove}
							disabled={mode.removing}
						>
							{mode.removing && <Spinner size="xs" />}
							{t("ui.settings.notifications.custom.remove_action")}
						</Button>
						<Button
							ref={cancelRef}
							variant="secondary"
							size="sm"
							onClick={onCancelRemove}
							disabled={mode.removing}
						>
							{t("ui.settings.notifications.custom.cancel")}
						</Button>
					</div>
				</div>
				{mode.error && (
					<output className="block text-meta text-danger">{mode.error}</output>
				)}
			</div>
		);
	}

	if (mode.kind === "renaming") {
		return (
			<div
				className="flex flex-col border-b border-hairline px-2 py-1"
				data-sound-row={sound.id}
				data-row-mode="renaming"
			>
				<div className="flex min-h-9 items-center gap-3">
					{/* The mark stays, inert, so the row keeps its place in the scan. */}
					<span
						aria-hidden="true"
						className={cn(
							"inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
							selected ? "border-accent" : "border-control",
						)}
					>
						{selected && <span className="size-2 rounded-full bg-accent" />}
					</span>
					<RenameField
						initial={sound.label}
						maxNameChars={maxNameChars}
						saving={mode.saving}
						onSave={onRename}
						onCancel={onCancelRename}
						serverError={mode.error}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<label
				htmlFor={radioId}
				className={cn(ROW_CLASS, "@container cursor-pointer")}
				data-sound-row={sound.id}
			>
				<RadioGroupItem
					id={radioId}
					value={sound.id}
					className={RADIO_HOVER_CLASS}
					aria-describedby={describedBy}
					aria-keyshortcuts="F2 Delete"
					onKeyDown={(event) => {
						if (event.key === "F2") {
							event.preventDefault();
							onStartRename();
						} else if (event.key === "Delete") {
							event.preventDefault();
							onStartRemove();
						}
					}}
				/>
				<span
					className="min-w-0 flex-1 truncate py-2 text-body text-ink"
					title={sound.label}
				>
					{sound.label}
				</span>
				{duration && (
					// Hidden from the radio's name: the label wraps this span, and
					// "My clip 0:02" is not the sound's name (review round 1, m2).
					<span
						aria-hidden="true"
						className="hidden shrink-0 font-mono text-mono-sm text-ink-dim @[420px]:inline"
					>
						{duration}
					</span>
				)}
				<PreviewButton
					sound={sound}
					state={preview}
					onToggle={onPreview}
					inTabOrder
				/>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							ref={moreRef}
							variant="ghost"
							size="icon"
							className="size-11 shrink-0 text-ink-muted hover:text-ink"
							aria-label={t("ui.settings.notifications.custom.more", {
								name: sound.label,
							})}
							data-sound-more={sound.id}
							onClick={(event) => event.stopPropagation()}
						>
							<Ellipsis aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-40">
						<DropdownMenuItem onSelect={onStartRename}>
							{t("ui.settings.notifications.custom.rename")}
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={onStartRemove}>
							{t("ui.settings.notifications.custom.remove")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</label>
			{preview === "failed" && (
				<output className="block px-2 pt-1 pb-2 text-meta text-danger">
					{t("ui.settings.notifications.preview.failed")}
				</output>
			)}
		</div>
	);
};

type RenameFieldProps = {
	initial: string;
	maxNameChars: number;
	saving: boolean;
	onSave: (name: string) => Promise<void>;
	onCancel: () => void;
	/** The daemon's refusal (`Couldn't rename. {reason}`), shown under the field. */
	serverError: string | null;
};

/**
 * The rename field (spec §5.3): opens focused with the text selected, Enter
 * saves, Esc cancels, and the field stays open on any failure.
 *
 * WHY NOT `InlineEditText`, which the spec names. That primitive closes
 * silently on an empty value and on an unchanged one, and reads its open
 * signal only as a change after mount; this row opens straight into editing
 * and must SAY "Name can't be empty" rather than close. A field built on the
 * `Input` primitive keeps those two rules without bending the shared one.
 * Blur does nothing: leaving the field is not a decision to save or discard.
 */
const RenameField: FC<RenameFieldProps> = ({
	initial,
	maxNameChars,
	saving,
	onSave,
	onCancel,
	serverError,
}) => {
	useI18nLocale();
	const [draft, setDraft] = useState(initial);
	const [localError, setLocalError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const errorId = useId();
	useEffect(() => {
		/* One task later, for the menu path: Radix returns focus to the More
		 * trigger as the menu closes, and that must land before ours does. */
		const timer = setTimeout(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		}, 0);
		return () => clearTimeout(timer);
	}, []);
	const error = localError ?? serverError;
	/* Set once Enter/Esc/blur has decided, so the blur after Esc is not a save. */
	const settled = useRef(false);
	// A failed save reopens the field (saving -> false with an error): live again.
	useEffect(() => {
		if (!saving) settled.current = false;
	}, [saving]);
	const submit = () => {
		const invalid = renameError(draft, maxNameChars);
		if (invalid) {
			setLocalError(
				invalid === "ui.settings.notifications.custom.rename_long"
					? t(invalid, { max: maxNameChars })
					: t("ui.settings.notifications.custom.rename_empty"),
			);
			return;
		}
		settled.current = true;
		void onSave(draft.trim());
	};
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-1">
			<Input
				ref={inputRef}
				inputSize="sm"
				value={draft}
				disabled={saving}
				aria-label={t("ui.settings.notifications.custom.rename_label")}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				onChange={(event) => {
					setDraft(event.target.value);
					setLocalError(null);
				}}
				onKeyDown={(event) => {
					if (event.nativeEvent.isComposing) return;
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						settled.current = true;
						onCancel();
					} else if (event.key === "Enter") {
						event.preventDefault();
						submit();
					}
				}}
				/*
				 * BLUR SAVES A VALID DRAFT, as `InlineEditText` does everywhere else
				 * (UX round 1, U7): clicking away used to drop the edit silently. An
				 * unchanged draft is a cancel; an invalid one stays open with its
				 * error, rather than closing on a value the user cannot keep.
				 */
				onBlur={() => {
					if (saving || settled.current) return;
					if (draft.trim() === initial.trim()) {
						settled.current = true;
						onCancel();
						return;
					}
					submit();
				}}
			/>
			{error && (
				<p id={errorId} className="text-meta text-danger">
					{error}
				</p>
			)}
		</div>
	);
};
