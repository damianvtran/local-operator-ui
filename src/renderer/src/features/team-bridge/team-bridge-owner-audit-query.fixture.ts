import { QueryClient } from "@tanstack/react-query";
import type { TeamBridgeDirectoryMember } from "../../../../shared/team-bridge-contract";
import type {
	OwnerAuditConversation,
	OwnerAuditMessage,
} from "../../../../shared/team-bridge-owner-audit-contract";
import { radientUserKeys } from "../../shared/hooks/radient-account-authority";
import { teamBridgeKeys } from "./team-bridge-keys";

export const OWNER_AUDIT_NOFETCH_SENTINEL =
	"https://query-history-fixture.invalid/unadmitted-preview.png";

// The fixture owns the outer marker; the shipped panel owns its direct scroll
// child. Avoid a semantic-tag assumption (the real panel root is a section)
// and do not accidentally measure a nested markdown/code overflow element.
export const QUERY_HISTORY_VIEWPORT_SELECTOR =
	"[data-query-history-panel] > :only-child > .overflow-auto";

export function queryHistoryViewport(root: ParentNode | null) {
	return (
		root?.querySelector<HTMLElement>(QUERY_HISTORY_VIEWPORT_SELECTOR) ?? null
	);
}

type FixtureMode = "normal" | "empty" | "short" | "denied" | "unavailable";
type TransportRecord = {
	op: string;
	tenant?: string;
	conversation?: string;
	before?: number;
	limit?: number;
	root?: string;
	order?: string;
	after?: number;
};

/**
 * Story-only IPC transport, not a replacement hook or paging implementation.
 * The real surface selects its rail, mounts its private panel and decides which
 * request/cursor/cache eviction to attempt. This backend supplies descending
 * bounded DTOs and can hold a response while the actual viewport moves.
 * Unknown operations fail closed: this story must never fall through to a
 * live desktop daemon. No credentials, persisted data or private URLs are used.
 */
