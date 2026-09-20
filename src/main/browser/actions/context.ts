import type { ApprovalStore } from "../approvals";
import type { CdpPool } from "../cdp";
import type { DownloadArmer } from "../downloads";
import type { OwnershipLedger } from "../ownership";
import type { TabRegistry } from "../registry";

/**
 * What every action is given, and the two identity helpers they all use.
 *
 * The context is a plain object rather than a class so an action is a function
 * over explicit dependencies: the pieces it needs are visible in its signature,
 * and a test can hand it a registry built on fake views (see
 * `scripts/browser-host.test.mjs`) without touching Electron.
 */
export interface BrowserActionContext {
	readonly registry: TabRegistry;
	readonly cdp: CdpPool;
	readonly approvals: ApprovalStore;
	readonly ownership: OwnershipLedger;
	/** The per-tab download arming state and the `will-download` decision behind
	 * it (design §8). A member of the context rather than of the registry because
	 * the capture owns an Electron `DownloadItem`'s lifecycle, which is knowledge
	 * the registry deliberately does not have. */
	readonly downloads: DownloadArmer;
	/** Put a line in the app's log. Never model-facing. */
	readonly log: (message: string) => void;
	/** Ask the chrome surface to re-render (tabs changed, a prompt moved). */
	readonly onChanged: () => void;
	/** Host facts that `status` publishes: resolved lazily because the profile and
	 * the app version are only knowable once the session exists. */
	readonly facts: () => HostFacts;
}

/** What `status` reports about the host itself. */
export interface HostFacts {
	proto: number;
	appVersion: string;
	/** The resolved `ses.getStoragePath()`, or "" for an in-memory session. */
	profileDir: string;
	profilePersistent: boolean;
	userAgent: string;
	/** Whether the `domain` approval scope can be evaluated (design 12.2's PSL
	 * dependency). Reported rather than inferred so its absence is explainable. */
	domainScope: boolean;
}

/**
 * The identity an action attributes a request to.
 *
 * The session supplies `requester` as `session:<id>` (`_browser_identity_params`).
 * A value that is absent or not in that shape is NOT trusted as an identity —
 * admission then falls back to the request id, which only the caller holds — so a
 * caller cannot invent another session's identity by passing its label. This is
 * the extension's `sessionRequester` rule, and it is what makes a one-shot grant
 * unspendable by anyone else.
 */
export function requesterOf(
	params: Record<string, unknown>,
	requestId: string,
): string {
	const supplied =
		typeof params.requester === "string" ? params.requester.trim() : "";
	return supplied.startsWith("session:") ? supplied : requestId;
}

/** The bare session id behind a requester, for ownership bookkeeping. */
export function sessionIdOf(requester: string): string {
	return requester.startsWith("session:")
		? requester.slice("session:".length)
		: "";
}

/** A bounded, trimmed string param, or "". */
export function stringParam(
	params: Record<string, unknown>,
	key: string,
): string {
	const value = params[key];
	return typeof value === "string" ? value.trim() : "";
}

/** A finite number param, or undefined. */
export function numberParam(
	params: Record<string, unknown>,
	key: string,
): number | undefined {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}
