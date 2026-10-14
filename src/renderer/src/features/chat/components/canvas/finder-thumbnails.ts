import { createBlobUrl, revokeBlobUrl } from "@shared/lib/blob-url-cache";
import { useEffect, useState } from "react";
import { fetchAttachmentBlob } from "../../canonical/use-attachment-url";
import type { CanvasDocument } from "../../types/canvas";
import { mimeTypeForPath } from "../../utils/file-kind";

/**
 * A bounded thumbnail working set, not thousands of original-media hooks.
 *
 * Four reads/decodes maximum, queued reads discarded when their last subscriber
 * unmounts; retained thumbnails are PNGs no larger than 640 px on either side.
 * The shared object-URL ledger owns bytes and revocation. Keep 150 thumbnails
 * warm across virtualization unmounts, evict only unobserved entries. Original
 * bytes are never retained here; a lightbox/action resolves them on demand.
 * Files enter only from the authoritative local index or the old-backend fallback.
 * A remote unsupported index never produces rows, so it cannot call readFileBytes.
 */
const LIMIT = 150;
const READ_CAP = 16 * 1024 * 1024;
type Snapshot = {
	state: "loading" | "ready" | "unavailable";
	url?: string;
	reason?: string;
};
type Entry = {
	key: string;
	document: CanvasDocument;
	state: Snapshot;
	listeners: Set<(value: Snapshot) => void>;
	started: boolean;
};
const cache = new Map<string, Entry>();
const queue: Entry[] = [];
let active = 0;
let reads = 0;
let decodes = 0;
let peakActive = 0;
export const finderThumbnailStats = () => ({
	entries: cache.size,
	queued: queue.length,
	active,
	reads,
	decodes,
	peakActive,
});
const keyOf = (document: CanvasDocument) =>
	document.artifact
		? `finder:${document.artifact.sessionId}:${document.artifact.childId ?? "self"}:${document.artifact.digest}`
		: `finder:${document.path}:${document.lastAgentModified ?? 0}:${document.sizeBytes ?? 0}`;

export async function finderOriginal(document: CanvasDocument): Promise<Blob> {
	if (document.artifact)
		return fetchAttachmentBlob(
			{
				sessionId: document.artifact.sessionId,
				childId: document.artifact.childId ?? null,
			},
			document.artifact.digest,
		);
	const answer = await window.api.readFileBytes(document.path, READ_CAP);
	if (!answer.success) throw new Error(answer.error ?? "Could not be read");
	return new Blob([answer.data as BlobPart], {
		type: mimeTypeForPath(document.path),
	});
}

function evict() {
	for (const [key, entry] of cache) {
		if (cache.size <= LIMIT) return;
		if (entry.listeners.size || entry.started) continue;
		if (entry.state.url) revokeBlobUrl(entry.state.url);
		cache.delete(key);
	}
}
function publish(entry: Entry, state: Snapshot) {
	entry.state = state;
	for (const listener of entry.listeners) listener(state);
}
function drain() {
	while (active < 4 && queue.length) {
		const entry = queue.shift();
		if (!entry || !entry.listeners.size) {
			if (entry) cache.delete(entry.key);
			continue;
		}
		entry.started = true;
		active++;
		reads++;
		peakActive = Math.max(peakActive, active);
		void (async () => {
			try {
				if ((entry.document.sizeBytes ?? 0) > READ_CAP)
					throw new Error("Too large to preview");
				const bytes = await finderOriginal(entry.document);
				if (bytes.size > READ_CAP) throw new Error("Too large to preview");
				const image = await createImageBitmap(bytes);
				decodes++;
				try {
					const ratio = Math.min(1, 640 / Math.max(image.width, image.height));
					const canvas = new OffscreenCanvas(
						Math.max(1, Math.round(image.width * ratio)),
						Math.max(1, Math.round(image.height * ratio)),
					);
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Can't preview this image");
					context.drawImage(image, 0, 0, canvas.width, canvas.height);
					const thumbnail = await canvas.convertToBlob({ type: "image/png" });
					publish(entry, {
						state: "ready",
						url: createBlobUrl(await thumbnail.arrayBuffer(), "image/png"),
					});
				} finally {
					image.close();
				}
			} catch (error) {
				publish(entry, {
					state: "unavailable",
					reason: error instanceof Error ? error.message : "Could not be read",
				});
			} finally {
				entry.started = false;
				active--;
				evict();
				drain();
			}
		})();
	}
}

export function useFinderThumbnail(
	document: CanvasDocument,
	enabled: boolean,
): Snapshot {
	const key = keyOf(document);
	const [snapshot, setSnapshot] = useState<Snapshot>({ state: "loading" });
	useEffect(() => {
		if (!enabled) return;
		let entry = cache.get(key);
		// Remount is the retry boundary for failures, not an eternal poisoned LRU.
		if (entry?.state.state === "unavailable" && !entry.listeners.size) {
			cache.delete(key);
			entry = undefined;
		}
		if (!entry) {
			entry = {
				key,
				document,
				state: { state: "loading" },
				listeners: new Set(),
				started: false,
			};
			cache.set(key, entry);
			queue.push(entry);
		} else {
			cache.delete(key);
			cache.set(key, entry);
		}
		entry.listeners.add(setSnapshot);
		setSnapshot(entry.state);
		drain();
		const owned = entry;
		return () => {
			owned.listeners.delete(setSnapshot);
			if (
				!owned.started &&
				owned.state.state === "loading" &&
				!owned.listeners.size
			) {
				const position = queue.indexOf(owned);
				if (position >= 0) queue.splice(position, 1);
				cache.delete(key);
			}
			evict();
		};
		// The immutable identity/stat key owns the read, not document-object churn.
	}, [key, enabled, document]);
	return snapshot;
}
