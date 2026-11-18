/**
 * The pure rules behind the start-up band (`backend-startup-panel.tsx`): when
 * it shows, what it says, and what `backend_status` reports.
 *
 * A module of its own so the tests load them without the band's React and
 * UI-kit imports (`scripts/first-run-analytics.test.mjs`); the panel re-exports
 * them for the chat status strip and the onboarding modal.
 */
import { t } from "../../../../../i18n/messages";
import type {
	BackendStartup,
	BackendStartupCategory,
} from "../../../../../shared/backend-startup";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import type { ProductEvents } from "../../analytics/product-events";

/*
 * One arm per category, so the type checker proves every category has a
 * sentence and the one with a placeholder gets its value.
 */
export function startupReasonSentence(
	category: BackendStartupCategory,
	budgetMs: number,
): string {
	switch (category) {
		case "port_in_use":
			return t("ui.common.backend_startup.reason.port_in_use");
		case "port_forbidden":
			return t("ui.common.backend_startup.reason.port_forbidden");
		case "executable_blocked":
			return t("ui.common.backend_startup.reason.executable_blocked");
		case "executable_missing":
			return t("ui.common.backend_startup.reason.executable_missing");
		case "crashed":
			return t("ui.common.backend_startup.reason.crashed");
		case "exited":
			return t("ui.common.backend_startup.reason.exited");
		case "timed_out":
			return t("ui.common.backend_startup.reason.timed_out", {
				seconds: Math.round(budgetMs / 1000),
			});
		default:
			return t("ui.common.backend_startup.reason.unknown");
	}
}

/**
 * Whether the band shows for this snapshot.
 *
 * `failed` only while the app is not attached: a recovery (or another daemon
 * appearing) that attached the app ends the failure whatever the record says.
 *
 * `degraded` ends it only on EVIDENCE that a server answered after the failure
 * was recorded (`lastTransportAt` newer than `settledAt`). The state alone is
 * not that evidence (QA round 1): a port held by a foreign program reads
 * `degraded` for as long as it is held (Q2), and after a failed auto-restart
 * the state stayed `degraded` for 5-20 s while the strip said "answering
 * slowly, your messages are queued" over a dead server (Q3).
 */
export function startupPanelPhase(
	snapshot: Pick<
		DaemonStatusSnapshot,
		"state" | "startup" | "lastTransportAt"
	> | null,
): "starting" | "failed" | null {
	const startup = snapshot?.startup ?? null;
	if (!startup) return null;
	if (startup.phase === "starting") return "starting";
	if (startup.phase !== "failed" || snapshot?.state === "attached") return null;
	if (snapshot?.state === "degraded") {
		const answeredAt = snapshot.lastTransportAt ?? null;
		const failedAt = startup.settledAt ?? startup.startedAt;
		if (answeredAt !== null && answeredAt > failedAt) return null;
	}
	return "failed";
}

/*
 * `backend_status` dedupe across renderer reloads (review round 1, R4). The
 * launch's start settles before the window exists and is read from the
 * snapshot on load, so a ref-only key re-reported the same attempt on every
 * reload and inflated the counts. sessionStorage lives exactly as long as the
 * renderer session and survives its reloads, which is the span one attempt
 * belongs to; a renderer with no usable storage falls back to the ref.
 */
export const REPORTED_STARTUP_KEY = "lo.analytics.backend-status-reported";

/**
 * True the first time `key` is claimed in this renderer session, false after.
 * Storage is injectable for the test; an unusable one claims every time (the
 * ref in the hook still dedupes within one mount).
 */
export function claimBackendStatusReport(
	key: string,
	storage: Pick<Storage, "getItem" | "setItem"> | null = safeSessionStorage(),
): boolean {
	try {
		if (!storage) return true;
		const seen = storage.getItem(REPORTED_STARTUP_KEY);
		const list: string[] = seen ? JSON.parse(seen) : [];
		if (list.includes(key)) return false;
		// Bounded: one entry per settled attempt, and only the recent ones matter.
		storage.setItem(
			REPORTED_STARTUP_KEY,
			JSON.stringify([...list, key].slice(-20)),
		);
		return true;
	} catch {
		return true;
	}
}

function safeSessionStorage(): Storage | null {
	try {
		return typeof sessionStorage === "undefined" ? null : sessionStorage;
	} catch {
		return null;
	}
}

/** The `backend_status` properties for a settled record, or null while starting. */
export function backendStatusEvent(
	startup: BackendStartup,
): ProductEvents["backend_status"] | null {
	if (startup.phase === "starting") return null;
	const afterReady = startup.failure?.afterReady === true;
	return {
		state: startup.phase,
		reason: startup.failure?.category ?? "none",
		after_ready: afterReady,
		/*
		 * No duration for a server that died after ready (R2): that span is the
		 * session's uptime, and this field is the start-up distribution any
		 * change to the readiness budget is measured on.
		 */
		elapsed_s:
			afterReady || startup.settledAt == null
				? null
				: Math.max(
						0,
						Math.round((startup.settledAt - startup.startedAt) / 1000),
					),
	};
}

/**
 * The band's title and reason for a failed record. A server that died after it
 * was ready is not a failed START (UX round 1, U2): some D2 replays were of
 * that kind, and "could not start ... stopped before it finished starting" was
 * false for them and pointed toward reinstalling.
 */
export function failedBandCopy(startup: BackendStartup): {
	title: string;
	reason: string;
} {
	const failure = startup.failure;
	if (failure?.afterReady)
		return {
			title: t("ui.common.backend_startup.title_stopped"),
			reason: t("ui.common.backend_startup.reason.stopped"),
		};
	return {
		title: t("ui.common.backend_startup.title_failed"),
		reason: startupReasonSentence(
			failure?.category ?? "unknown",
			startup.budgetMs,
		),
	};
}
