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
 * is probed on this machine; a missing one is stated with the retained copy named,
 * so the row is never a dead chip. A remote conversation's rows make NO claim: the
 * file never lived here, and "moved or deleted" would be false about a machine
 * this app cannot look at.
 */

import type { TranscriptDocument } from "@features/chat/canonical/transcript-reducer";
import {
	AttachmentKindIcon,
	attachmentMetaLine,
} from "@features/chat/components/attachment-file-card";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { useEffect, useState } from "react";

/**
 * Shorten a path in the MIDDLE, keeping both ends readable.
 *
 * The head names the volume/user root and the tail names the file, and the two
 * are what a person checks a path against; the middle is the part they scroll
 * past. CSS cannot middle-truncate, so this is a character budget rather than a
 * measurement - the full path stays in `title` and is selectable, which is the
 * copyable half of the contract's "middle-truncated, full path copyable".
 */
export function middleTruncate(path: string, max = 72): string {
	if (path.length <= max) return path;
	const keep = Math.floor((max - 1) / 2);
	return `${path.slice(0, keep)}…${path.slice(-keep)}`;
}

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
	 * A story's answer to the existence probe, when there is no `window.api` to
	 * ask. `undefined` (the live path) means "probe"; `null` means "probed, no
	 * answer"; the booleans are the two verdicts the card can paint. Kept an
	 * explicit seam rather than stubbing the preload bridge in a story, which
	 * would leak into every other story running in the same frame.
	 */
	existence?: boolean | null;
}> = ({ document, remote = false, existence }) => {
	useI18nLocale();
	const filename = document.filename || t("ui.chat.attachments.file_unnamed");
	const probed = useFileExistence(
		existence === undefined ? document.path : null,
		!remote,
	);
	const exists = existence === undefined ? probed : existence;
	const missing = exists === false;
	return (
		<div
			className={cn("flex max-w-[32rem] items-start gap-2.5 py-1")}
			data-document-id={document.id}
		>
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
					<span
						className={cn(
							// Machine voice: a path is a string the OS will be handed, so it is
							// monospace and selectable rather than prose.
							"select-all truncate font-mono text-ink-muted text-meta",
						)}
						title={document.path}
					>
						{middleTruncate(document.path)}
					</span>
				)}
				{missing && (
					<span className={cn("text-ink-muted text-meta")}>
						<span className={cn("font-medium text-danger")}>
							{t("ui.chat.attachments.file_missing")}
						</span>
						{". "}
						{document.attachment
							? t("ui.chat.attachments.file_retained", {
									digest: document.attachment,
								})
							: filename}
					</span>
				)}
			</div>
		</div>
	);
};
