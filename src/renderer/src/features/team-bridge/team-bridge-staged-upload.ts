import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import type { TeamBridgeAttachmentCapability } from "../../../../shared/team-bridge-contract";
import { prepareImageForUpload } from "./team-bridge-attachments-model";

/**
 * The shared composer's staged paths -> ids the hub will bind to a message.
 *
 * WHY THIS REPLACES THE CHIPS' OWN UPLOAD QUEUE. `useTeamBridgeAttachments` owns a
 * chip lifecycle (pending/held/uploading/error) because IT drew the chips: a
 * strip with retry and attach controls. The shared composer draws its own chips
 * from `conversation-input-store` and hands `MessageInput`'s send a list of local
 * PATHS - the same contract the mini view's quick send receives - and it exposes
 * no slot for a host-supplied strip. So the staged PATHS are the staging state
 * now, and the hub upload happens inside the send, which is the arm the previous
 * code already had for a draft with no conversation yet (`stageHeld`).
 *
 * That is why every send goes through here rather than only a fresh DM's: one
 * upload path for a just-created conversation and for an existing one keeps the
 * binding order (create -> upload -> post) identical in both, and `onSend` runs it
 * after the create by contract.
 *
 * BYTES, NOT REFERENCES: the hub's `attachment_ids` are staged blobs, and the
 * desktop daemon's own attachment store is a different one (that is what the
 * chat's `encodeAttachments` uses). Reading the path here is therefore the only
 * carriage that lands the picture in the bridge conversation.
 */

/** One staged path the send should have carried, and could not. */
export type StagedUploadFailure = {
	name: string;
	/** `read` = the file is gone or this window cannot read it; `unsupported` = a
	 * format, or none at all, the hub cannot take; `upload` = the hub refused. */
	reason: "read" | "unsupported" | "upload";
};

export type StagedUploadResult = {
	ids: string[];
	failures: StagedUploadFailure[];
};

const IMAGE_EXTENSIONS = [
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"heic",
	"bmp",
	"avif",
];

const fileName = (path: string): string => path.split("/").pop() || path;

const looksLikeImage = (path: string): boolean => {
	if (path.startsWith("data:")) return true;
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTENSIONS.includes(ext);
};

/**
 * Upload each staged path into `conversationId` and return the ids to bind.
 *
 * Refusals are collected rather than thrown so the caller can decide whether to
 * send with what landed. The chips are the composer's now, so a blanket throw
 * would report a failure for an upload that is still one retry from working.
 */
export async function uploadStagedImages(params: {
	paths: readonly string[];
	accountId: string;
	tenantId: string;
	conversationId: string;
	capability: TeamBridgeAttachmentCapability | null;
}): Promise<StagedUploadResult> {
	const { paths, accountId, tenantId, conversationId, capability } = params;
	const ids: string[] = [];
	const failures: StagedUploadFailure[] = [];
	if (paths.length === 0) return { ids, failures };
	if (!capability) {
		// The hub advertising no `attachments` block cannot take an id at all and
		// answers the field with 400; the caller has already refused the send for
		// this case, so nothing is uploaded here and nothing is reported twice.
		for (const path of paths)
			failures.push({ name: fileName(path), reason: "unsupported" });
		return { ids, failures };
	}
	for (const path of paths) {
		const name = fileName(path);
		if (!looksLikeImage(path)) {
			// The bridge carries pictures only; a document belongs to the daemon's
			// attachment store, which the chat's send uses and this hub does not.
			failures.push({ name, reason: "unsupported" });
			continue;
		}
		const read = await window.api?.readFile?.(path, "base64");
		if (!read?.success) {
			failures.push({ name, reason: "read" });
			continue;
		}
		let bytes: Uint8Array;
		try {
			const binary = atob(read.data);
			bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1)
				bytes[index] = binary.charCodeAt(index);
			// The hub accepts png/jpeg only; the model's prepare step sniffs,
			// converts and bounds to the wire's edge and the hub's byte ceiling.
			const prepared = await prepareImageForUpload(
				new Blob([bytes as BlobPart]),
				capability.max_bytes,
			);
			bytes = prepared.bytes;
		} catch {
			// `prepareImageForUpload` refuses with its own reason; the two it can
			// raise here are a format this platform cannot decode and a picture still
			// over the hub's ceiling after bounding.
			failures.push({ name, reason: "unsupported" });
			continue;
		}
		try {
			const attachment = await TeamBridgeApi.uploadAttachment(
				tenantId,
				conversationId,
				bytes,
				accountId,
			);
			ids.push(attachment.id);
		} catch {
			failures.push({ name, reason: "upload" });
		}
	}
	return { ids, failures };
}
