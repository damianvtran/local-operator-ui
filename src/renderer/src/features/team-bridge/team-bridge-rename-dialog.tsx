import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC, ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { channelSlug } from "./team-bridge-create-dialog";

/*
 * RENAME A CHANNEL OR GROUP (operator 2026-11-20: "There doesn't seem to be a
 * way to rename a channel in team bridge").
 *
 * ONE NAME RULE WITH CREATE. A channel name is normalised the way the create
 * form normalises it (`channelSlug`: lower case, spaces to hyphens, no leading
 * #), so renaming cannot produce a name the create form would never have sent.
 * A group's name is free text (groups show a person-style title, not a `#`
 * slug), so it is only trimmed and its whitespace runs collapsed.
 *
 * THE SERVER'S RULES, MIRRORED (agent-server rename contract, 2026-11-20).
 * Create only trims, so rename has its own server-side sanitiser: trim,
 * collapse space runs, at most 64 CODE POINTS, and refuse blank, control,
 * invisible and non-U+0020 space characters (400 `invalid_request`,
 * `details.rule`). The dialog checks the two it can state before sending
 * (empty, too long) and maps every rule the server can return to a sentence;
 * the server stays the authority. Length counts code points (`[...s]`), not
 * UTF-16 units, so an emoji counts once here as it does there.
 *
 * NOT OPTIMISTIC IN THE DIALOG. The rail is updated optimistically by the
 * mutation, but the dialog stays open on the promise: the refusals worth
 * explaining (a taken name, lost authority, an archive that landed meanwhile)
 * are best explained where the name was typed, with the text still there to
 * edit. Escape and the corner button stay usable while saving: closing does not
 * cancel the write, and the rail already shows its result.
 */

/** Why a rename was refused, as the dialog words it. */
export type TeamBridgeRenameFailure =
	| { kind: "taken"; name: string }
	| { kind: "empty" }
	| { kind: "too_long" }
	| { kind: "characters" }
	| { kind: "invalid" }
	| { kind: "forbidden" }
	| { kind: "archived" }
	| { kind: "failed" };

/**
 * Map the hub's refusal (relayed by core; `DesktopControlError.code`/`status`,
 * the body intact as `detail`) to one sentence. `attempted` names the taken
 * room when the server's `details.name` is absent.
 */
export function renameFailure(
	error: unknown,
	attempted: string,
): TeamBridgeRenameFailure {
	const candidate = error as {
		status?: unknown;
		code?: unknown;
		detail?: { details?: { name?: unknown; rule?: unknown } };
	} | null;
	const status =
		typeof candidate?.status === "number" ? candidate.status : null;
	const code = typeof candidate?.code === "string" ? candidate.code : null;
	if (code === "conversation_name_taken") {
		const served = candidate?.detail?.details?.name;
		return {
			kind: "taken",
			name: typeof served === "string" && served ? served : attempted,
		};
	}
	if (code === "conversation_archived") return { kind: "archived" };
	if (status === 403 || code === "forbidden") return { kind: "forbidden" };
	if (status === 400 || code === "invalid_request") {
		const rule = candidate?.detail?.details?.rule;
		if (rule === "empty") return { kind: "empty" };
		if (rule === "too_long") return { kind: "too_long" };
		if (
			rule === "control_character" ||
			rule === "invisible_character" ||
			rule === "unsupported_space" ||
			rule === "invalid_utf8"
		)
			return { kind: "characters" };
		return { kind: "invalid" };
	}
	return { kind: "failed" };
}

const WHITESPACE_RUN = /\s+/g;

/** The server's bound, in code points (agent-server rename sanitiser). */
export const TEAM_BRIDGE_RENAME_MAX = 64;

/** Code points, as the server counts them. */
export function renameNameLength(name: string): number {
	return [...name].length;
}

/** The name exactly as it would be sent for this kind. */
export function normalizedRenameName(
	kind: "channel" | "group",
	typed: string,
): string {
	return kind === "channel"
		? channelSlug(typed)
		: typed.trim().replace(WHITESPACE_RUN, " ");
}

/*
 * A placeholder the formatted sentence cannot otherwise contain (Private Use
 * Area), so the interpolated name can be found again after ICU formatting.
 */
const NAME_SLOT = "\uE000";

