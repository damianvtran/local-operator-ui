/**
 * The passive Guard entries: one quiet row per pending consent prompt, and the
 * dialog a person opens from one.
 *
 * WHERE THIS LIVES, AND WHY NOT THE MESH TRAY. The desktop's approvals plane
 * (`GET /v1/desktop/approvals`) is one list, but its only on-screen reader is the
 * Mesh tray, and the Mesh row exists only for a device that belongs to a mesh
 * network. A Guard consent is a Team member's privacy choice and has nothing to do
 * with the mesh, so tying it to that tray would hide it from exactly the members
 * it is for. The entry therefore sits in Settings → Radient account (the account
 * surface that owns the rest of Guard) and the rail announces it with a count on
 * the Settings gear. The Mesh tray never draws it (`useMeshApprovals` drops guard
 * rows), so a prompt is never answerable from a surface that is about devices.
 *
 * NEVER A GENERIC APPROVE. This component builds no request itself: the Share
 * request comes from `guardShareRequest` and is sent only by the dialog's Share
 * button; Decline is `approvals.deny`. Nothing here reads an auto-approval mode,
 * the chat approval flow or a "approve all" action, so none of them can answer.
 *
 * NO FOCUS MOVES ON ARRIVAL. A prompt appearing changes the list this renders and
 * nothing else. The dialog opens only from the Review button's own click handler.
 */

import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Shield } from "lucide-react";
import { type FC, useEffect, useId, useMemo, useState } from "react";
import {
	GuardConsentDialog,
	type GuardDialogPhase,
} from "./guard-consent-dialog";
import { useGuardAnswer, useGuardPrompts, useGuardStatus } from "./guard-hooks";
import { type GuardPromptView, guardWaitingViews } from "./guard-prompt-model";

/** One passive row. Presentational: the Storybook state and the live list share it. */
export const GuardPromptEntry: FC<{
	view: GuardPromptView;
	onReview: () => void;
}> = ({ view, onReview }) => {
	useI18nLocale();
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			data-testid="guard-entry"
			className="flex items-start gap-3 rounded-sm border border-hairline bg-surface p-3"
		>
			<Shield
				className="mt-0.5 size-4 shrink-0 text-ink-muted"
				aria-hidden="true"
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5" dir="auto">
				<p id={headingId} className="text-body-sm text-ink">
					{view.title}
				</p>
				<p className="text-meta text-ink-muted">{view.reasonLine}</p>
			</div>
			<Button
				variant="secondary"
				size="sm"
				data-testid="guard-review"
				onClick={onReview}
			>
				{t("ui.guard.entry_review")}
			</Button>
		</section>
	);
};

type Session = {
	view: GuardPromptView;
	phase: GuardDialogPhase;
	notice?: string;
};

/** "Answered on <surface>" wording for the surface the host named. */
function surfaceName(via: string): string {
	switch (via) {
		case "tui":
			return t("ui.guard.surface_tui");
		case "desktop":
			return t("ui.guard.surface_desktop");
		case "mobile":
			return t("ui.guard.surface_mobile");
		default:
			return via;
	}
}

export const GuardPromptEntries: FC = () => {
	useI18nLocale();
	const prompts = useGuardPrompts();
	const status = useGuardStatus();
	const answer = useGuardAnswer();
	const views = useMemo(
		() => guardWaitingViews(prompts.data ?? []),
		[prompts.data],
	);
	const [session, setSession] = useState<Session | null>(null);

	/*
	 * A CARD ANOTHER SURFACE SETTLED WHILE THIS DIALOG WAS OPEN closes with
	 * "Answered on <surface>"; a NEWER prompt for the same org replaces it with
	 * "<Org> changed this request" (RFC §5.2.3, the terminal's screen_prompt_changed).
	 * Only an idle or failed dialog is reconciled: while an answer is in flight or
	 * its outcome is on screen, the row leaving the list is the answer's own effect.
	 */
	useEffect(() => {
		if (!session || (session.phase !== "idle" && session.phase !== "failed"))
			return;
		if (!prompts.isSuccess) return;
		if (views.some((v) => v.approvalId === session.view.approvalId)) return;
		const next = views.find((v) => v.tenant === session.view.tenant);
		if (next) {
			setSession({
				view: next,
				phase: "idle",
				notice: t("ui.guard.screen_prompt_changed", { org: next.org }),
			});
			return;
		}
		const via =
			status.data?.orgs.find((o) => o.tenant === session.view.tenant)
				?.answered_via ?? "";
		// Nothing names the surface: close quietly rather than word a guess.
		if (!via) {
			setSession(null);
			return;
		}
		setSession({ ...session, phase: "answered_elsewhere", notice: via });
	}, [views, prompts.isSuccess, session, status.data]);

	if (views.length === 0 && !session) return null;

	const settle = (
		phase: GuardDialogPhase,
		request: GuardPromptView["declineRequest"],
	) => {
		if (!session) return;
		const current = session;
		setSession({ ...current, phase: "working" });
		answer.mutate(request, {
			onSuccess: () => setSession({ ...current, phase }),
			onError: () => setSession({ ...current, phase: "failed" }),
		});
	};

	return (
		<div className="flex flex-col gap-3" data-testid="guard-entries">
			{views.map((view) => (
				<GuardPromptEntry
					key={view.approvalId}
					view={view}
					onReview={() => setSession({ view, phase: "idle" })}
				/>
			))}
			{session ? (
				<GuardConsentDialog
					view={session.view}
					open
					phase={session.phase}
					answeredOn={
						session.phase === "answered_elsewhere"
							? surfaceName(session.notice ?? "")
							: undefined
					}
					notice={
						session.phase === "answered_elsewhere" ? undefined : session.notice
					}
					onShare={() => {
						const request = session.view.shareRequest;
						// No Share request means the host did not offer one: send nothing.
						if (request) settle("shared", request);
					}}
					onDecline={() => settle("declined", session.view.declineRequest)}
					onLater={() => setSession(null)}
					onDone={() => setSession(null)}
				/>
			) : null}
		</div>
	);
};
