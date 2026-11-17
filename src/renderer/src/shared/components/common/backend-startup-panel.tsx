/**
 * The app-level band for this app's OWN server while it starts, and when it
 * could not start.
 *
 * WHY ONE BAND. A failed first start used to surface as a native "check the
 * logs" box and a quit, and - when the app stayed up - as a scatter of "Server
 * is offline. Please check your connection." from each hook that gates on the
 * server. PostHog (desktop project, 30 days to 2026-11-17): those errors sit in
 * 82 Windows users' sessions, 26% of Windows users. Main now records why the
 * start failed (`src/shared/backend-startup.ts`); this band is the one place
 * that says it, with the two acts that help: Restart, and Copy diagnostics for
 * a support thread. It replaces the connectivity banner while it shows, so the
 * window carries one statement about the server, not two.
 *
 * The progress is measured against main's own readiness budget, carried on the
 * record, so the bar fills at the rate the deadline approaches; it never claims
 * 100% - only main's `ready` ends the start, and the band leaves then.
 */
import { useChatStatusStripPresent } from "@features/chat/chat-status-presence";
import { NOTICE_BAND } from "@shared/components/common/notice-band";
import { Alert, Button, Progress } from "@shared/components/ui";
import { useServerHealth } from "@shared/hooks/use-connectivity-status";
import { cn } from "@shared/lib/utils";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../../../i18n/messages";
import {
	type BackendStartup,
	type BackendStartupCategory,
	startupDiagnosticsText,
} from "../../../../../shared/backend-startup";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import { trackProductEvent } from "../../analytics/product-events";

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
				seconds: String(Math.round(budgetMs / 1000)),
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
 */
export function startupPanelPhase(
	snapshot: Pick<DaemonStatusSnapshot, "state" | "startup"> | null,
): "starting" | "failed" | null {
	const startup = snapshot?.startup ?? null;
	if (!startup) return null;
	if (startup.phase === "starting") return "starting";
	if (
		startup.phase === "failed" &&
		snapshot?.state !== "attached" &&
		snapshot?.state !== "degraded"
	)
		return "failed";
	return null;
}

/** The share of the budget elapsed, capped below 100 (see the header). */
export function startupProgressPercent(
	startup: Pick<BackendStartup, "startedAt" | "budgetMs">,
	now: number,
): number {
	if (startup.budgetMs <= 0) return 0;
	const share = ((now - startup.startedAt) / startup.budgetMs) * 100;
	return Math.max(0, Math.min(95, Math.round(share)));
}

/**
 * `backend_status` once per settled phase of each attempt, from whichever
 * window reads it - including the launch's first start, which settles before
 * the window exists and is read from the snapshot when it loads. Carries the
 * category and the whole seconds the attempt took: the distribution any future
 * change to the readiness budget has to be measured against (none is changed
 * here). Mounted by the always-present connectivity banner, so a `ready` is
 * reported even though this band is not on screen for it.
 */
export function useBackendStartupTelemetry(
	startup: BackendStartup | null | undefined,
): void {
	const reported = useRef<string | null>(null);
	useEffect(() => {
		if (!startup || startup.phase === "starting") return;
		const key = `${startup.attempt}:${startup.phase}:${startup.startedAt}`;
		if (reported.current === key) return;
		reported.current = key;
		trackProductEvent("backend_status", {
			state: startup.phase,
			reason: startup.failure?.category ?? "none",
			elapsed_s:
				startup.settledAt == null
					? null
					: Math.max(
							0,
							Math.round((startup.settledAt - startup.startedAt) / 1000),
						),
		});
	}, [startup]);
}

type CopyState = "idle" | "copied" | "failed";