/**
 * The taken-name sentence with `#name` (or `name`) isolated in a `<bdi>`
 * (design review round 1, D2). In an RTL locale the neutral `#` otherwise takes
 * the paragraph direction and renders on the far side of a Latin slug
 * (`launch-crew#` in Urdu). Done at render so the audited catalogues stay
 * byte-identical: the sentence is formatted with a placeholder name, split on
 * it, and the real name (with the catalogue's own `#`, when it has one) is put
 * back inside the isolate.
 */
export function takenSentence(
	kind: "channel" | "group",
	name: string,
): ReactNode {
	const formatted = t("ui.teamBridge.rename.error.taken", {
		kind,
		name: NAME_SLOT,
	});
	const at = formatted.indexOf(NAME_SLOT);
	if (at < 0) return formatted;
	const hash = formatted[at - 1] === "#" ? "#" : "";
	return (
		<>
			{formatted.slice(0, at - hash.length)}
			<bdi data-rename-name>
				{hash}
				{name}
			</bdi>
			{formatted.slice(at + NAME_SLOT.length)}
		</>
	);
}

/** Refusals no other name can fix: the dialog leaves only Cancel (D3). */
export function isTerminalRenameFailure(
	failure: TeamBridgeRenameFailure | null,
): boolean {
	return failure?.kind === "archived" || failure?.kind === "forbidden";
}

function failureText(
	failure: TeamBridgeRenameFailure,
	kind: "channel" | "group",
): ReactNode {
	switch (failure.kind) {
		case "taken":
			return takenSentence(kind, failure.name);
		case "empty":
			return t("ui.teamBridge.rename.error.empty");
		case "too_long":
			return t("ui.teamBridge.rename.error.too_long", {
				max: TEAM_BRIDGE_RENAME_MAX,
			});
		case "characters":
			return t("ui.teamBridge.rename.error.characters");
		case "invalid":
			return t("ui.teamBridge.rename.error.invalid");
		case "forbidden":
			return t("ui.teamBridge.rename.error.forbidden", { kind });
		case "archived":
			return t("ui.teamBridge.rename.error.archived", { kind });
		case "failed":
			return t("ui.teamBridge.rename.error.failed");
	}
}

