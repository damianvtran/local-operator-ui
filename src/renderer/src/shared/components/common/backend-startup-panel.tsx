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
	redactSecrets,
	startupDiagnosticsText,
} from "../../../../../shared/backend-startup";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import { trackProductEvent } from "../../analytics/product-events";
import {
	backendStatusEvent,
	claimBackendStatusReport,
	failedBandCopy,
	startupPanelPhase,
} from "./backend-startup-rules";

// Re-exported: the chat status strip and the onboarding modal import the show
// rule from the band they draw.
export {
	backendStatusEvent,
	claimBackendStatusReport,
	failedBandCopy,
	startupPanelPhase,
	startupReasonSentence,
} from "./backend-startup-rules";

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
		if (!startup) return;
		const event = backendStatusEvent(startup);
		if (!event) return;
		const key = `${startup.attempt}:${startup.phase}:${startup.startedAt}:${event.after_ready}`;
		if (reported.current === key) return;
		reported.current = key;
		if (!claimBackendStatusReport(key)) return;
		trackProductEvent("backend_status", event);
	}, [startup]);
}

type CopyState = "idle" | "copied" | "failed";

/**
 * How long the copy result stays beside the Copy diagnostics button (UX round
 * 1, U6). Long enough to read a two-word confirmation at a
 * glance, short enough that a second press later is not answered by a stale
 * "copied"; the polite live region announces the result once regardless.
 */
export const COPY_RESULT_MS = 3_000;

/**
 * A button label that keeps the width of its WIDEST state (design round 1, D3).
 *
 * The group is right-aligned, so a label that shrinks ("Restart server" ->
 * "Restarting…", 138 -> 82 px in ru) moved its siblings under the pointer. All
 * states are stacked in one grid cell: the cell takes the widest, the hidden
 * ones keep their space, and only the current one is visible and announced.
 */
const StableLabel = ({
	current,
	states,
}: {
	current: string;
	states: readonly string[];
}) => (
	<span className="inline-grid">
		{states.map((label) => (
			<span
				key={label}
				aria-hidden={label === current ? undefined : true}
				className={cn(
					"col-start-1 row-start-1 text-center",
					label === current ? "visible" : "invisible",
				)}
			>
				{label}
			</span>
		))}
	</span>
);

/**
 * Failures in a row at which pressing Restart again is no longer the lead act
 * (UX round 1, U4): the second identical failure is the first evidence that it
 * does not help, and the D1/D2 replays show people pressing Retry 6-8 times.
 */
export const REPEATED_FAILURE_THRESHOLD = 2;

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

	// The copy result returns to the label after a moment (U6).
	useEffect(() => {
		if (copy === "idle") return;
		const id = window.setTimeout(() => setCopy("idle"), COPY_RESULT_MS);
		return () => window.clearTimeout(id);
	}, [copy]);

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
		const seconds = Math.round(startup.budgetMs / 1000);
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
							// `ink-muted`, not `control`: the outline is what shows the
							// track's whole length, and `control` on `info-wash` fell to
							// 2.99:1 on one palette (design round 1, D4).
							className="h-1.5 max-w-md border border-ink-muted"
						/>
					</div>
				</Alert>
			</div>
		);
	}

	const failure = startup.failure;
	const stderr = failure?.stderrTail.trim() ?? "";
	const { title, reason } = failedBandCopy(startup);
	const failuresInRow = startup.failuresInRow ?? 1;
	const repeated = failuresInRow >= REPEATED_FAILURE_THRESHOLD;
	const restartLabels = [
		t("ui.common.backend_startup.action.restart"),
		t("ui.common.backend_startup.action.restarting"),
	] as const;
	return (
		<div
			className="shrink-0 px-6 py-1"
			data-testid="backend-startup-panel"
			data-phase="failed"
			data-after-ready={failure?.afterReady ? "true" : undefined}
		>
			<Alert
				variant="danger"
				// Top-aligned: the band grows when details open, and the mark stays
				// beside the title rather than drifting to the middle.
				className={cn(NOTICE_BAND, "items-start")}
				role={liveRole}
			>
				<div className="flex w-full min-w-0 flex-col gap-2">
					<div className="flex w-full min-w-0 flex-wrap items-center gap-2">
						{/*
						 * A real basis for the sentence (design round 1, D1): in a narrow
						 * chat pane or a long locale the action group wraps BELOW the
						 * reason instead of squeezing it into a ~118 px column.
						 */}
						<span className="min-w-[16rem] flex-1 basis-64 text-body-sm text-ink">
							{title}
							<span
								className="block text-meta text-ink-muted"
								data-testid="backend-startup-reason"
							>
								{reason}
							</span>
							{repeated ? (
								<span
									className="block text-meta text-ink-muted"
									data-testid="backend-startup-repeated"
								>
									{t("ui.common.backend_startup.repeated_failures", {
										count: failuresInRow,
									})}
								</span>
							) : null}
						</span>
						{/* No `shrink-0`: the group may wrap internally too (D1). */}
						<div className="flex flex-wrap items-center gap-1">
							{/*
							 * The copy result sits BESIDE the button the user just pressed
							 * (U6), not under the reason across the band, and clears after
							 * COPY_RESULT_MS. It is the group's first child: the group is
							 * right-aligned, so the text grows leftward and no button moves.
							 * Always mounted, so the polite region announces the change.
							 */}
							<span
								aria-live="polite"
								className="text-meta text-ink-muted"
								data-testid="backend-startup-copy-result"
							>
								{copy === "copied"
									? t("ui.common.backend_startup.action.copied")
									: copy === "failed"
										? t("ui.common.backend_startup.action.copy_failed")
										: ""}
							</span>
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
							{/*
							 * After a repeated failure, Copy diagnostics is the lead act and
							 * Restart steps back (U4): pressing Restart again has already
							 * been shown not to help.
							 */}
							<Button
								variant={repeated ? "secondary" : "ghost"}
								size="sm"
								onClick={copyDiagnostics}
								data-testid="backend-startup-copy"
								data-copy-state={copy}
							>
								{t("ui.common.backend_startup.action.copy_diagnostics")}
							</Button>
							<Button
								variant={repeated ? "ghost" : "secondary"}
								size="sm"
								onClick={restart}
								disabled={restarting}
								data-testid="backend-startup-restart"
							>
								<StableLabel
									current={restarting ? restartLabels[1] : restartLabels[0]}
									states={restartLabels}
								/>
							</Button>
						</div>
					</div>
					{showDetails && stderr ? (
						<pre
							data-testid="backend-startup-stderr"
							// A hairline edge: `sunken` on `danger-wash` is ~1.04:1 in light
							// themes, so the box had no visible boundary (design round 1, D5).
							className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-hairline bg-sunken p-2 font-mono text-meta text-ink"
						>
							{redactSecrets(stderr)}
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
