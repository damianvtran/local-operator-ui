/*
 * SCRATCH staging story for the design review of PR #484 — the per-row read
 * receipt's new copy surface (`features/chat/read-ack-notice.ts`).
 *
 * WHY THIS FILE EXISTS. The receipt's clause is drawn from one store record that
 * the transcript's receipt loop publishes; no shipped story renders the
 * transcript, so no shipped story can stage the clause. This file renders the
 * SHIPPED `ChatSidebar` (the surface that draws the clause) with the SHIPPED
 * store, and publishes the notice through the store's OWN action
 * (`publishReadAckNotice`, the same one the loop calls) so the component's own
 * subscription, its own clause lookup, its own `aria-describedby` wiring and its
 * own toast effect all run for real.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. It proves the DRAWING: the words, their
 * position in the row's flyout, the `sr-only` sentence and its association, and
 * the toast's sentence in the panel's own lane. It does NOT prove the
 * PUBLISHING: the loop's timing and the refusals that choose a kind are the
 * transcript hook's, and are not exercised here. A frame from this file is a
 * rendering check, not end-to-end evidence, and is labelled as such.
 *
 * It is NOT part of the repository: scratch worktree, deleted after the review.
 */
import { ChatSidebar } from "@renderer/features/chat/components/chat-sidebar";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { ThemedToastContainer } from "@shared/components/common/themed-toast-container";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useEffect, useState } from "react";
import { toast as sonnerToast } from "sonner";

/** The row the receipt waits on. */
const WAITING = "0f1e2d3c4b5a";
/** A row with nothing to say, drawn above it, for comparison. */
const QUIET = "1a2b3c4d5e6f";
/** The row marked current, so the waiting row is not the current one. */
const CURRENT = "2b3c4d5e6f70";
/** A row that is ALSO silent, so the two descriptions are composed together. */
const WEDGED = "3c4d5e6f7081";

const attention = (id: string) => ({
	conversation_id: `session/${id}`,
	completion_token: `tok-${id}`,
	anchor_id: `anchor-${id}`,
	kind: "complete" as const,
	unseen: true,
	revision: [1, 1] as [number, number],
	supported: true,
});

/** The `sessions.list` wire row, in the fields the sidebar reads. */
const wireRow = (
	id: string,
	name: string,
	mtime: number,
	status: { code: string; label: string },
	attn?: ReturnType<typeof attention>,
) => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: true,
	binding: { agent: null, team: null },
	pinned: false,
	archived: false,
	status,
	...(attn ? { attention: attn } : {}),
});

const ROSTER = [
	wireRow(QUIET, "Migrate the deploy script", 1_760_000_300, {
		code: "idle",
		label: "Recent",
	}),
	wireRow(
		WAITING,
		"Reconcile the supplier ledger",
		1_760_000_200,
		{ code: "complete", label: "Completed" },
		attention(WAITING),
	),
	wireRow(CURRENT, "Quarterly revenue model", 1_760_000_100, {
		code: "idle",
		label: "Recent",
	}),
	wireRow(
		WEDGED,
		"Re-run the nightly enrichment",
		1_760_000_050,
		{ code: "wedged", label: "No answer from the agent" },
		attention(WEDGED),
	),
];

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (request: { op: string }) => Promise<unknown>;
			};
		};
	};
	const api = (page.api ?? {}) as NonNullable<typeof page.api>;
	const desktop = (api.desktop ?? {}) as NonNullable<
		NonNullable<typeof page.api>["desktop"]
	>;
	const ok = (result: unknown) => ({ status: 200, body: { result } });
	desktop.request = async (request: { op: string }) => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { session_catalogue: 2, completion_ack_bulk: 1 },
				});
			case "sessions.list":
				return ok({ sessions: ROSTER, truncated: false });
			case "profiles.list":
				return ok({ profiles: [] });
			case "teams.list":
				return ok({ teams: [] });
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	api.desktop = desktop;
	page.api = api;
}

const sonnerToastForProbe = sonnerToast as unknown as {
	warning: (message: string, options?: unknown) => unknown;
};
const realWarningForProbe = sonnerToastForProbe.warning.bind(sonnerToastForProbe);
sonnerToastForProbe.warning = (message: string, options?: unknown) => {
	const page = window as unknown as { __warningCalls?: number; __lastWarning?: string };
	page.__warningCalls = (page.__warningCalls ?? 0) + 1;
	page.__lastWarning = message;
	const out = realWarningForProbe(message, options);
	page.__lastDismiss = (window as unknown as { __lastDismiss?: unknown }).__lastDismiss;
	return out;
};

const sonnerDismissProbe = sonnerToast as unknown as {
	dismiss: (id?: string | number) => unknown;
};
const realDismissForProbe = sonnerDismissProbe.dismiss.bind(sonnerDismissProbe);
sonnerDismissProbe.dismiss = (id?: string | number) => {
	const page = window as unknown as { __dismissCalls?: number };
	page.__dismissCalls = (page.__dismissCalls ?? 0) + 1;
	return realDismissForProbe(id);
};

