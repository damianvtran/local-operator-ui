/**
 * A file the user SENT, drawn in their own turn (attachment contract v1 §5).
 *
 * Deliberately not the composer's chip. The composer's card is a pending object -
 * it is dismissible, it sits on a sunken ground, and its row says so - while this
 * one is a historical fact: a flat row, no control over it, and a path line that
 * says where the file came from. A reader must never have to work out which of
 * the two they are looking at.
 *
 * EXISTENCE IS A CLAIM THIS SURFACE ONLY MAKES WHEN IT CAN (contract §5). A path
 * is probed on this machine; a missing one is stated with a recovery line that
 * names the saved copy and a next step a person can take now, so the row is never
 * a dead chip (design round 1, D2). A remote conversation's rows make NO claim,
 * and neither does a conversation whose placement the catalogue has not stated
 * yet: "(not remote)" is not "local" (agent review round 1, n3).
 *
 * THE PATH IS COPYABLE IN FULL even though the line is middle-truncated. When
 * the origin is gone and a retained copy can be materialised, the inline control
 * and the actions menu resolve the SAME real-named scratchpad file, never the
 * internal digest.bin store path.
 */

import type { TranscriptDocument } from "@features/chat/canonical/transcript-reducer";
import {
	AttachmentKindIcon,
	attachmentMetaLine,
} from "@features/chat/components/attachment-file-card";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Check, Copy } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCanvasPane } from "../utils/canvas-pane";
import { FileActionsMenu } from "./supplement-file-actions";
import { materialiseUserAttachment } from "./use-user-attachments";

/**
 * Shorten a path in the MIDDLE, keeping both ends readable.
 *
 * The head names the volume/user root and the tail names the file, and the two
 * are what a person checks a path against; the middle is the part they scroll
 * past. CSS cannot middle-truncate, so this is a character budget rather than a
 * measurement. The FULL value is carried by the copy control beside it - the
 * visible span's own text is the shortened string, so selecting it is not a
 * promise this component can keep (design round 1, D1).
 */
export function middleTruncate(path: string, max = 56): string {
	if (path.length <= max) return path;
	const keep = Math.floor((max - 1) / 2);
	return `${path.slice(0, keep)}…${path.slice(-keep)}`;
}

/**
 * The copy control for one path line, and its polite confirmation.
 *
 * Shared by the two rows that can own one - the origin path while it exists, and
 * the saved copy while the origin does not - so the affordance's size, focus
 * ring and feedback cannot drift between the two states.
 */
const PathCopyControl: FC<{
	label: string;
	copied: boolean;
	onCopy: () => void;
}> = ({ label, copied, onCopy }) => (
	<>
		<button
			type="button"
			onClick={onCopy}
			aria-label={label}
			title={label}
			className={cn(
				"shrink-0 rounded-sm p-0.5 text-ink-dim hover:text-ink",
				"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
			)}
		>
			{copied ? (
				<Check aria-hidden="true" className={cn("size-3.5")} />
			) : (
				<Copy aria-hidden="true" className={cn("size-3.5")} />
			)}
		</button>
		<output className={cn("sr-only")} aria-live="polite">
			{copied ? label : ""}
		</output>
	</>
);

/**
 * Whether this machine still has the file at `path`.
 *
 * `null` while unknown - a probe that has not answered, a renderer with no
 * bridge, or a REMOTE conversation where the question does not apply. Only a
 * probe that answered `exists: false` with no `error` reads as missing: a stat
 * fault is "cannot look", not "gone", and the two deserve different words
 * (`ProbedFile.error` states the discrimination).
 */
function useFileExistence(path: string | null, probe: boolean): boolean | null {
	const [exists, setExists] = useState<boolean | null>(null);
	useEffect(() => {
		if (!probe || !path) {
			setExists(null);
			return;
		}
		const bridge = window.api?.probeFiles;
		if (!bridge) return;
		let cancelled = false;
		void bridge([path]).then((rows) => {
			if (cancelled) return;
			const row = rows[0];
			if (!row || row.error) {
				setExists(null);
				return;
			}
			setExists(row.exists);
		});
		return () => {
			cancelled = true;
		};
	}, [path, probe]);
	return exists;
}

