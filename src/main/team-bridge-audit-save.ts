import { t } from "../i18n/messages";
import type { DesktopOwnerAuditSaveResult } from "../shared/desktop-contract";
import type { DesktopMediaResponse } from "./desktop-media";
import { ownerAuditAttachmentTupleSchema } from "./desktop-media";
import { AuditSaveScopeChanged } from "./team-bridge-audit-save-file";

/** The chooser and writer exist only in main. A renderer can name a scoped
 * attachment, never a destination, suggested name, URL or opaque byte payload.
 * Choose first so a native dialog cannot hold private bytes across a login. */
export async function saveOwnerAuditAttachment(
	input: unknown,
	deps: {
		choose: () => Promise<string | null>;
		download: (tuple: unknown) => Promise<DesktopMediaResponse>;
		currentAccount: () => Promise<string | null>;
		live: () => boolean;
		write: (
			path: string,
			data: Uint8Array,
			canCommit: () => Promise<boolean>,
		) => Promise<void>;
	},
): Promise<DesktopOwnerAuditSaveResult> {
	const refuse = (status: number): DesktopOwnerAuditSaveResult => ({
		status,
		kind: "error",
		detail: t("ui.teamBridge.attachmentCard.unavailable"),
	});
	const parsed = ownerAuditAttachmentTupleSchema.safeParse(input);
	if (!parsed.success || !deps.live()) return refuse(422);
	try {
		const path = await deps.choose();
		if (!path)
			return {
				status: 200,
				kind: "json",
				body: { saved: false, cancelled: true },
			};
		if (!deps.live()) return refuse(409);
		const answer = await deps.download(parsed.data);
		if (answer.kind !== "bytes")
			return answer.kind === "error" ? answer : refuse(422);
		if (
			answer.status !== 200 ||
			answer.mimeType !== "application/octet-stream" ||
			answer.data.byteLength === 0 ||
			answer.data.byteLength > 25 * 1024 * 1024
		)
			return refuse(422);
		// Re-read the existing status identity AFTER the asynchronous byte request.
		// A stale account completion must not write a file or report success as B.
		if (
			!deps.live() ||
			(await deps.currentAccount()) !== parsed.data.expectedAccountId
		)
			return refuse(409);
		if (!deps.live()) return refuse(409);
		await deps.write(
			path,
			answer.data,
			async () =>
				deps.live() &&
				(await deps.currentAccount()) === parsed.data.expectedAccountId &&
				deps.live(),
		);
		return {
			status: 200,
			kind: "json",
			body: { saved: true, cancelled: false },
		};
	} catch (error) {
		if (error instanceof AuditSaveScopeChanged) return refuse(409);
		// Neither native paths nor exceptions (which may contain them) cross IPC.
		return refuse(503);
	}
}