export const TeamBridgeRenameDialog: FC<{
	open: boolean;
	kind: "channel" | "group";
	/** The current stored name ("" for a group that never had one). */
	currentName: string;
	pending?: boolean;
	error?: TeamBridgeRenameFailure | null;
	onSave: (name: string) => void;
	onClose: () => void;
}> = ({
	open,
	kind,
	currentName,
	pending = false,
	error = null,
	onSave,
	onClose,
}) => {
	useI18nLocale();
	const fieldId = useId();
	const errorId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [typed, setTyped] = useState(currentName);
	/*
	 * SEED ON THE OPEN TRANSITION ONLY (review round 1, R1/U1/Q1). Every open
	 * starts from the stored name, so a cancelled edit does not return. But
	 * `currentName` is the cached row, and the cache changes WHILE the dialog
	 * is open: the optimistic write sets it to the new name and a refusal rolls
	 * it back (a list refetch can also land). Re-seeding on those changes wiped
	 * the person's text exactly when a refusal asked them to edit it. This is
	 * React's "adjust state while rendering" pattern rather than an effect, so
	 * the seeded value is on screen in the same frame the dialog opens.
	 */
	const [seededOpen, setSeededOpen] = useState(open);
	if (open !== seededOpen) {
		setSeededOpen(open);
		if (open) setTyped(currentName);
	}
	/*
	 * The server refusal the person has since edited past (review round 1,
	 * U2): it stops showing, and the field stops being aria-invalid, on the
	 * first keystroke. The page hands a NEW object for every refusal, so the
	 * next refusal shows again.
	 */
	const [editedPast, setEditedPast] = useState<TeamBridgeRenameFailure | null>(
		null,
	);
	/* Archived or forbidden: no other name can succeed, so the field and Save
	   are disabled and only Cancel is left (design round 1, D3). */
	const terminal = isTerminalRenameFailure(error);
	const next = normalizedRenameName(kind, typed);
	const unchanged = next === normalizedRenameName(kind, currentName);
	/* Too long is SAID, not only disabled: a Save that greys out with no reason
	   while the person is still typing reads as a bug. Empty only disables. */
	const tooLong = renameNameLength(next) > TEAM_BRIDGE_RENAME_MAX;
	const shown: TeamBridgeRenameFailure | null = tooLong
		? { kind: "too_long" }
		: error && error !== editedPast
			? error
			: null;
	const canSave =
		next.length > 0 && !tooLong && !unchanged && !pending && !terminal;
	const submit = () => {
		if (canSave) onSave(next);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<DialogContent
				className="gap-4"
				/* Prefilled AND selected, so typing replaces the old name outright
				   (the common case) while an arrow key still edits it. */
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					inputRef.current?.focus();
					inputRef.current?.select();
				}}
			>
				<DialogTitle>{t("ui.teamBridge.rename.title", { kind })}</DialogTitle>
				<DialogDescription className="text-[13px] text-ink-muted">
					{t("ui.teamBridge.rename.description", { kind })}
				</DialogDescription>
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<label
						htmlFor={fieldId}
						className="flex flex-col gap-1 text-[13px] text-ink-muted"
					>
						{t("ui.teamBridge.rename.name")}
						<Input
							ref={inputRef}
							id={fieldId}
							value={typed}
							onChange={(event) => {
								setTyped(event.target.value);
								if (error) setEditedPast(error);
							}}
							/* Locked while saving (D4) so the field cannot drift from the
							   name the server is about to return. */
							readOnly={pending}
							disabled={terminal}
							aria-invalid={shown ? true : undefined}
							aria-describedby={shown ? errorId : undefined}
							data-rename-field
						/>
					</label>
					{shown && (
						<p
							id={errorId}
							role="alert"
							className="text-[13px] text-danger"
							data-rename-error={shown.kind}
						>
							{failureText(shown, kind)}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={onClose}>
							{t("ui.teamBridge.rename.cancel")}
						</Button>
						<Button
							type="submit"
							variant="primary"
							disabled={!canSave}
							data-rename-save
						>
							{pending
								? t("ui.teamBridge.rename.saving")
								: t("ui.teamBridge.rename.save")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

/** A draft belongs to one captured owner/epoch + tenant + conversation. The page
 * retains pending/failed drafts on dismissal; normal cancellation discards it.
 * Baselines are captured on open and never re-seeded by list refetches.
 */
export type TeamBridgeEditDraft = {
	baselineName: string;
	baselineTopic: string;
	name: string;
	topic: string;
	pending: boolean;
	error: TeamBridgeEditFailure | null;
};
/** The journal outlives a view remount, not its owner. Subscription is needed
 * because a dismissed request may settle after a different view has mounted.
 */
export class TeamBridgeEditDraftJournal extends Map<
	string,
	TeamBridgeEditDraft
> {
	private version = 0;
	private listeners = new Set<() => void>();
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	snapshot = () => this.version;
	private publish() {
		this.version += 1;
		for (const listener of this.listeners) listener();
	}
	override set(key: string, value: TeamBridgeEditDraft): this {
		super.set(key, value);
		this.publish();
		return this;
	}
	override delete(key: string): boolean {
		const deleted = super.delete(key);
		if (deleted) this.publish();
		return deleted;
	}
}

export type TeamBridgeEditFailure =
	| TeamBridgeRenameFailure
	| {
			kind: "topic_too_long" | "topic_characters";
	  };
export const TEAM_BRIDGE_TOPIC_MAX = 512;
function containsTopicControl(topic: string): boolean {
	return [...topic].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return (
			(code < 32 && code !== 9 && code !== 10 && code !== 13) ||
			(code >= 127 && code <= 159)
		);
	});
}

/** Never slug an untouched legacy name just because the editor opened. */
export function metadataPatch(
	kind: "channel" | "group",
	draft: TeamBridgeEditDraft,
): { name?: string; topic?: string } {
	const patch: { name?: string; topic?: string } = {};
	if (draft.name !== draft.baselineName) {
		const next = normalizedRenameName(kind, draft.name);
		if (next !== draft.baselineName) patch.name = next;
	}
	if (draft.topic !== draft.baselineTopic) {
		const next = draft.topic.trim();
		if (next !== draft.baselineTopic) patch.topic = next;
	}
	return patch;
}

/** Validate only changed fields: an unchanged grandfathered value may be valid
 * to retain even though the new-update bound would reject it as a new value.
 */
export function metadataValidation(patch: {
	name?: string;
	topic?: string;
}): TeamBridgeEditFailure | null {
	if (patch.name !== undefined) {
		if (!patch.name) return { kind: "empty" };
		if ([...patch.name].length > TEAM_BRIDGE_RENAME_MAX)
			return { kind: "too_long" };
	}
	if (patch.topic !== undefined) {
		if ([...patch.topic].length > TEAM_BRIDGE_TOPIC_MAX)
			return { kind: "topic_too_long" };
		if (containsTopicControl(patch.topic)) return { kind: "topic_characters" };
	}
	return null;
}

export function editFailure(
	error: unknown,
	attempted: string,
): TeamBridgeEditFailure {
	const details = (
		error as { detail?: { details?: { field?: string; rule?: string } } } | null
	)?.detail?.details;
	if (details?.field === "topic") {
		if (details.rule === "too_long") return { kind: "topic_too_long" };
		if (details.rule === "control_character")
			return { kind: "topic_characters" };
		return { kind: "invalid" };
	}
	return renameFailure(error, attempted);
}

function editFailureText(
	failure: TeamBridgeEditFailure,
	kind: "channel" | "group",
): ReactNode {
	switch (failure.kind) {
		case "topic_too_long":
			return t("ui.teamBridge.edit.error.topic_too_long", {
				max: TEAM_BRIDGE_TOPIC_MAX,
			});
		case "topic_characters":
			return t("ui.teamBridge.edit.error.topic_characters");
		case "invalid":
			return t("ui.teamBridge.edit.error.invalid");
		case "forbidden":
			return t("ui.teamBridge.edit.error.forbidden");
		case "archived":
			return t("ui.teamBridge.edit.error.archived");
		case "failed":
			return t("ui.teamBridge.edit.error.failed");
		default:
			return failureText(failure, kind);
	}
}

/** The existing rename surface expanded, not a settings/membership screen.
 * Drafts are controlled by the owner-scoped journal so dismissing an in-flight
 * request cannot lose its retry state, or let its completion close another room.
 */
export const TeamBridgeEditDialog: FC<{
	kind: "channel" | "group";
	draft: TeamBridgeEditDraft;
	onChange: (draft: TeamBridgeEditDraft) => void;
	onSave: (patch: { name?: string; topic?: string }) => void;
	onClose: () => void;
}> = ({ kind, draft, onChange, onSave, onClose }) => {
	useI18nLocale();
	const nameId = useId();
	const topicId = useId();
	const errorId = useId();
	const patch = metadataPatch(kind, draft);
	const shown = metadataValidation(patch) ?? draft.error;
	const terminal =
		draft.error?.kind === "archived" || draft.error?.kind === "forbidden";
	const canSave =
		Object.keys(patch).length > 0 &&
		!metadataValidation(patch) &&
		!draft.pending &&
		!terminal;
	const topicError =
		shown?.kind === "topic_too_long" || shown?.kind === "topic_characters";
	const change = (field: "name" | "topic", value: string) =>
		onChange({
			...draft,
			[field]: value,
			error: terminal ? draft.error : null,
		});
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="gap-4">
				<DialogTitle>{t("ui.teamBridge.edit.title", { kind })}</DialogTitle>
				<DialogDescription className="text-[13px] text-ink-muted">
					{t("ui.teamBridge.edit.description")}
				</DialogDescription>
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (canSave) onSave(patch);
					}}
				>
					<label
						htmlFor={nameId}
						className="flex flex-col gap-1 text-[13px] text-ink-muted"
					>
						{t("ui.teamBridge.rename.name")}
						<Input
							id={nameId}
							value={draft.name}
							onChange={(event) => change("name", event.target.value)}
							readOnly={draft.pending}
							disabled={terminal}
							aria-invalid={shown && !topicError ? true : undefined}
							aria-describedby={shown && !topicError ? errorId : undefined}
							data-edit-name
						/>
					</label>
					<label
						htmlFor={topicId}
						className="flex flex-col gap-1 text-[13px] text-ink-muted"
					>
						{t("ui.teamBridge.edit.topic")}
						<Textarea
							id={topicId}
							rows={4}
							value={draft.topic}
							onChange={(event) => change("topic", event.target.value)}
							readOnly={draft.pending}
							disabled={terminal}
							aria-invalid={topicError ? true : undefined}
							aria-describedby={topicError ? errorId : undefined}
							data-edit-topic
						/>
					</label>
					{shown && (
						<p
							id={errorId}
							role="alert"
							className="text-[13px] text-danger"
							data-edit-error={shown.kind}
						>
							{editFailureText(shown, kind)}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={onClose}>
							{t("ui.teamBridge.rename.cancel")}
						</Button>
						<Button type="submit" variant="tonal" disabled={!canSave}>
							{t(
								draft.pending
									? "ui.teamBridge.rename.saving"
									: "ui.teamBridge.rename.save",
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
