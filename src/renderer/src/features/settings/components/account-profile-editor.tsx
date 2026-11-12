/** Personal presentation only. Identity/email/password stay in the secure
 * console. Text and photo are separate transactions: cancelling a crop must
 * never discard text, and a photo response must never replace a text draft. */
import {
	type AccountProfileFields,
	type AccountProfileSnapshot,
	dirtyProfileFields,
} from "@shared/api/radient/account-profile";
import { decodeProfileImage } from "@shared/api/radient/profile-image";
import { AvatarCropper } from "@shared/components/avatar-cropper";
import { Button, Input, Label, Textarea } from "@shared/components/ui";
import { SearchableSelect } from "@shared/components/ui/searchable-select";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	dispatchWhileCurrent,
	useMutationLifetime,
} from "@shared/lib/mutation-lifetime";
import { openConsolePage } from "@shared/utils/radient-account-copy";
import { ExternalLink } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactElement,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { timezoneOptions } from "./timezone-options";

export type AccountProfileEditorProps = {
	snapshot: AccountProfileSnapshot;
	initialDraft?: Partial<AccountProfileFields>;
	onDraftChange?: (fields: Partial<AccountProfileFields>) => void;
	photoUrl?: string;
	onSave: (
		fields: Partial<AccountProfileFields>,
	) => Promise<AccountProfileSnapshot>;
	onUpload: (bytes: Uint8Array) => Promise<AccountProfileSnapshot>;
	onRemove: (mode: "uploaded" | "provider") => Promise<AccountProfileSnapshot>;
};
const textFields = (
	snapshot: AccountProfileSnapshot,
): AccountProfileFields => ({
	display_name: snapshot.profile.display_name,
	title: snapshot.profile.title,
	description: snapshot.profile.description,
	timezone: snapshot.profile.timezone,
});
/** The service's own bounds (agent-server ACCOUNT-PROFILE.md), in code points
 * (runes). The submit check below counts code points and is the authority; it
 * also covers the 8-line rule and a retained draft, which no attribute can. */
const FIELD_LIMITS = { display_name: 64, title: 80, description: 500 } as const;
/** `maxLength` counts UTF-16 code units, so the code-point limit itself would
 * stop a name of emoji (2 units each) at half its allowed length (code round
 * 3, m1). Twice the limit is the most units the limit's code points can take,
 * so the attribute never refuses valid input; it only caps a runaway paste. */
const inputMaxLength = (field: TextField) => FIELD_LIMITS[field] * 2;
const DESCRIPTION_LINES = 8;
type TextField = keyof typeof FIELD_LIMITS;
type FieldError = { field: TextField; reason: "length" | "lines" };

