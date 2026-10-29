import {
	type AgentMessagesBoundary,
	type AgentMessagesConsentPut,
	type AgentMessagesRefusal,
	type AgentMessagesSettingsResult,
	type AgentMessagesStatus,
	agentMessagesOnboardingContext,
	agentMessagesServedConsent,
} from "../../../../shared/agent-messages-contract";

import { sessionIdPattern } from "../../../../shared/desktop-contract";

export const AGENT_MESSAGES_STATUS_CACHE_MS = 5 * 60 * 1000;
export type AgentMessagesConsentIdentity = {
	accountId: string;
	tenantId: string;
	consentVersion: string;
};
export type AgentMessagesSnapshot = {
	status: AgentMessagesStatus | null;
	checking: boolean;
	pending: boolean;
	confirmed: boolean;
	refusal: AgentMessagesRefusal | null;
	/**
	 * The boundary-latched presentation decision (§5.3): true only when the
	 * last COMPLETED check observed an onboarding-eligible state while the app
	 * was not busy. Merely becoming quiet later never presents on its own.
	 */
	presentable: boolean;
};
export type AgentMessagesModelPorts = {
	status: (
		boundary: AgentMessagesBoundary,
	) => Promise<AgentMessagesStatus | null>;
	enable: (
		body: AgentMessagesConsentPut,
	) => Promise<AgentMessagesSettingsResult>;
	localSetting: (
		key: "team_bridge.enabled" | "team_bridge.session",
		value: boolean | string,
	) => Promise<unknown>;
	markSeen: (accountId: string, tenantId: string) => void;
	describe: (error: unknown) => AgentMessagesRefusal;
	now?: () => number;
};

const empty = (): AgentMessagesSnapshot => ({
	status: null,
	checking: false,
	pending: false,
	confirmed: false,
	refusal: null,
	presentable: false,
});

/**
 * One app-owned coordinator, shared by consent and later settings callers.
 * The harness coalesces across sessions; this layer coalesces renderer mounts.
 * No setInterval or scheduled refresh exists: a boundary must call check().
 */
export class AgentMessagesModel {
	private accountId: string | null = null;
	private blocked = false;
	/**
	 * Round-2 R2: set when the app became busy WHILE a status check was in
	 * flight. A check that started safe must not arm on its response when busy
	 * intervened before the response landed - even if the app is quiet again by
	 * then; only the NEXT natural boundary re-decides.
	 */
	private busySeenInFlight = false;
	private generation = 0;
	private snapshot = empty();
	private listeners = new Set<() => void>();
	private lastChecks = new Map<
		string,
		{ at: number; status: AgentMessagesStatus | null }
	>();
	private inFlight: {
		accountId: string;
		generation: number;
		promise: Promise<void>;
	} | null = null;

	constructor(private readonly ports: AgentMessagesModelPorts) {}
	getSnapshot = () => this.snapshot;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish(patch: Partial<AgentMessagesSnapshot>) {
		this.snapshot = { ...this.snapshot, ...patch };
		for (const listener of this.listeners) listener();
	}

	/**
	 * Forget the cached status for the signed-in account, so the NEXT natural
	 * boundary (Settings mounting again, window focus) reads fresh instead of
	 * replaying the five-minute cache.
	 *
	 * WHY: the chief-of-staff hold (runtime #2777) is released by something the
	 * owner does elsewhere - sending a message in that conversation - so the
	 * notice asking for it must not outlive their return to Settings by up to
	 * five minutes. Same move the consent paths make (`lastChecks.delete`), but
	 * with no read of its own: no timer, and the boundary that follows still
	 * decides when to ask.
	 */
	invalidateStatus() {
		if (this.accountId) this.lastChecks.delete(this.accountId);
	}

	setAccount(accountId: string | null) {
		if (this.accountId === accountId) return;
		// In-flight IPC cannot be unsent; generation fences discard its response
		// and prevent ANY subsequent local enable/designation for the next account.
		this.generation += 1;
		this.accountId = accountId;
		this.inFlight = null;
		this.busySeenInFlight = false;
		this.snapshot = empty();
		for (const listener of this.listeners) listener();
	}

