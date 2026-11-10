import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { t } from "@shared/i18n";
import type { TeamBridgeAttachmentCapability } from "../../../../shared/team-bridge-contract";
import { getFileName } from "../chat/utils/get-file-name";
import {
	AttachmentPrepareError,
	prepareImageForUpload,
	sniffImage,
} from "./team-bridge-attachments-model";

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
 * in THIS module must switch on `kind`. The store field stays a plain `string`
 * (`conversation-input-store` has one column and two producers), so the type is
 * this module's boundary rather than the store's - anything outside that reads the
 * field still sees text, which is why the narrowing is stated here and not claimed
 * repository-wide.
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
 * The bytes behind a staged source, or WHY they could not be produced.
 *
 * A data URL is decoded HERE, in the renderer, from its own payload: the bytes
 * are already in this process (the paste handler put them there), so going back
 * through the main process would be a round trip to read something we hold. The
 * result is the same `Uint8Array`-into-`Blob` shape the filesystem branch
 * produces, which is what keeps ONE prepare path for both forms.
 *
 * THE REFUSAL IS DISCRIMINATED, deliberately: a payload that is not base64 (a
 * percent-encoded data URL, which nothing in this app writes) is a FORMAT this
 * client cannot carry (`unsupported`), while a file that cannot be read or base64
 * that will not decode is a source that could not be READ. Collapsing the two into
 * one reason is how "this file is damaged" gets said about a value that was never an
 * image - the same class of untruth as naming a row after its own payload.
 */
type StagedBytes =
	| { ok: true; bytes: Uint8Array }
	| { ok: false; why: "unsupported" | "read" };

async function readStagedBytes(source: StagedSource): Promise<StagedBytes> {
	if (source.kind === "path") {
		const read = await window.api?.readFile?.(source.path, "base64");
		if (!read?.success) return { ok: false, why: "read" };
		try {
			return { ok: true, bytes: fromBase64(read.data) };
		} catch {
			return { ok: false, why: "read" };
		}
	}
	const match = DATA_URL.exec(source.dataUrl);
	if (!match) return { ok: false, why: "unsupported" };
	/* No `;base64` marker: a percent-encoded data URL, a form this app never writes. */
	if (!match[2]) return { ok: false, why: "unsupported" };
	try {
		return { ok: true, bytes: fromBase64(match[3]) };
	} catch {
		/* `;base64` was declared and `atob` refused the payload: a corrupt source. */
		return { ok: false, why: "read" };
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

/** A name is a FILE NAME, never a payload: these rows are one line tall. */
const NAME_MAX = 120;

/**
 * The name a failure row shows, and WHICH image it is - when that cannot be guessed.
 *
 * NEVER DERIVED FROM THE PAYLOAD. `getFileName` is the app's one naming helper and
 * answers the localized fallback (`ui.chat.composer_media.pasted_image`) for an
 * unnamed `data:image/...` value, so the bridge names a pasted picture the way the
 * chat does. Valid decoded names remain user data, not translated copy.
 *
 * THE POSITION IS KEYED COPY, and only appears when there is more than one image:
 * `ui.teamBridge.attachments.position` ("Image {index} of {count}") exists in every
 * product locale and is what the chip strip already labels each thumbnail with. A
 * lone image needs no position - "Pasted image · Image 1 of 1" is noise about a
 * choice nobody made (QA NIT-1 / design D1) - so the suffix is added for `count > 1`
 * only. Its numbers come from the STAGED LIST (this value's index and the list's
 * length), never from the value itself.
 *
 * THE LENGTH GUARD IS SEPARATE FROM ALL OF THAT: a filename is truncated so a long
 * path cannot put a paragraph in a one-line row, whatever the string turns out to be.
 */
function stagedName(staged: string, index: number, count: number): string {
	const base = staged.startsWith("data:")
		? getFileName(staged)
		: truncate(getFileName(staged));
	if (count <= 1) return base;
	return `${base} · ${t("ui.teamBridge.attachments.position", {
		index: String(index + 1),
		count: String(count),
	})}`;
}

const truncate = (name: string): string =>
	name.length <= NAME_MAX ? name : `${name.slice(0, NAME_MAX - 1)}…`;

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
		for (let index = 0; index < paths.length; index += 1)
			failures.push({
				name: stagedName(paths[index], index, paths.length),
				reason: "unsupported",
			});
		return { ids, failures };
	}
	const count = paths.length;
	for (const [index, staged] of paths.entries()) {
		const name = stagedName(staged, index, count);
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
		if (!read.ok) {
			failures.push({ name, reason: read.why });
			continue;
		}
		/*
		 * THE FORMAT IS SNIFFED FROM THE BYTES BEFORE ANY DECODE IS ATTEMPTED, so the
		 * refusal can say which of two different things went wrong. `null` is "this is
		 * not a picture at all"; a picture the platform cannot DECODE is the format
		 * sentence; a png/jpeg that sniffs and then will not decode or prepare is a
		 * source that could not be read (the "may be damaged" sentence).
		 */
		const sniffed = sniffImage(read.bytes);
		if (sniffed === null) {
			failures.push({ name, reason: "unsupported" });
			continue;
		}
		let bytes: Uint8Array;
		try {
			// The hub accepts png/jpeg only; the model's prepare step sniffs,
			// converts and bounds to the wire's edge and the hub's byte ceiling. The
			// SAME step runs for a data URL and for a filesystem read: one prepare
			// path, so the two forms cannot drift into different bounding rules.
			const prepared = await prepareImageForUpload(
				new Blob([read.bytes as BlobPart]),
				capability.max_bytes,
			);
			bytes = prepared.bytes;
		} catch (error) {
			/*
			 * THE REASON COMES FROM THE PREPARE STEP'S OWN CLASSIFICATION, not from the
			 * format alone. `too_large` is a VALID picture over the hub's byte ceiling and
			 * keeps the format sentence exactly as the base tree said it; only an
			 * `unsupported` refusal on a png/jpeg source is a source that could not be
			 * READ. Deciding this on "is it png/jpeg" alone reclassified an oversize image
			 * as damaged, which is a sentence about the picture's integrity and therefore
			 * the one thing that must not be guessed (review round 2, R2-1 / QA Q-2).
			 *
			 * WHAT `READ` IS, AND THE ARM THAT IS ONLY DEFENSIVE. It is reached by a source
			 * that cannot be read at all and by a payload whose DECLARED base64 will not
			 * decode. The png/jpeg-whose-decoder-refuses arm below is defensive rather than
			 * reachable today: it behaves correctly if it ever fires, but `bound-image.ts`
			 * swallows a decoder refusal, so that image does not arrive here at all. And
			 * `read` is NOT reached by every damaged image: a REFUSED image passes through
			 * `bound-image.ts` untouched, while a decodable one is re-encoded and only
			 * reverts to the original bytes when re-encoding did not shrink it - so a
			 * truncated-but-decodable PNG can still be uploaded, and this arm cannot claim
			 * to catch corruption in general (pre-existing, out of this change's scope).
			 */
			const decodable = sniffed === "image/png" || sniffed === "image/jpeg";
			const prepareRefusal =
				error instanceof AttachmentPrepareError ? error.reason : null;
			failures.push({
				name,
				reason:
					prepareRefusal === "unsupported" && decodable
						? "read"
						: "unsupported",
			});
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