const catalogueSettled = async (rows: number, timeoutMs = 4_000) => {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (useCanonicalSessionsStore.getState().sessions.length >= rows) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What the DOM says, in the frame.
 *
 * The clause has two channels and only one of them appears in a still without a
 * pointer: the flyout needs a hover, while the `sr-only` sentence and its
 * association are already in the document. This readout prints them, resolved
 * through the ids the button actually names, so a reader of the frame can check
 * the association rather than take it on trust.
 */

/*
 * PROBE (remediation round): a live readout of the three facts the frame cannot
 * show - which notice the store holds, how many toast elements are in the
 * document right now, and how many times the panel asked the lane to speak - plus
 * the sentence of the last request. It is here because a published notice that
 * renders its row clause and raises no toast is a state this harness has to
 * distinguish from one whose toast is simply not painted yet.
 */
const LiveProbe: FC = () => {
	const notice = useCanonicalSessionsStore((s) => s.readAckNotice);
	const [readout, setReadout] = useState("probe starting");
	useEffect(() => {
		const timer = setInterval(() => {
			const page = window as unknown as {
				__warningCalls?: number;
				__lastWarning?: string;
			};
			setReadout(
				`probe notice=${notice ? `${notice.kind}/${notice.revision}` : "none"} toaster=${document.querySelectorAll("[data-sonner-toaster]").length} toasts=${document.querySelectorAll("[data-sonner-toast]").length} box=${(() => { const el = document.querySelector("[data-sonner-toast]"); if (!el) return "none"; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)} mounted=${el.getAttribute("data-mounted")} op=${cs.opacity} vis=${cs.visibility} disp=${cs.display}`; })()} warningCalls=${page.__warningCalls ?? 0} dismissCalls=${page.__dismissCalls ?? 0} last=${JSON.stringify(page.__lastWarning ?? null)}`,
			);
		}, 250);
		return () => clearInterval(timer);
	}, [notice]);
	return <p data-probe-live>{readout}</p>;
};

const DomReadout: FC = () => {
	const [lines, setLines] = useState<string[]>([]);
	useEffect(() => {
		const measure = () => {
			const next: string[] = [];
			const notice = useCanonicalSessionsStore.getState().readAckNotice;
			const toasts = Array.from(
				document.querySelectorAll<HTMLElement>("[data-sonner-toast]"),
			);
			next.push(
				`notice: ${notice ? `${notice.kind} r${notice.revision} on ${notice.sessionId}` : "(none)"}`,
			);
			next.push(
				`sonner toast elements: ${toasts.length}${
					toasts.length
						? ` → ${toasts
								.map(
									(t) =>
										JSON.stringify(t.textContent?.trim() ?? ""),
								)
								.join(" | ")}`
						: ""
				}`,
			);
			/*
			 * THE FLYOUT'S OWN BOX, because a wrap is a claim about geometry: the
			 * still shows the second line and these numbers say whether the box hit its
			 * `max-w-64` ceiling or the sentence simply ran past it.
			 */
			const tip = document.querySelector<HTMLElement>("[role='tooltip']");
			if (tip) {
				const box = tip.getBoundingClientRect();
				const lines = Array.from(tip.querySelectorAll("span.block")).map((s) => {
					const rect = s.getBoundingClientRect();
					const lineHeight = Number.parseFloat(
						getComputedStyle(s).lineHeight || "0",
					);
					return `${JSON.stringify(s.textContent?.trim().slice(-42) ?? "")} ${Math.round(rect.width)}x${Math.round(rect.height)}${
						lineHeight > 0
							? ` (~${Math.round(rect.height / lineHeight)} lines)`
							: ""
					}`;
				});
				next.push(
					`flyout box: ${Math.round(box.width)}x${Math.round(box.height)} · ${lines.join(" | ")}`,
				);
			}
			for (const row of Array.from(
				document.querySelectorAll<HTMLElement>("[data-chat-row]"),
			)) {
				const described = row.getAttribute("aria-describedby");
				const name = row.textContent?.trim().slice(0, 34) ?? "?";
				const resolved = described
					? described
							.split(/\s+/)
							.map(
								(id) =>
									document.getElementById(id)?.textContent?.trim() ??
									`(missing #${id})`,
							)
							.join(" ")
					: "(no aria-describedby)";
				next.push(`${name} → ${resolved}`);
			}
			setLines(next);
		};
		measure();
		const timer = setInterval(measure, 200);
		return () => clearInterval(timer);
	}, []);
	return (
		<div className="space-y-2">
			{/*
			 * A press, not a timer: the toast lane's lifetime is sonner's own (4 s, the
			 * band container's default, which a second container cannot extend), so the
			 * only way to photograph the sentence is to raise it and capture inside that
			 * window. Clicking is also the shape the panel's own bulk refusal is raised in.
			 */}
			<div className="flex gap-2">
				<button
					type="button"
					data-probe-publish="pending"
					onClick={() => publish("pending")}
				>
					publish pending
				</button>
				<button
					type="button"
					data-probe-publish="offscreen"
					onClick={() => publish("offscreen")}
				>
					publish offscreen
				</button>
				<button
					type="button"
					data-probe-publish="unsettled-busy"
					onClick={() =>
						publish(
							"unsettled",
							new DesktopControlError(
								503,
								"Read state is busy right now. It will catch up on its own.",
								undefined,
								"store_busy",
							),
						)
					}
				>
					publish give-up (store busy)
				</button>
				<button
					type="button"
					data-probe-publish="unsettled-no-space"
					onClick={() =>
						publish(
							"unsettled",
							new DesktopControlError(
								507,
								"This computer is out of disk space, so the message could not be written. Free some space on the volume holding /Users/damian/Library/Application Support/local-operator and send it again.",
								undefined,
								"store_out_of_space",
							),
						)
					}
				>
					publish give-up (no space)
				</button>
			</div>
			<LiveProbe />
			<p className="text-ink">Accessible description per row, as the DOM has it</p>
			{lines.map((line) => (
				<p key={line} data-readout-desc>
					{line}
				</p>
			))}
		</div>
	);
};