export const SentFileCard: FC<{
	document: TranscriptDocument;
	/**
	 * This conversation lives on another device, so this machine cannot say
	 * anything about the path: no probe, no existence claim (contract §5).
	 */
	remote?: boolean;
	/**
	 * Whether the catalogue has SAID where the conversation lives yet. Before the
	 * placement row (or fact) arrives, "not remote" means "unknown", not "local" -
	 * and probing a not-yet-known peer session would claim "Moved or deleted"
	 * about a file that exists on the peer (agent review round 1, n3). Unknown
	 * renders no claim, exactly as §5 asks.
	 */
	placementKnown?: boolean;
	/**
	 * A story's answer to the existence probe, when there is no `window.api` to
	 * ask. `undefined` (the live path) means "probe"; `null` means "probed, no
	 * answer"; the booleans are the two verdicts the card can paint. Kept an
	 * explicit seam rather than stubbing the preload bridge in a story, which
	 * would leak into every other story running in the same frame.
	 */
	existence?: boolean | null;
	/**
	 * The story seam for the RETAINED copy's existence, same contract as
	 * `existence`. Only asked once the origin is known missing: that is the one
	 * state where "is a saved copy still there?" changes what the card says.
	 */
	storedExistence?: boolean | null;
	/**
	 * The conversation the row belongs to, for copying the retained bytes out
	 * under the file's real name (`materialiseUserAttachment`) when the origin
	 * is gone. Absent (a story, a remote row), actions use the store path as is.
	 */
	sessionId?: string | null;
}> = ({
	document,
	remote = false,
	placementKnown = true,
	existence,
	storedExistence,
	sessionId = null,
}) => {
	useI18nLocale();
	const pane = useCanvasPane();
	const filename = document.filename || t("ui.chat.attachments.file_unnamed");
	const probed = useFileExistence(
		existence === undefined ? document.path : null,
		!remote && placementKnown,
	);
	const exists = existence === undefined ? probed : existence;
	const missing = exists === false;
	/*
	 * THE THIRD STATE (operator requirement 3): the origin is gone AND the
	 * store's retained copy is gone too - a pruned store, or a row from a
	 * machine whose store was not carried over. Asked only once the origin is
	 * known missing; until it answers the card keeps the "saved copy" line,
	 * which is the state the store's own contract makes the normal one.
	 */
	const storedProbe = useFileExistence(
		missing && storedExistence === undefined ? document.storedPath : null,
		!remote && placementKnown,
	);
	const storedExists =
		storedExistence === undefined ? storedProbe : storedExistence;
	const storedGone =
		missing && (!document.storedPath || storedExists === false);
	const [copied, setCopied] = useState(false);
	/*
	 * WHICH PATH THE COPY CONTROL IS FOR. The origin path is the right value while
	 * it exists; once it is gone, copying it would hand the person a dead string
	 * that looks like recovery (design round 1, D2). The store's path is the
	 * retained copy, so the missing arm copies THAT and re-labels the control; an
	 * older row without a store path renders no copy control at all rather than a
	 * control that copies nothing usable.
	 */
	const copyTarget = missing
		? storedExists === false
			? null
			: document.storedPath
		: document.path;
	const digest = document.attachment;
	const resolveActionPath = useMemo(
		() =>
			missing && !storedGone && digest && sessionId
				? () => materialiseUserAttachment(sessionId, digest)
				: undefined,
		[missing, storedGone, digest, sessionId],
	);
	/*
	 * WHAT THE COPY CONTROL CLAIMS TO COPY (agent review round 2, R2-4). With a
	 * materialiser the missing card copies a real-named file, which IS a file
	 * path. Without one (older backend, child view) the only value left is the
	 * store's own `<digest>.bin` - a path no app opens - so the control says it
	 * copies the SAVED COPY's path, never "the file path".
	 */
	const savedCopyOnly = missing && !resolveActionPath;
	const copyLabel = (done: boolean): string =>
		savedCopyOnly
			? t(
					done
						? "ui.chat.attachments.saved_path_copied"
						: "ui.chat.attachments.copy_saved_path",
				)
			: t(
					done
						? "ui.chat.attachments.path_copied"
						: "ui.chat.attachments.copy_path",
				);
	/*
	 * Copy the RECORD's path, never the rendered span: the span is truncated for
	 * layout, and a copy that reproduces the ellipsis is worse than no control
	 * because it looks like it worked. A rejected clipboard write leaves the
	 * icon unchanged rather than claiming a copy that did not happen.
	 */
	const copyPath = useCallback(async () => {
		if (!copyTarget && !resolveActionPath) return;
		try {
			const path = resolveActionPath ? await resolveActionPath() : copyTarget;
			if (!path) return;
			await navigator.clipboard.writeText(path);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	}, [copyTarget, resolveActionPath]);
	/*
	 * THE HOVER ACTIONS: the shared `FileActionsMenu`, never a fork. Which path
	 * they act on follows the same truth the card paints: the origin while it is
	 * there; the retained copy - copied out under the file's own name, because a
	 * `<digest>.bin` opens in no app - once it is not; and once both are gone,
	 * only "Copy file path" (the record of where it was). A remote row makes no
	 * claim about this disk and offers nothing. Absolutely positioned inside a
	 * reserved end padding, so revealing it moves no text.
	 */
	const actionPath =
		missing && !storedGone ? document.storedPath : document.path;
	/*
	 * The menu's "Copy file path" would hand over the `<digest>.bin` when no
	 * materialiser can name the retained copy, so the missing-with-copy card
	 * keeps only its labelled inline control there (R2-4).
	 */
	const showActions =
		!remote &&
		placementKnown &&
		Boolean(actionPath) &&
		!(savedCopyOnly && !storedGone);
	return (
		<div
			className={cn(
				"group relative flex max-w-[32rem] items-start gap-2.5 py-1",
				showActions && "pe-7",
			)}
			data-document-id={document.id}
		>
			{showActions && actionPath && (
				<div
					className={cn(
						"absolute top-0.5 end-0 has-[[aria-expanded=true]]:[&_button]:opacity-100",
					)}
				>
					<FileActionsMenu
						actionPath={actionPath}
						label={filename}
						pane={pane}
						resolveActionPath={resolveActionPath}
						missing={storedGone}
					/>
				</div>
			)}
			<AttachmentKindIcon
				name={filename}
				mimeType={document.mimeType}
				className={cn("mt-0.5 size-4.5 shrink-0 text-ink-muted")}
			/>
			<div className={cn("flex min-w-0 flex-col gap-0.5")}>
				<span className={cn("break-all text-body-sm text-ink")}>
					{filename}
				</span>
				<span className={cn("text-ink-muted text-meta")}>
					{attachmentMetaLine(filename, document.mimeType, document.bytes)}
				</span>
				{document.path && (
					<span className={cn("flex min-w-0 items-center gap-1")}>
						<span
							className={cn(
								// Machine voice: a path is a string the OS will be handed, so it is
								// monospace and selectable rather than prose. In the missing state it is
								// the record of where the file WAS: dimmed, and it owns no control.
								"select-all truncate font-mono text-meta",
								missing ? "text-ink-dim" : "text-ink-muted",
							)}
							title={document.path}
						>
							{middleTruncate(document.path)}
						</span>
						{/*
						 * THE FULL PATH IS WHAT THE COPY CONTROL COPIES. The visible span is
						 * middle-truncated in its TEXT, so selecting it would copy the ellipsized
						 * string - the promise "full path copyable" would be false exactly where it
						 * matters, on a long path (design round 1, D1). A button carries the
						 * untruncated value from the record.
						 */}
						{!missing && copyTarget && (
							<PathCopyControl
								label={copyLabel(copied)}
								copied={copied}
								onCopy={copyPath}
							/>
						)}
					</span>
				)}
				{missing && (
					/*
					 * TWO BLOCKS, NOT ONE SENTENCE JOINED BY ". ": a full stop plus a space is
					 * English punctuation, and zh-CN/hi/ur carry their own. The verdict and the
					 * line below it are separate block-level spans so no locale inherits this
					 * one's separator (agent review round 1, m4).
					 */
					<span
						className={cn("flex flex-col gap-0.5 text-ink-muted text-meta")}
					>
						<span className={cn("font-medium text-danger")}>
							{t("ui.chat.attachments.file_missing")}
						</span>
						{storedGone && (
							/*
							 * NO STORE PATH, NO PROMISE. Saying a saved copy exists when the row
							 * cannot name or copy one is the dead end design round 2 retained D2
							 * for; the truthful line stops at where the file is not.
							 */
							<span>
								{t(
									document.storedPath
										? "ui.chat.attachments.file_and_copy_missing"
										: "ui.chat.attachments.file_missing_recovery",
								)}
							</span>
						)}
					</span>
				)}
				{missing && document.storedPath && !storedGone && (
					/*
					 * THE SAVED COPY'S OWN ROW. It is the action the missing state owes the
					 * reader: a labelled line naming the retained copy and its full path, with
					 * the copy control beside it. Borderless and inline - a row, not a card
					 * (design round 2, D2).
					 */
					<span className={cn("flex min-w-0 items-center gap-1 text-meta")}>
						<span
							className={cn("shrink-0 text-ink-muted")}
							title={
								document.attachment
									? t("ui.chat.attachments.file_retained", {
											digest: document.attachment,
										})
									: undefined
							}
						>
							{t("ui.chat.attachments.saved_copy_label")}
						</span>
						<span
							className={cn(
								"select-all truncate font-mono text-ink-muted text-meta",
							)}
							title={document.storedPath}
						>
							{middleTruncate(document.storedPath, 40)}
						</span>
						<PathCopyControl
							label={copyLabel(copied)}
							copied={copied}
							onCopy={copyPath}
						/>
					</span>
				)}
			</div>
		</div>
	);
};
