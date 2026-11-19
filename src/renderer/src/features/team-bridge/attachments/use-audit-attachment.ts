import {
	OwnerAuditAttachmentError,
	TeamBridgeOwnerAuditApi,
} from "@shared/api/local-operator/team-bridge-owner-audit-api";
import {
	createBlobUrl,
	peek,
	publish,
	release,
	retain,
	revokeBlobUrl,
} from "@shared/lib/blob-url-cache";
import { useEffect, useState } from "react";
import {
	type AuditAttachmentScope,
	auditAttachmentKey,
} from "./audit-attachment-scope";

type Result = "ready" | "failed" | "unavailable";
export type AuditImageState =
	| { state: "loading" | "failed" | "unavailable" }
	| { state: "ready"; url: string };
const inflight = new Map<
	string,
	{ holders: number; promise: Promise<Result> }
>();

export function auditFailure(error: unknown): "failed" | "unavailable" {
	return error instanceof OwnerAuditAttachmentError &&
		(error.status === null ||
			error.status === 408 ||
			error.status === 429 ||
			error.status >= 500)
		? "failed"
		: "unavailable";
}

function fetchInto(key: string, scope: AuditAttachmentScope): Promise<Result> {
	const existing = inflight.get(key);
	if (existing) {
		existing.holders += 1;
		return existing.promise;
	}
	const record: { holders: number; promise: Promise<Result> } = {
		holders: 1,
		promise: Promise.resolve("unavailable"),
	};
	record.promise = (async () => {
		try {
			const answer = await TeamBridgeOwnerAuditApi.attachmentBytes(scope);
			const url = createBlobUrl(answer.data as BlobPart, answer.mimeType);
			if (record.holders <= 0) {
				revokeBlobUrl(url);
				return "unavailable";
			}
			publish(key, url);
			return "ready";
		} catch (error) {
			return auditFailure(error);
		} finally {
			inflight.delete(key);
		}
	})();
	inflight.set(key, record);
	return record.promise;
}

/** Separate in-flight namespace and account-bearing key prevent audit bytes
 * from satisfying a member read (or account B from retaining A's blob). The
 * key travels with state so even the render before effect cleanup is closed. */
export function useAuditAttachment(
	scope: AuditAttachmentScope,
	enabled: boolean,
	attempt: number,
): AuditImageState {
	const key = auditAttachmentKey(scope);
	const [entry, setEntry] = useState<{ key: string; value: AuditImageState }>(
		() => {
			const url = enabled ? peek(key) : null;
			return {
				key,
				value: url ? { state: "ready", url } : { state: "loading" },
			};
		},
	);
	// Scope is fully encoded in key; attempt is an explicit authorized retry.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scope is encoded in key.
	useEffect(() => {
		if (!enabled) return;
		let live = true;
		const warm = retain(key);
		if (warm) {
			setEntry({ key, value: { state: "ready", url: warm } });
			return () => {
				live = false;
				release(key);
			};
		}
		setEntry({ key, value: { state: "loading" } });
		let joined = true;
		void fetchInto(key, scope).then((result) => {
			joined = false;
			if (!live) return;
			const url = result === "ready" ? retain(key) : null;
			setEntry({
				key,
				value: url
					? { state: "ready", url }
					: { state: result === "failed" ? "failed" : "unavailable" },
			});
		});
		return () => {
			live = false;
			if (joined) {
				const record = inflight.get(key);
				if (record) record.holders -= 1;
			}
			release(key);
		};
	}, [key, enabled, attempt]);
	return !enabled
		? { state: "unavailable" }
		: entry.key === key
			? entry.value
			: { state: "loading" };
}