	/**
	 * The shell's live busy fact (§5.3), set from the on-ramp component's layout
	 * effect. A boundary that hits busy does not present, and merely becoming
	 * quiet later is not one of §5.1's natural boundaries - only the next check
	 * re-decides (see `armBoundary`).
	 */
	setBlocked(blocked: boolean) {
		if (blocked && this.inFlight) this.busySeenInFlight = true;
		this.blocked = blocked;
	}

	/**
	 * Latch or clear the presentation decision from ONE completed check. Runs on
	 * every completion - network and cache - so the NEXT safe natural boundary
	 * re-decides even when its status was served from the five-minute cache
	 * (the case the round-1 review asked to pin).
	 */
	private armBoundary(
		status: AgentMessagesStatus | null,
		blockedAtEntry: boolean,
	) {
		/*
		 * Round-2 R2: a check that STARTED safe can see busy intervene before its
		 * response - the user started a turn, typed, or opened a modal. The
		 * completion must not arm from the stale entry snapshot: quiet by the
		 * time it lands is not a boundary either; the NEXT check re-decides.
		 */
		const blocked = blockedAtEntry || this.busySeenInFlight;
		this.publish({
			presentable:
				Boolean(agentMessagesOnboardingContext(status, this.accountId)) &&
				!blocked,
		});
	}

	check(
		boundary: AgentMessagesBoundary,
		refreshConsent = false,
	): Promise<void> {
		const accountId = this.accountId;
		if (!accountId) return Promise.resolve();
		if (this.inFlight?.accountId === accountId) return this.inFlight.promise;
		/*
		 * §5.3: "if a boundary hits busy, it waits for the next one". The busy
		 * fact is snapshotted AT the boundary, and the presentation decision
		 * this check produces also denies when busy INTERVENED while the check
		 * was in flight (round-2 R2) - a fresh window opens with this check.
		 */
		this.busySeenInFlight = false;
		const blockedAtBoundary = this.blocked;
		const now = this.ports.now?.() ?? Date.now();
		const cached = this.lastChecks.get(accountId);
		if (
			!refreshConsent &&
			cached &&
			now - cached.at < AGENT_MESSAGES_STATUS_CACHE_MS
		) {
			this.publish({ status: cached.status });
			this.armBoundary(cached.status, blockedAtBoundary);
			return Promise.resolve();
		}
		const generation = this.generation;
		const previous = this.snapshot.status;
		this.publish({
			checking: true,
			...(refreshConsent ? { status: null } : {}),
		});
		const promise = (async () => {
			try {
				const response = await this.ports.status(boundary);
				if (!this.isCurrent(accountId, generation)) return;
				const status = response?.account_id === accountId ? response : null;
				this.lastChecks.set(accountId, { at: now, status });
				const scopeChanged =
					previous?.account_id !== status?.account_id ||
					previous?.tenant_id !== status?.tenant_id;
				const consentChanged =
					previous?.consent?.version !== status?.consent?.version;
				this.publish({
					status,
					checking: false,
					// Confirmation belongs to the rendered account/org/version, not
					// the next organization's dialog after a boundary read.
					...(scopeChanged || consentChanged ? { confirmed: false } : {}),
					// Preserve a version-refusal explanation ONLY for the same scope.
					...(refreshConsent && !scopeChanged ? {} : { refusal: null }),
				});
				this.armBoundary(status, blockedAtBoundary);
			} catch (error) {
				if (!this.isCurrent(accountId, generation)) return;
				this.lastChecks.set(accountId, { at: now, status: null });
				this.publish({
					status: null,
					checking: false,
					refusal: this.ports.describe(error),
				});
				this.armBoundary(null, blockedAtBoundary);
			} finally {
				if (this.inFlight?.generation === generation) this.inFlight = null;
			}
		})();
		this.inFlight = { accountId, generation, promise };
		return promise;
	}

	private isCurrent(accountId: string, generation: number) {
		return this.accountId === accountId && this.generation === generation;
	}

	private isConsentCurrent(
		identity: AgentMessagesConsentIdentity,
		generation: number,
	) {
		const status = this.snapshot.status;
		return (
			this.isCurrent(identity.accountId, generation) &&
			status?.account_id === identity.accountId &&
			status.tenant_id === identity.tenantId &&
			status.state === "ready" &&
			status.error === null &&
			!status.update_required &&
			status.capability >= 1 &&
			status.consent_account_guard === true &&
			(status.surface_state === "B" || status.surface_state === "C") &&
			agentMessagesServedConsent(status)?.version === identity.consentVersion
		);
	}