export function AccountProfileEditor({
	snapshot,
	initialDraft,
	onDraftChange,
	photoUrl,
	onSave,
	onUpload,
	onRemove,
}: AccountProfileEditorProps) {
	const locale = useI18nLocale();
	const id = useId();
	const [baseline, setBaseline] = useState(() => textFields(snapshot));
	const [draft, setDraft] = useState(() => ({
		...textFields(snapshot),
		...initialDraft,
	}));
	const [saving, setSaving] = useState(false);
	const [photoBusy, setPhotoBusy] = useState(false);
	const [error, setError] = useState<"save_error">();
	const [fieldError, setFieldError] = useState<FieldError>();
	const [photoError, setPhotoError] = useState<
		"photo_invalid" | "photo_error"
	>();
	const [notice, setNotice] = useState<"saved">();
	// Photo feedback sits beside the photo controls (UX round 1, U6): the text
	// form's line can be a screen away from the avatar that just changed.
	const [photoNotice, setPhotoNotice] = useState<
		"photo_saved" | "photo_removed"
	>();
	/*
	 * WHERE FOCUS GOES NEXT (UX round 1, U2). Every action here unmounts or
	 * disables the control that was pressed, and a browser then drops focus to
	 * <body>, so a keyboard or screen-reader user loses their place. Each action
	 * names the control that should hold focus after the re-render; the effect
	 * below moves it once the target exists.
	 */
	const [focusNext, setFocusNext] = useState<
		| "heading"
		| "photo"
		| "remove"
		| "remove_cancel"
		| "cancel"
		| "keep_editing"
		| TextField
	>();
	const refs = {
		heading: useRef<HTMLHeadingElement>(null),
		photo: useRef<HTMLButtonElement>(null),
		remove: useRef<HTMLButtonElement>(null),
		remove_cancel: useRef<HTMLButtonElement>(null),
		cancel: useRef<HTMLButtonElement>(null),
		keep_editing: useRef<HTMLButtonElement>(null),
		display_name: useRef<HTMLInputElement>(null),
		title: useRef<HTMLInputElement>(null),
		description: useRef<HTMLTextAreaElement>(null),
	};
	const timezones = useMemo(() => timezoneOptions(locale), [locale]);
	const [discard, setDiscard] = useState(false);
	const [remove, setRemove] = useState(false);
	const [source, setSource] = useState<ImageBitmap>();
	const photoLifetime = useMutationLifetime(source);
	const picker = useRef<HTMLInputElement>(null);
	const sourceRef = useRef<ImageBitmap | undefined>(undefined);
	const alive = useRef(true);
	const pickSequence = useRef(0);
	const dirty = Object.keys(dirtyProfileFields(baseline, draft)).length > 0;
	useEffect(() => {
		onDraftChange?.(dirtyProfileFields(baseline, draft));
	}, [baseline, draft, onDraftChange]);
	const photoErrorText =
		photoError === "photo_invalid"
			? t("ui.settings.personal_profile.photo_invalid")
			: photoError
				? t("ui.settings.personal_profile.photo_error")
				: undefined;
	const photo = snapshot.profile.avatar;
	const mode = photo?.source === "uploaded" ? "uploaded" : "provider";
	const busy = saving || photoBusy;
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			pickSequence.current++;
			sourceRef.current?.close();
		};
	}, []);
	/*
	 * NO `beforeunload` GUARD, deliberately (UX round 1, U1). In Electron a
	 * cancelled `beforeunload` shows no dialog: it silently cancels the close,
	 * so a dirty draft blocked window close, Cmd+Q, `/exit`, Sign out's reload
	 * and an update's quit, with nothing on screen to say why. The draft's
	 * contract is the in-memory retention in `account-profile-draft.ts` across
	 * in-app navigation; a full unload is the user leaving, and it must succeed.
	 * `desktop-ipc.ts` relies on this renderer having no such handler.
	 */
	useEffect(() => {
		if (!focusNext) return;
		// One attempt, then the request is spent (code round 3, m2): a target
		// that is absent now (a refetch removed the photo, so no Remove button)
		// must not stay pending and steal focus when it next mounts.
		refs[focusNext].current?.focus();
		setFocusNext(undefined);
	});
	const clearCrop = () => {
		pickSequence.current++;
		sourceRef.current?.close();
		sourceRef.current = undefined;
		setSource(undefined);
		setPhotoError(undefined);
	};
	const cancelCrop = () => {
		clearCrop();
		setFocusNext("photo");
	};
	const keepEditing = () => {
		setDiscard(false);
		setFocusNext("cancel");
	};
	const cancelRemove = () => {
		setRemove(false);
		setFocusNext("remove");
	};
	/** Escape backs out of an inline confirm-or-cancel moment, as it does for the
	 * profile card and the timezone list (UX round 1, U3). */
	const onEscape =
		(dismiss: () => void, blocked = false) =>
		(event: KeyboardEvent) => {
			if (event.key !== "Escape" || blocked) return;
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		};
	const choose = async (file: File | undefined) => {
		if (!file || busy) return;
		const sequence = ++pickSequence.current;
		setPhotoError(undefined);
		setPhotoBusy(true);
		setPhotoNotice(undefined);
		try {
			const bitmap = await decodeProfileImage(file);
			if (!alive.current || sequence !== pickSequence.current) {
				bitmap.close();
				return;
			}
			sourceRef.current?.close();
			sourceRef.current = bitmap;
			setSource(bitmap);
			setRemove(false);
		} catch {
			if (alive.current && sequence === pickSequence.current)
				setPhotoError("photo_invalid");
		} finally {
			if (alive.current && sequence === pickSequence.current)
				setPhotoBusy(false);
		}
	};
	const save = async () => {
		if (!alive.current || busy || !dirty) return;
		const fields = dirtyProfileFields(baseline, draft);
		// Code points, as the service counts them; the first failing field is
		// named and focused rather than a form-wide alert (UX round 1, U5).
		const invalid = (Object.keys(FIELD_LIMITS) as TextField[])
			.map((field): FieldError | undefined =>
				field in fields && [...draft[field]].length > FIELD_LIMITS[field]
					? { field, reason: "length" }
					: field === "description" &&
							draft.description.split("\n").length > DESCRIPTION_LINES
						? { field, reason: "lines" }
						: undefined,
			)
			.find(Boolean);
		if (invalid) {
			setFieldError(invalid);
			setFocusNext(invalid.field);
			return;
		}
		setSaving(true);
		setError(undefined);
		setFieldError(undefined);
		setNotice(undefined);
		try {
			const next = await onSave(fields);
			if (!alive.current) return;
			// Text inputs are frozen for this transaction. The server's normalized
			// values become the next baseline, never a photo read's stale text.
			setBaseline(textFields(next));
			setDraft(textFields(next));
			setNotice("saved");
			// Save is now disabled (nothing is dirty); the section heading is the
			// stable place to land, and the status line beside the form says why.
			setFocusNext("heading");
		} catch {
			if (alive.current) setError("save_error");
		} finally {
			if (alive.current) setSaving(false);
		}
	};
	const savePhoto = async (blob: Blob) => {
		if (!alive.current || busy) return;
		setPhotoBusy(true);
		setPhotoError(undefined);
		setPhotoNotice(undefined);
		const sequence = pickSequence.current;
		const ticket = photoLifetime.capture();
		try {
			if (blob.size > 1024 * 1024) throw new Error("Profile crop too large");
			const dispatched = await dispatchWhileCurrent(
				photoLifetime,
				ticket,
				() => blob.arrayBuffer(),
				(bytes) => {
					if (!alive.current || sequence !== pickSequence.current) return;
					return onUpload(new Uint8Array(bytes));
				},
			);
			if (!dispatched) return;
			if (!alive.current) return;
			clearCrop();
			setPhotoNotice("photo_saved");
			setFocusNext("photo");
		} catch {
			if (alive.current) setPhotoError("photo_error");
		} finally {
			if (alive.current) setPhotoBusy(false);
		}
	};
	const removePhoto = async () => {
		if (!alive.current || busy) return;
		setPhotoBusy(true);
		setPhotoError(undefined);
		setPhotoNotice(undefined);
		try {
			await onRemove(mode);
			if (alive.current) {
				setRemove(false);
				setPhotoNotice("photo_removed");
				// Remove is gone with the photo; Choose photo is where a reader goes next.
				setFocusNext("photo");
			}
		} catch {
			if (alive.current) setPhotoError("photo_error");
		} finally {
			if (alive.current) setPhotoBusy(false);
		}
	};
	const change = (key: keyof AccountProfileFields, value: string) => {
		// The fields stay legible (read-only) during a save (design round 1, D1);
		// the timezone list cannot be read-only, so its pick is ignored instead.
		if (saving) return;
		setDraft((old) => ({ ...old, [key]: value }));
		setNotice(undefined);
		setError(undefined);
		if (fieldError?.field === key) setFieldError(undefined);
		setDiscard(false);
	};
	const fieldMessage = (field: TextField) =>
		fieldError?.field !== field
			? undefined
			: fieldError.reason === "lines"
				? t("ui.settings.personal_profile.description_lines", {
						count: String(DESCRIPTION_LINES),
					})
				: t("ui.settings.personal_profile.field_too_long", {
						count: String(FIELD_LIMITS[field]),
					});
	/** One text field: its server bound as `maxLength`, `aria-invalid` and a
	 * field-specific message when Save refuses it (UX round 1, U5), and read-only
	 * rather than disabled while saving so the submitted draft stays legible
	 * (design round 1, D1). */
	const textField = (
		field: TextField,
		label: string,
		control: (props: {
			id: string;
			value: string;
			maxLength: number;
			readOnly: boolean;
			"aria-invalid": true | undefined;
			"aria-describedby": string | undefined;
		}) => ReactElement,
	) => {
		const message = fieldMessage(field);
		return (
			<div className="flex flex-col gap-2">
				<Label htmlFor={`${id}-${field}`}>{label}</Label>
				{control({
					id: `${id}-${field}`,
					value: draft[field],
					maxLength: inputMaxLength(field),
					readOnly: saving,
					"aria-invalid": message ? true : undefined,
					"aria-describedby": message ? `${id}-${field}-error` : undefined,
				})}
				{message && (
					<p id={`${id}-${field}-error`} className="text-meta text-danger">
						{message}
					</p>
				)}
			</div>
		);
	};
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="flex min-w-0 flex-col gap-4"
			data-account-profile-editor=""
		>
			<h3
				ref={refs.heading}
				id={`${id}-heading`}
				tabIndex={-1}
				className="text-section font-semibold text-ink focus:outline-none"
			>
				{t("ui.settings.personal_profile.heading")}
			</h3>
			<div className="flex flex-wrap items-center gap-3">
				<span
					className="inline-flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken text-ink-muted"
					aria-hidden="true"
				>
					{photoUrl ? (
						<img alt="" src={photoUrl} className="size-full object-cover" />
					) : (
						snapshot.profile.display_label.trim()[0] || "?"
					)}
				</span>
				<Button
					ref={refs.photo}
					variant="secondary"
					size="sm"
					disabled={busy}
					onClick={() => picker.current?.click()}
				>
					{photo?.hash
						? t("ui.settings.personal_profile.replace")
						: t("ui.settings.personal_profile.choose")}
				</Button>
				{photo?.hash && (
					<Button
						ref={refs.remove}
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => {
							setRemove(true);
							clearCrop();
							setFocusNext("remove_cancel");
						}}
					>
						{t("ui.settings.personal_profile.remove")}
					</Button>
				)}
				{/* The visible button is the one named control; the input is only
				   the OS picker's carrier, so it is out of the accessibility tree
				   (UX round 1, N2: browse mode announced "Choose photo" twice). */}
				<input
					ref={picker}
					type="file"
					accept="image/png,image/jpeg,image/webp"
					className="sr-only"
					tabIndex={-1}
					aria-hidden="true"
					disabled={busy}
					onChange={(event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = "";
						void choose(file);
					}}
				/>
			</div>
			<p className="text-meta text-ink-dim">
				{t("ui.settings.personal_profile.photo_help")}
			</p>
			<output className="text-meta text-ink-muted empty:hidden">
				{photoNotice === "photo_saved"
					? t("ui.settings.personal_profile.photo_saved")
					: photoNotice === "photo_removed"
						? t("ui.settings.personal_profile.photo_removed")
						: null}
			</output>
			{source && (
				<div onKeyDown={onEscape(cancelCrop, photoBusy)}>
					<AvatarCropper
						source={source}
						outputEdge={256}
						onSave={(blob) => void savePhoto(blob)}
						onCancel={cancelCrop}
						saving={photoBusy}
						error={photoErrorText}
						previewSizes={[
							{
								id: "profile",
								px: 64,
								label: t("ui.settings.personal_profile.preview"),
								caption: t("ui.settings.personal_profile.preview_caption"),
							},
						]}
						copy={{
							cropArea: t("ui.settings.personal_profile.crop_area"),
							instructions: (width, height) =>
								t("ui.settings.personal_profile.crop_instructions", {
									width: String(width),
									height: String(height),
								}),
							zoom: t("ui.settings.personal_profile.zoom"),
							zoomIn: t("ui.settings.personal_profile.zoom_in"),
							zoomOut: t("ui.settings.personal_profile.zoom_out"),
							zoomValue: (value) =>
								t("ui.settings.personal_profile.zoom_value", { value }),
							recenter: t("ui.settings.personal_profile.recenter"),
							previews: t("ui.settings.personal_profile.previews"),
							save: t("ui.settings.personal_profile.save_photo"),
							saving: t("ui.settings.personal_profile.saving"),
							cancel: t("ui.common.actions.cancel"),
							errorEncode: t("ui.settings.personal_profile.crop_error"),
						}}
					/>
				</div>
			)}
			{remove && (
				<fieldset
					className="flex flex-col gap-2"
					aria-label={t("ui.settings.personal_profile.remove")}
					onKeyDown={onEscape(cancelRemove, photoBusy)}
				>
					<p className="text-body-sm text-ink">
						{mode === "uploaded"
							? t("ui.settings.personal_profile.remove_uploaded")
							: t("ui.settings.personal_profile.remove_provider")}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="danger"
							size="sm"
							disabled={busy}
							onClick={() => void removePhoto()}
						>
							{photoBusy
								? t("ui.settings.personal_profile.saving")
								: t("ui.settings.personal_profile.remove")}
						</Button>
						<Button
							ref={refs.remove_cancel}
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={cancelRemove}
						>
							{t("ui.common.actions.cancel")}
						</Button>
					</div>
				</fieldset>
			)}
			{photoError && !source && (
				<p role="alert" className="text-meta text-danger">
					{photoErrorText}
				</p>
			)}
			<form
				className="flex min-w-0 flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
				aria-busy={saving}
			>
				{textField(
					"display_name",
					t("ui.settings.personal_profile.display_name"),
					(props) => (
						<Input
							ref={refs.display_name}
							{...props}
							onChange={(event) => change("display_name", event.target.value)}
							autoComplete="nickname"
						/>
					),
				)}
				{textField(
					"title",
					t("ui.settings.personal_profile.title"),
					(props) => (
						<Input
							ref={refs.title}
							{...props}
							onChange={(event) => change("title", event.target.value)}
							autoComplete="organization-title"
						/>
					),
				)}
				{textField(
					"description",
					t("ui.settings.personal_profile.description"),
					(props) => (
						<Textarea
							ref={refs.description}
							{...props}
							onChange={(event) => change("description", event.target.value)}
							rows={3}
						/>
					),
				)}
				{/* The label is rendered HERE, with the same Label as its siblings,
				   so all four read alike (design round 1, D2) without changing the
				   shared control's default for its other callers. */}
				<div className="flex flex-col gap-2">
					{/* The combobox carries the same name via `ariaLabel` (its input id
					   is the control's own), so this visible copy is hidden from the
					   accessibility tree rather than announced twice. */}
					<Label asChild>
						<span aria-hidden="true">
							{t("ui.settings.personal_profile.timezone")}
						</span>
					</Label>
					<SearchableSelect
						showLabel={false}
						ariaLabel={t("ui.settings.personal_profile.timezone")}
						placeholder={t("ui.settings.personal_profile.timezone_placeholder")}
						busyLabel={t("ui.settings.personal_profile.loading")}
						options={timezones}
						selected={
							draft.timezone
								? (timezones.find((zone) => zone.id === draft.timezone) ?? {
										id: draft.timezone,
										name: draft.timezone.split("_").join(" "),
									})
								: null
						}
						onSelect={(option) => change("timezone", option.id)}
						onClear={() => change("timezone", "")}
					/>
				</div>
				{error && (
					<p role="alert" className="text-meta text-danger">
						{t("ui.settings.personal_profile.save_error")}
					</p>
				)}
				{discard ? (
					/* The question is a live alert and focus moves into it, so a
					   screen-reader user who pressed Cancel hears what is being asked
					   (UX round 1, U2). Same `sm` size as Save/Cancel so the row does
					   not grow when it swaps in (design round 1, D4). */
					<div
						className="flex flex-col gap-2"
						onKeyDown={onEscape(keepEditing)}
					>
						<p role="alert" className="text-body-sm text-ink">
							{t("ui.settings.personal_profile.discard")}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => {
									setDraft(baseline);
									setDiscard(false);
									setError(undefined);
									setFieldError(undefined);
									setFocusNext("heading");
								}}
							>
								{t("ui.settings.personal_profile.discard_action")}
							</Button>
							<Button
								ref={refs.keep_editing}
								type="button"
								variant="primary"
								size="sm"
								onClick={keepEditing}
							>
								{t("ui.settings.personal_profile.keep_editing")}
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-wrap gap-2">
						<Button
							type="submit"
							variant="primary"
							size="sm"
							disabled={!dirty || busy}
						>
							{saving
								? t("ui.settings.personal_profile.saving")
								: t("ui.settings.personal_profile.save")}
						</Button>
						<Button
							ref={refs.cancel}
							type="button"
							variant="secondary"
							size="sm"
							disabled={!dirty || saving}
							onClick={() => {
								setDiscard(true);
								setFocusNext("keep_editing");
							}}
						>
							{t("ui.common.actions.cancel")}
						</Button>
					</div>
				)}
			</form>
			<output className="text-meta text-ink-muted empty:hidden">
				{notice === "saved" ? t("ui.settings.personal_profile.saved") : null}
			</output>
			{/* A link that leaves the app, flush with the column like every other
			   element, with the external-link mark so "in browser" is seen, not
			   only read (design round 1, D3). */}
			<Button
				variant="link"
				size="sm"
				className="w-fit"
				onClick={() =>
					openConsolePage("https://console.radienthq.com/dashboard/account")
				}
			>
				{t("ui.settings.personal_profile.manage")}
				<ExternalLink aria-hidden="true" />
			</Button>
		</section>
	);
}