export const BackendStartupPanel = ({
	snapshot,
}: {
	snapshot: DaemonStatusSnapshot;
}) => {
	const phase = startupPanelPhase(snapshot);
	const startup = snapshot.startup ?? null;
	const [now, setNow] = useState(() => Date.now());
	const [restarting, setRestarting] = useState(false);
	const [copy, setCopy] = useState<CopyState>("idle");
	const [showDetails, setShowDetails] = useState(false);

	// A once-a-second tick drives the bar while starting; nothing ticks otherwise.
	useEffect(() => {
		if (phase !== "starting") return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [phase]);

	if (!phase || !startup) return null;

	const restart = () => {
		if (restarting) return;
		setRestarting(true);
		setCopy("idle");
		void (async () => {
			try {
				await window.api?.backend?.restart?.();
			} finally {
				setRestarting(false);
			}
		})();
	};

	const copyDiagnostics = () => {
		void (async () => {
			try {
				const [appVersion, platform] = await Promise.all([
					window.api?.systemInfo?.getAppVersion?.().catch(() => null) ?? null,
					window.api?.systemInfo
						?.getPlatformInfo?.()
						.then((info) => `${info.platform} ${info.arch}`)
						.catch(() => null) ?? null,
				]);
				await navigator.clipboard.writeText(
					startupDiagnosticsText(startup, {
						appVersion,
						platform,
						state: snapshot.state,
						url: snapshot.url,
						detail: snapshot.detail,
					}),
				);
				setCopy("copied");
			} catch {
				setCopy("failed");
			}
		})();
	};

	/*
	 * ONE BAND GRAMMAR with the chat status strip and the compatibility banner
	 * (design note section 3): `Alert` wearing `NOTICE_BAND`, inset in a 24px
	 * gutter, one primary remedy per band, severity carried by hue and copy.
	 */
	// `status` for a start in progress (it leaves a working app), `alert` for a
	// failure (it interrupts a send) - the chat status strip's rule.
	const liveRole: "status" | "alert" =
		phase === "starting" ? "status" : "alert";
	if (phase === "starting") {
		const seconds = String(Math.round(startup.budgetMs / 1000));
		return (
			<div
				className="shrink-0 px-6 py-1"
				data-testid="backend-startup-panel"
				data-phase="starting"
			>
				<Alert variant="info" className={NOTICE_BAND} role={liveRole}>
					<div className="flex w-full min-w-0 flex-col gap-1.5">
						<span className="text-body-sm text-ink">
							{t("ui.common.backend_startup.title_starting")}
							<span className="block text-meta text-ink-muted">
								{t("ui.common.backend_startup.detail_starting", { seconds })}
							</span>
						</span>
						<Progress
							value={startupProgressPercent(startup, now)}
							max={100}
							aria-label={t("ui.common.backend_startup.progress_label")}
							className="h-1.5 max-w-md border border-control"
						/>
					</div>
				</Alert>
			</div>
		);
	}

	const failure = startup.failure;
	const stderr = failure?.stderrTail.trim() ?? "";
	return (
		<div
			className="shrink-0 px-6 py-1"
			data-testid="backend-startup-panel"
			data-phase="failed"
		>
			<Alert variant="danger" className={NOTICE_BAND} role={liveRole}>
				<div className="flex w-full min-w-0 flex-col gap-2">
					<div className="flex w-full min-w-0 flex-wrap items-center gap-2">
						<span className="min-w-0 flex-1 text-body-sm text-ink">
							{t("ui.common.backend_startup.title_failed")}
							<span
								className="block text-meta text-ink-muted"
								data-testid="backend-startup-reason"
							>
								{startupReasonSentence(
									failure?.category ?? "unknown",
									startup.budgetMs,
								)}
							</span>
							{/* The result of the press the user just made, announced politely. */}
							<span
								aria-live="polite"
								className={cn(
									"block text-meta text-ink-muted",
									copy === "idle" && "sr-only",
								)}
							>
								{copy === "copied"
									? t("ui.common.backend_startup.action.copied")
									: copy === "failed"
										? t("ui.common.backend_startup.action.copy_failed")
										: ""}
							</span>
						</span>
						<div className="flex shrink-0 flex-wrap items-center gap-1">
							{stderr ? (
								<Button
									variant="ghost"
									size="sm"
									aria-expanded={showDetails}
									onClick={() => setShowDetails((open) => !open)}
								>
									{showDetails
										? t("ui.common.backend_startup.details.hide")
										: t("ui.common.backend_startup.details.show")}
								</Button>
							) : null}
							<Button
								variant="ghost"
								size="sm"
								onClick={copyDiagnostics}
								data-testid="backend-startup-copy"
							>
								{t("ui.common.backend_startup.action.copy_diagnostics")}
							</Button>
							<Button
								size="sm"
								onClick={restart}
								disabled={restarting}
								data-testid="backend-startup-restart"
							>
								{restarting
									? t("ui.common.backend_startup.action.restarting")
									: t("ui.common.backend_startup.action.restart")}
							</Button>
						</div>
					</div>
					{showDetails && stderr ? (
						<pre
							data-testid="backend-startup-stderr"
							className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-sunken p-2 font-mono text-meta text-ink"
						>
							{stderr}
						</pre>
					) : null}
				</div>
			</Alert>
		</div>
	);
};

/**
 * The band for routes the chat status strip does not cover.
 *
 * The chat pane's strip draws this band itself when it is mounted (it is the
 * conversation's one status voice); everywhere else - Settings, where a first
 * run goes to connect a provider - this gate draws it, so the failure is
 * stated on whatever screen the user is on. It also hosts the `backend_status`
 * telemetry, being the one instance mounted for the app's whole life.
 */
export const BackendStartupGate = () => {
	const { data } = useServerHealth();
	const snapshot = data?.snapshot ?? null;
	const stripPresent = useChatStatusStripPresent();
	useBackendStartupTelemetry(snapshot?.startup);
	if (stripPresent || !snapshot || !startupPanelPhase(snapshot)) return null;
	return <BackendStartupPanel snapshot={snapshot} />;
};
