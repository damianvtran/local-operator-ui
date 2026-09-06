/**
 * Radient access through the backend's narrow proxy.
 *
 * Every account, credits, usage, agent-catalogue and comment call goes through
 * `POST /v1/desktop/radient` on the desktop control plane. The backend resolves
 * and refreshes the Radient credential from its AuthStore; the renderer never
 * holds an access token, a refresh token, or a keytar entry, and there is no
 * token getter or exchange proxy to misuse.
 *
 * The proxy returns the upstream JSON envelope with secrets stripped
 * (`{msg, result}`, the `RadientApiResponse` shape the old direct clients
 * returned). `radientProxyEnvelope` hands that back untouched for callers
 * that read `.result` themselves; `radientProxy` unwraps `result`.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { RadientApiResponse } from "./types";

export type RadientOperation =
	| "account"
	| "prices"
	| "credits"
	| "usage"
	| "provision"
	| "application.create"
	| "agents.list"
	| "agents.get"
	| "agents.create"
	| "agents.update"
	| "agents.delete"
	| "agents.like"
	| "agents.unlike"
	| "agents.liked"
	| "agents.like_count"
	| "agents.favourite"
	| "agents.unfavourite"
	| "agents.favourited"
	| "agents.favourite_count"
	| "agents.download_count"
	| "comments.list"
	| "comments.create"
	| "comments.update"
	| "comments.delete"
	| "account.agents";

export type RadientProxyArgs = {
	operation: RadientOperation;
	tenantId?: string;
	accountId?: string;
	agentId?: string;
	commentId?: string;
	query?: Record<string, string | number>;
	payload?: Record<string, unknown>;
	/** Mutations need a stable request id, reused across retries. */
	requestId?: string;
	/** DELETE operations require explicit confirmation. */
	confirmed?: boolean;
};

type ProxyEnvelope<T> = RadientApiResponse<T>;

function control(args: RadientProxyArgs) {
	return {
		operation: args.operation,
		...(args.tenantId ? { tenant_id: args.tenantId } : {}),
		...(args.accountId ? { account_id: args.accountId } : {}),
		...(args.agentId ? { agent_id: args.agentId } : {}),
		...(args.commentId ? { comment_id: args.commentId } : {}),
		...(args.query ? { query: args.query } : {}),
		...(args.payload ? { payload: args.payload } : {}),
		...(args.requestId ? { request_id: args.requestId } : {}),
		...(args.confirmed ? { confirmed: true } : {}),
	};
}

/** Full upstream envelope, for callers that keep the `{msg, result}` shape. */
export async function radientProxyEnvelope<T>(
	args: RadientProxyArgs,
): Promise<ProxyEnvelope<T>> {
	const response = await desktopResult<{ data: ProxyEnvelope<T> }>({
		op: "radient.request",
		control: control(args),
	});
	return response.data;
}

/**
 * Run one closed Radient operation through the backend proxy and return the
 * upstream `result`. A 409 means no Radient credential is stored: sign in
 * through the provider grid (backend auth operations), not through a
 * renderer-held OIDC flow.
 */
export async function radientProxy<T>(args: RadientProxyArgs): Promise<T> {
	const envelope = await radientProxyEnvelope<T>(args);
	if (envelope && typeof envelope === "object" && "result" in envelope) {
		return envelope.result as T;
	}
	return envelope as unknown as T;
}