export function createOwnerAuditQueryFixture(options: {
	accountId: string;
	tenantIds: readonly string[];
	conversations: readonly OwnerAuditConversation[];
	members: readonly TeamBridgeDirectoryMember[];
	message: OwnerAuditMessage;
	unavailableMessage: OwnerAuditMessage;
}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const seedAuthority = () => {
		client.setQueryData(radientUserKeys.user(), {
			account: { id: options.accountId },
		});
		client.setQueryData(teamBridgeKeys.statusFor(options.accountId), {
			account_id: options.accountId,
			state: "ready",
			local: { enabled: true },
		});
	};
	seedAuthority();
	const records: TransportRecord[] = [];
	const pending = new Set<() => void>();
	let active = true;
	let holdOlder = false;
	let mode: FixtureMode = "normal";
	let latest = 10000;
	let expanded = false;
	let threadLatest = 20000;
	let threadMode: "backward" | "old-server" | "old-runtime" = "backward";
	const envelope = (result: unknown, status = 200, code?: string) => ({
		status,
		kind: "json" as const,
		body:
			status === 200
				? { status, result }
				: {
						status,
						detail: {
							code,
							message: "Synthetic fixture refusal", // i18n: ignore synthetic IPC fixture error, not product copy
						},
					},
	});
	const request: typeof window.api.desktop.request = async (input) => {
		if (!active) return envelope(null, 503);
		const record: TransportRecord = { op: input.op };
		if ("tenant_id" in input) record.tenant = input.tenant_id;
		if ("conversation_id" in input) record.conversation = input.conversation_id;
		if ("before_seq" in input) record.before = input.before_seq;
		if ("limit" in input) record.limit = input.limit;
		if ("message_id" in input) record.root = input.message_id;
		if ("order" in input) record.order = input.order;
		if ("after_seq" in input) record.after = input.after_seq;
		records.push(record);
		if (records.length > 128) records.shift();
		// Some operations have an optional tenant field: property presence does
		// not prove a string. Refuse those inputs instead of asserting them safe.
		if (
			!("tenant_id" in input) ||
			typeof input.tenant_id !== "string" ||
			!options.tenantIds.includes(input.tenant_id)
		)
			return envelope(null, 403);
		if (input.op === "team_bridge.directory")
			return envelope({ members: options.members });
		if (
			!("expected_account_id" in input) ||
			input.expected_account_id !== options.accountId
		)
			return envelope(null, 403);
		if (input.op === "team_bridge.owner_audit.conversations")
			return envelope({
				conversations: options.conversations.map((conversation) => ({
					...conversation,
					tenant_id: input.tenant_id,
				})),
				has_more: false,
				next_cursor: null,
			});
		if (
			input.op === "team_bridge.owner_audit.replies" ||
			input.op === "team_bridge.messages.replies"
		) {
			if (mode === "denied") return envelope(null, 403);
			if (input.limit !== undefined && input.limit !== 50)
				return envelope(null, 422, "invalid_request");
			if (
				threadMode === "old-runtime" &&
				(input.order !== undefined || input.before_seq !== undefined)
			)
				return envelope(null, 422, "invalid_request");
			if (
				holdOlder &&
				(input.before_seq !== undefined ||
					(input.after_seq !== undefined && input.after_seq > 0))
			) {
				holdOlder = false;
				await new Promise<void>((resolve) => pending.add(resolve));
			}
			if (!active) return envelope(null, 503);
			const backward =
				threadMode === "backward" &&
				(input.order === "desc" || input.before_seq !== undefined);
			const rootSeq = 9999;
			const count = mode === "empty" ? 0 : mode === "short" ? 3 : 50;
			const first = backward
				? Math.max(rootSeq + 1, (input.before_seq ?? threadLatest + 1) - count)
				: Math.max(rootSeq + 1, input.after_seq ?? rootSeq + 1);
			const last = backward
				? (input.before_seq ?? threadLatest + 1) - 1
				: Math.min(threadLatest, first + count - 1);
			const replyRoot = {
				...options.message,
				id: input.message_id,
				conversation_id: input.conversation_id,
				seq: rootSeq,
				origin: options.message.sender.kind === "agent" ? "agent" : "human",
				// The member DTO omits a root's parent (it is never a reply).
				thread_root_id: undefined,
				reply_count:
					mode === "empty" ? 0 : mode === "short" ? 3 : threadLatest - rootSeq,
				attachments: [],
				attachment_count: 0,
			};
			const replies = Array.from(
				{ length: Math.max(0, Math.min(count, last - first + 1)) },
				(_, index) => {
					const seq = first + index;
					const base =
						mode === "unavailable"
							? options.unavailableMessage
							: options.message;
					return {
						...base,
						id: `bcmsg_query_reply_${input.tenant_id}_${input.conversation_id}_${seq}`,
						conversation_id: input.conversation_id,
						seq,
						thread_root_id: input.message_id,
						origin: base.sender.kind === "agent" ? "agent" : "human",
						body:
							mode === "unavailable"
								? base.body
								: `Synthetic reply ${seq}.${expanded && seq === 19995 ? `\n\n${"Controlled reply reflow.\n\n".repeat(15)}` : ""}`,
						attachments:
							mode === "unavailable"
								? [
										{
											id: "bat_query_reply_unadmitted",
											mime: "image/png",
											size: 256,
											state: "pending",
											url: OWNER_AUDIT_NOFETCH_SENTINEL,
											preview_url: OWNER_AUDIT_NOFETCH_SENTINEL,
										},
									]
								: [],
						attachment_count: mode === "unavailable" ? 1 : 0,
					};
				},
			);
			const hasMore =
				(mode === "normal" || mode === "unavailable") &&
				replies.length > 0 &&
				(backward ? first > rootSeq + 1 : last < threadLatest);
			return envelope({
				root: replyRoot,
				replies,
				has_more: hasMore,
				...(backward
					? { next_before_seq: hasMore ? first : undefined }
					: { next_after_seq: hasMore ? last + 1 : undefined }),
				...(threadMode === "backward" &&
				(input.order !== undefined || input.before_seq !== undefined)
					? { order: backward ? "desc" : "asc" }
					: {}),
			});
		}
		if (input.op !== "team_bridge.owner_audit.messages")
			return envelope(null, 503);
		if (input.limit !== 50) return envelope(null, 400);
		if (holdOlder && input.before_seq !== undefined) {
			holdOlder = false;
			await new Promise<void>((resolve) => {
				pending.add(resolve);
			});
		}
		if (!active) return envelope(null, 503);
		if (mode === "denied") return envelope(null, 403);
		const last = (input.before_seq ?? latest + 1) - 1;
		const count = mode === "empty" ? 0 : mode === "short" ? 3 : 50;
		const rows = Array.from({ length: count }, (_, index) => {
			const seq = last - index;
			const base =
				mode === "unavailable" ? options.unavailableMessage : options.message;
			return {
				...base,
				id: `bmsg_query_${input.tenant_id}_${input.conversation_id}_${seq}`,
				conversation_id: input.conversation_id,
				seq,
				reply_count: seq === 9999 ? threadLatest - 9999 : 0,
				body:
					mode === "unavailable"
						? base.body
						: `Query fixture ${input.tenant_id} message ${seq}.${expanded && seq === 9995 ? `\n\n${"Controlled above-row reflow.\n\n".repeat(15)}` : ""}`,
				// Deliberately non-vacuous: unavailable bytes have adversarial URL
				// metadata, but no admitted body. A browser attempt is a failure,
				// even though this synthetic .invalid origin cannot serve bytes.
				attachments:
					mode === "unavailable"
						? [
								{
									id: "bat_query_unadmitted",
									mime: "image/png",
									size: 256,
									state: "pending",
									url: OWNER_AUDIT_NOFETCH_SENTINEL,
									preview_url: OWNER_AUDIT_NOFETCH_SENTINEL,
								},
							]
						: [],
				attachment_count: mode === "unavailable" ? 1 : 0,
			};
		});
		return envelope({
			messages: rows,
			has_more: mode === "normal" || mode === "unavailable",
			next_before_seq: rows.at(-1)?.seq ?? null,
		});
	};
	return {
		client,
		request,
		// React Strict Effects may replay setup after cleanup in the gallery.
		activate() {
			active = true;
			seedAuthority();
		},
		setMode(value: FixtureMode) {
			mode = value;
		},
		holdNextOlder() {
			holdOlder = true;
		},
		release() {
			for (const resolve of pending) resolve();
			pending.clear();
		},
		arrive() {
			latest += 1;
			threadLatest += 1;
		},
		setThreadMode(value: "backward" | "old-server" | "old-runtime") {
			threadMode = value;
		},
		expand() {
			expanded = !expanded;
		},
		// A deliberate backend-data refresh, not a product polling subscription.
		refreshBackend() {
			return client.refetchQueries({
				predicate: (query) =>
					query.queryKey[0] === "team-bridge" &&
					((query.queryKey[1] === "owner-audit" &&
						query.queryKey.at(-1) === "messages") ||
						query.queryKey.includes("replies")),
				type: "active",
			});
		},
		inspect() {
			return {
				mode,
				latest,
				threadLatest,
				threadMode,
				noFetchSentinel: OWNER_AUDIT_NOFETCH_SENTINEL,
				held: pending.size,
				records: [...records],
				queries: client
					.getQueryCache()
					.findAll()
					.filter(
						(query) =>
							query.queryKey[1] === "owner-audit" ||
							query.queryKey.includes("replies"),
					)
					.map((query) => {
						const data = query.state.data as
							| {
									pages?: {
										messages?: OwnerAuditMessage[];
										replies?: OwnerAuditMessage[];
									}[];
									pageParams?: unknown[];
							  }
							| undefined;
						return {
							key: query.queryKey,
							status: query.state.status,
							observers: query.getObserversCount(),
							pages: data?.pages?.length ?? 0,
							rows:
								data?.pages?.reduce(
									(sum, page) =>
										sum + (page.messages?.length ?? page.replies?.length ?? 0),
									0,
								) ?? 0,
							pageParams: data?.pageParams,
						};
					}),
			};
		},
		dispose() {
			active = false;
			for (const resolve of pending) resolve();
			pending.clear();
			client.clear();
		},
	};
}
