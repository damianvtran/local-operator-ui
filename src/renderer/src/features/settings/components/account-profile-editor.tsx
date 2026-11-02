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
import { useEffect, useId, useRef, useState } from "react";

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
const timezones = () =>
	[...new Set(["UTC", ...Intl.supportedValuesOf("timeZone")])].map((value) => ({
		id: value,
		name: value.split("_").join(" "),
	}));

export function AccountProfileEditor({
	snapshot,
	initialDraft,
	onDraftChange,
	photoUrl,
	onSave,
	onUpload,
	onRemove,
}: AccountProfileEditorProps) {
	useI18nLocale();
	const id = useId();
	const [baseline, setBaseline] = useState(() => textFields(snapshot));
	const [draft, setDraft] = useState(() => ({
		...textFields(snapshot),
		...initialDraft,
	}));
	const [saving, setSaving] = useState(false);
	const [photoBusy, setPhotoBusy] = useState(false);
	const [error, setError] = useState<"validation" | "save_error">();
	const [photoError, setPhotoError] = useState<
		"photo_invalid" | "photo_error"
	>();
	const [notice, setNotice] = useState<
		"saved" | "photo_saved" | "photo_removed"
	>();
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
	useEffect(() => {
		if (!dirty && !source) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirty, source]);
	const clearCrop = () => {
		pickSequence.current++;
		sourceRef.current?.close();
		sourceRef.current = undefined;
		setSource(undefined);
		setPhotoError(undefined);
	};
	const choose = async (file: File | undefined) => {
		if (!file || busy) return;
		const sequence = ++pickSequence.current;
		setPhotoError(undefined);
		setPhotoBusy(true);
		setNotice(undefined);
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
		if (
			(Object.entries(fields) as [keyof AccountProfileFields, string][]).some(
				([key, value]) =>
					[...value].length >
					{ display_name: 64, title: 80, description: 500, timezone: 64 }[key],
			) ||
			draft.description.split("\n").length > 8
		) {
			setError("validation");
			return;
		}
		setSaving(true);
		setError(undefined);
		setNotice(undefined);
		try {
			const next = await onSave(fields);
			if (!alive.current) return;
			// Text inputs are frozen for this transaction. The server's normalized
			// values become the next baseline, never a photo read's stale text.
			setBaseline(textFields(next));
			setDraft(textFields(next));
			setNotice("saved");
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
		setNotice(undefined);
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
			setNotice("photo_saved");
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
		setNotice(undefined);
		try {
			await onRemove(mode);
			if (alive.current) {
				setRemove(false);
				setNotice("photo_removed");
			}
		} catch {
			if (alive.current) setPhotoError("photo_error");
		} finally {
			if (alive.current) setPhotoBusy(false);
		}
	};
	const change = (key: keyof AccountProfileFields, value: string) => {
		setDraft((old) => ({ ...old, [key]: value }));
		setNotice(undefined);
		setError(undefined);
		setDiscard(false);
	};
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="flex min-w-0 flex-col gap-4"
			data-account-profile-editor=""
		>
			<h3 id={`${id}-heading`} className="text-section font-semibold text-ink">
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
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => {
							setRemove(true);
							clearCrop();
						}}
					>
						{t("ui.settings.personal_profile.remove")}
					</Button>
				)}
				<input
					ref={picker}
					type="file"
					accept="image/png,image/jpeg,image/webp"
					className="sr-only"
					tabIndex={-1}
					aria-label={t("ui.settings.personal_profile.choose")}
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
			{source && (
				<AvatarCropper
					source={source}
					outputEdge={256}
					onSave={(blob) => void savePhoto(blob)}
					onCancel={clearCrop}
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
			)}
			{remove && (
				<fieldset
					className="flex flex-col gap-2"
					aria-label={t("ui.settings.personal_profile.remove")}
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
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={() => setRemove(false)}
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
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${id}-name`}>
						{t("ui.settings.personal_profile.display_name")}
					</Label>
					<Input
						id={`${id}-name`}
						value={draft.display_name}
						maxLength={128}
						disabled={saving}
						onChange={(event) => change("display_name", event.target.value)}
						autoComplete="nickname"
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${id}-title`}>
						{t("ui.settings.personal_profile.title")}
					</Label>
					<Input
						id={`${id}-title`}
						value={draft.title}
						maxLength={160}
						disabled={saving}
						onChange={(event) => change("title", event.target.value)}
						autoComplete="organization-title"
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${id}-about`}>
						{t("ui.settings.personal_profile.description")}
					</Label>
					<Textarea
						id={`${id}-about`}
						value={draft.description}
						maxLength={1000}
						disabled={saving}
						onChange={(event) => change("description", event.target.value)}
						rows={3}
					/>
				</div>
				<SearchableSelect
					label={t("ui.settings.personal_profile.timezone")}
					placeholder={t("ui.settings.personal_profile.timezone_placeholder")}
					busyLabel={t("ui.settings.personal_profile.loading")}
					options={timezones()}
					selected={
						draft.timezone
							? {
									id: draft.timezone,
									name: draft.timezone.split("_").join(" "),
								}
							: null
					}
					onSelect={(option) => change("timezone", option.id)}
					onClear={() => change("timezone", "")}
					disabled={saving}
				/>
				{error && (
					<p role="alert" className="text-meta text-danger">
						{error === "validation"
							? t("ui.settings.personal_profile.validation")
							: t("ui.settings.personal_profile.save_error")}
					</p>
				)}
				{discard ? (
					<div className="flex flex-col gap-2">
						<p className="text-body-sm text-ink">
							{t("ui.settings.personal_profile.discard")}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => {
									setDraft(baseline);
									setDiscard(false);
									setError(undefined);
								}}
							>
								{t("ui.settings.personal_profile.discard_action")}
							</Button>
							<Button
								type="button"
								variant="primary"
								onClick={() => setDiscard(false)}
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
							type="button"
							variant="secondary"
							size="sm"
							disabled={!dirty || saving}
							onClick={() => setDiscard(true)}
						>
							{t("ui.common.actions.cancel")}
						</Button>
					</div>
				)}
			</form>
			<output className="text-meta text-ink-muted">
				{notice === "saved"
					? t("ui.settings.personal_profile.saved")
					: notice === "photo_saved"
						? t("ui.settings.personal_profile.photo_saved")
						: notice === "photo_removed"
							? t("ui.settings.personal_profile.photo_removed")
							: null}
			</output>
			<Button
				variant="ghost"
				size="sm"
				className="w-fit"
				onClick={() =>
					openConsolePage("https://console.radienthq.com/dashboard/account")
				}
			>
				{t("ui.settings.personal_profile.manage")}
			</Button>
		</section>
	);
}
