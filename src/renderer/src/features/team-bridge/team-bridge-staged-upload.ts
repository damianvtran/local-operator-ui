import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import type { TeamBridgeAttachmentCapability } from "../../../../shared/team-bridge-contract";
import { getFileName } from "../chat/utils/get-file-name";
import { prepareImageForUpload } from "./team-bridge-attachments-model";

/**
 * The shared composer's staged values -> ids the hub will bind to a message.
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
 * chat's `encodeAttachments` uses). Reading the staged value here is therefore the
 * only carriage that lands the picture in the bridge conversation — and in TWO
 * shapes, which is what `StagedSource` below exists to keep straight: a filesystem
 * path from the picker or a drop, and a `data:` URL from paste.
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

/**
 * WHAT A STAGED VALUE IS, decided once, for every consumer.
 *
 * WHY THIS TYPE EXISTS. The store has one field (`path`, see
 * `conversation-input-store`) and TWO producers put different things in it: the
 * picker and a Finder drop stage a FILESYSTEM PATH, while the shared composer's
 * paste handler stages a `data:image/png;base64,...` DATA URL - it reads the
 * clipboard's `File` with `FileReader.readAsDataURL`, and the store has no second
 * field to put the result in. Reading the union as one thing is what broke paste
 * (2026-11-05): `uploadStagedImages` handed a data URL to
 * `window.api.readFile`, a MAIN-process filesystem read, which cannot open one;
 * the failure it built was then named by splitting that value on "/", and base64
 * contains "/", so the operator saw the base64 tail (`AAAAABJRU5ErkJggg==`) above
 * "This image couldn't be read".
 *
 * So the distinction is typed HERE rather than at that one call site: a consumer
 * must switch on `kind`, and the next thing that reads a staged value cannot
 * reintroduce the defect by assuming a path. An unknown value is not guessed - the
 * send refuses it with `unsupported` and a neutral name.
 */
export type StagedSource =
	| { kind: "path"; path: string }
	| { kind: "dataUrl"; dataUrl: string; mime: string };

/** `data:<mime>[;base64],<payload>` - the spelling `readAsDataURL` produces. */
const DATA_URL = /^data:([^;,]+)(;base64)?,([\s\S]*)$/;

/**
 * The value's kind, or `null` when it is not a staged value this client reads.
 *
 * `null` is deliberately not "a path with an odd name": a blank or malformed
 * value would otherwise reach the filesystem read and come back as a "damaged
 * image" sentence for something that was never an image.
 */
export function stagedSource(staged: string): StagedSource | null {
	if (staged.startsWith("data:")) {
		const match = DATA_URL.exec(staged);
		if (!match) return null;
		return { kind: "dataUrl", dataUrl: staged, mime: match[1] };
	}
	return staged.trim() === "" ? null : { kind: "path", path: staged };
}

/**
 * The bytes behind a staged source.
 *
 * A data URL is decoded HERE, in the renderer, from its own payload: the bytes
 * are already in this process (the paste handler put them there), so going back
 * through the main process would be a round trip to read something we hold. The
 * result is the same `Uint8Array`-into-`Blob` shape the filesystem branch
 * produces, which is what keeps ONE prepare path for both forms.
 *
 * `null` is "this client cannot produce the bytes": a data URL whose payload is
 * not base64 (nothing in this app writes one, and guessing at an encoding is how
 * a wrong picture gets sent), or an unreadable file.
 */
async function readStagedBytes(
	source: StagedSource,
): Promise<Uint8Array | null> {
	if (source.kind === "path") {
		const read = await window.api?.readFile?.(source.path, "base64");
		if (!read?.success) return null;
		try {
			return fromBase64(read.data);
		} catch {
			return null;
		}
	}
	const match = DATA_URL.exec(source.dataUrl);
	if (!match || !match[2]) return null;
	try {
		return fromBase64(match[3]);
	} catch {
		return null;
	}
}

/** Base64 -> bytes. Throws on a payload `atob` refuses, which the caller reads as
 * an unreadable source rather than as a picture. */
function fromBase64(data: string): Uint8Array {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1)
		bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/**
 * The name a failure row shows.
 *
 * NEVER DERIVED FROM THE PAYLOAD. `getFileName` is the app's one naming helper
 * and already answers `"Pasted image"` for a `data:image/...` value, so the bridge
 * names a pasted picture the way the chat does. Its literals are pre-existing
 * unkeyed English (the i18n policy's known backlog, see `docs/I18N.md`); this
 * change adds no copy, keyed or otherwise.
 */
const stagedName = (staged: string): string => getFileName(staged);

const looksLikeImage = (source: StagedSource): boolean => {
	if (source.kind === "dataUrl") return source.mime.startsWith("image/");
	const ext = source.path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTENSIONS.includes(ext);
};

/**
 * Upload each staged value into `conversationId` and return the ids to bind.
 *
 * A staged value is a PATH or a DATA URL (`StagedSource`), and both are read for
 * their bytes; the send binds the ids the hub answered, so what reaches the wire
 * is the picture and never the value it was staged as.
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
		for (const staged of paths)
			failures.push({ name: stagedName(staged), reason: "unsupported" });
		return { ids, failures };
	}
	for (const staged of paths) {
		const name = stagedName(staged);
		const source = stagedSource(staged);
		if (source === null || !looksLikeImage(source)) {
			// The bridge carries pictures only; a document belongs to the daemon's
			// attachment store, which the chat's send uses and this hub does not. An
			// unreadable value (`stagedSource` refused it) is reported the same way
			// rather than being handed to a read it was never a path for.
			failures.push({ name, reason: "unsupported" });
			continue;
		}
		const read = await readStagedBytes(source);
		if (read === null) {
			failures.push({ name, reason: "read" });
			continue;
		}
		let bytes: Uint8Array;
		try {
			// The hub accepts png/jpeg only; the model's prepare step sniffs,
			// converts and bounds to the wire's edge and the hub's byte ceiling. The
			// SAME step runs for a data URL and for a filesystem read: one prepare
			// path, so the two forms cannot drift into different bounding rules.
			const prepared = await prepareImageForUpload(
				new Blob([read as BlobPart]),
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