const Page: FC = () => (
	<div className="flex h-screen overflow-hidden bg-canvas text-ink">
		<div className="w-[280px] shrink-0 border-hairline border-r">
			<ChatSidebar
				selectedConversation={CURRENT}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
		<div className="w-[560px] shrink-0 space-y-3 border-hairline border-l p-4 text-meta text-ink-muted">
			<DomReadout />
		</div>
		{/*
		 * THE LANE ITSELF, mounted by the STORY rather than relied on from the
		 * preview: with the preview's own container the panel's request reached the
		 * lane and nothing painted (`[data-sonner-toaster]` absent from the DOM), and
		 * a toast this harness cannot paint is a state it cannot photograph.
		 */}
		<ThemedToastContainer duration={Number.POSITIVE_INFINITY} />
	</div>
);

/** The store's own action, exactly as the receipt loop calls it. */
const publish = (
	kind: "pending" | "offscreen" | "unsettled",
	reason?: unknown,
	sessionId: string = WAITING,
) =>
	useCanonicalSessionsStore.getState().publishReadAckNotice(sessionId, kind, reason);

const meta = {
	title: "Design review/Read ack notice",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** BEFORE: the waiting row with no receipt notice, which is today's screen. */
export const Baseline: Story = {
	render: () => <Page />,
	play: async () => {
		await catalogueSettled(3);
		useCanonicalSessionsStore.getState().clearReadAckNotice(WAITING);
		await sleep(400);
	},
};

/** `pending` — the app is retrying promptly. */
export const Pending: Story = {
	render: () => <Page />,
	play: async () => {
		await catalogueSettled(3);
		publish("pending");
		await sleep(400);
	},
};

/** `offscreen` — the completion's result is not on screen. */
export const Offscreen: Story = {
	render: () => <Page />,
	play: async () => {
		await catalogueSettled(3);
		publish("offscreen");
		await sleep(400);
	},
};

/** `unsettled` — the ladder gave up, with a plain transport failure. */
export const Unsettled: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Page />,
	play: async () => {
		await catalogueSettled(3);
		/*
		 * TWO PUBLISHES. The first is the state the loop is in before it gives up and
		 * it also makes the SECOND one a change relative to whatever the panel last
		 * saw, so a Storybook re-render that remounted the sidebar between mount and
		 * the give-up arm cannot silently swallow the announcement (the panel seeds
		 * its "last announced" ref with whatever is published when it mounts).
		 */
		publish("pending");
		await sleep(700);
		publish("unsettled", new Error("The backend did not answer."));
		await sleep(700);
	},
};

/**
 * `unsettled` ON A ROW THAT IS ALSO SILENT, so the two `aria-describedby` clauses
 * the panel can put on one row are composed together in one description.
 */
export const SilentAndWaiting: Story = {
	render: () => <Page />,
	play: async () => {
		await catalogueSettled(4);
		publish("unsettled", new Error("The backend did not answer."), WEDGED);
		await sleep(600);
	},
};

/**
 * `unsettled` — the REALISTIC refusal, raised by a press in the frame so the
 * toast's own four-second life is not spent before the capture.
 */
export const GiveUpByPress: Story = {	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Page />,
	play: async () => {
		await catalogueSettled(3);
		publish("pending");
		await sleep(300);
	},
};

/**
 * `unsettled` — the REALISTIC refusal: a 503 `store_busy`, raised by the app's
 * own transport class with the backend's own sentence (the one
 * `scripts/store-refusal-copy.mjs` records for the ladder's busy arm).
 */
export const UnsettledStoreBusy: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Page />,
	play: async () => {
		await catalogueSettled(3);
		publish("pending");
			await sleep(700);
			publish(
				"unsettled",
				new DesktopControlError(
				503,
				"Read state is busy right now. It will catch up on its own.",
				undefined,
				"store_busy",
			),
		);
		await sleep(700);
	},
};