	consentIdentity(): AgentMessagesConsentIdentity | null {
		const context = agentMessagesOnboardingContext(
			this.snapshot.status,
			this.accountId,
		);
		const consent = agentMessagesServedConsent(this.snapshot.status);
		return context && consent
			? { ...context, consentVersion: consent.version }
			: null;
	}

	canEnable(identity: AgentMessagesConsentIdentity | null): boolean {
		// A previous write refusal is feedback, not a permanent retry lock. The
		// current status/identity guards still fail closed; confirmed local setup
		// failures must finish in Settings rather than submitting consent again.
		const current = this.consentIdentity();
		return Boolean(
			identity &&
				current &&
				identity.accountId === current.accountId &&
				identity.tenantId === current.tenantId &&
				identity.consentVersion === current.consentVersion &&
				this.snapshot.status?.consent_account_guard === true &&
				this.snapshot.status.error === null &&
				!this.snapshot.checking &&
				!this.snapshot.pending &&
				!this.snapshot.confirmed,
		);
	}

	dismiss(accountId: string, tenantId: string) {
		// Dismissal is presentation-only, even when the upstream write hangs.
		if (this.accountId !== accountId) return;
		this.ports.markSeen(accountId, tenantId);
	}

	async enable(
		identity: AgentMessagesConsentIdentity,
		sessionId: string | null,
	) {
		if (!this.canEnable(identity)) return;
		const generation = this.generation;
		const { accountId, tenantId, consentVersion } = identity;
		this.publish({ pending: true, refusal: null });
		try {
			// EXACTLY one human click, one version, one selected organization. The
			// backend's advertised guard binds this before the upstream mutation.
			const result = await this.ports.enable({
				expected_account_id: accountId,
				tenant_id: tenantId,
				state: "active",
				consent_version: consentVersion,
				consented_via: "dialog",
			});
			// A boundary read can change organization or consent while the PUT is
			// in flight. Discard its local effects just like an account switch.
			if (!this.isConsentCurrent(identity, generation)) return;
			if (!result.endpoint) {
				// The enable response is the receipt for a write that just created
				// one; a null endpoint is a shape this client cannot trust.
				throw new Error("Consent response carries no endpoint");
			}
			// The upstream endpoint carries no account id; the account receipt is
			// the pre-write guard above plus `isConsentCurrent` (which compares the
			// status's account). This check is about the ORGANIZATION and state
			// the response reports, not a second account comparison.
			if (
				result.endpoint.tenant_id !== tenantId ||
				result.endpoint.state !== "active"
			) {
				// Response integrity only, NEVER a substitute for the pre-write guard.
				throw new Error(
					"Consent response does not match the submitted identity",
				);
			}
			this.publish({ confirmed: true });
			// Clear/designate before the local preference, never retain an old
			// destination for off-chat/drafts. These PATCHes are ONLY preferences:
			// H4 must atomically bind/validate account+credential+organization+
			// endpoint+designation before enrollment or wake. A queued generic
			// PATCH cannot be unsent; these fences are not enrollment authority.
			const designation =
				sessionId && sessionIdPattern.test(sessionId) ? sessionId : "";
			await this.ports.localSetting("team_bridge.session", designation);
			if (!this.isConsentCurrent(identity, generation)) return;
			await this.ports.localSetting("team_bridge.enabled", true);
			if (!this.isConsentCurrent(identity, generation)) return;
			this.ports.markSeen(accountId, tenantId);
			this.lastChecks.delete(accountId);
			await this.check("surface_open", true);
		} catch (error) {
			if (!this.isConsentCurrent(identity, generation)) return;
			const refusal = this.ports.describe(error);
			this.publish({ refusal });
			if (refusal.code === "consent_version_unknown") {
				// Invalidate, re-render, STOP. A refreshed version needs a NEW click;
				// there is no recursive enable/retry or optimistic local boolean.
				this.lastChecks.delete(accountId);
				await this.check("surface_open", true);
			}
		} finally {
			if (this.isCurrent(accountId, generation))
				this.publish({ pending: false });
		}
	}
}
