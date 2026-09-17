/**
 * Evidence harness: the composer's status row, cleared from its own affordances.
 *
 * WHY A HARNESS RATHER THAN A STORY. The subject is an INTERACTION whose result is
 * the WIRE moving, and a story has no wire: the row's dismiss controls dispatch
 * `sessions.command` through the pickers' own channel
 * (`desktopResult` -> `window.api.desktop.request`), which Storybook's preview does
 * not implement — a story would have to install that bridge per story anyway. This
 * page installs it once, at exactly the seam the product uses, and lets each press
 * move the frontend state the row reads.
 *
 * WHAT IS AND IS NOT REAL HERE, stated rather than implied:
 *
 * - REAL: the shipped `ComposerStatusRow`, the shipped stylesheet and themes, the
 *   shipped command channel and request shape, the press itself (a DOM click on the
 *   control), the row's own gate (`frontend.goal`/`frontend.loop`) and the fact that
 *   the tab goes when the value goes.
 * - STUBBED: the BACKEND. The bridge records the request and answers the receipt the
 *   owner would answer, and the band then applies the effect that command has on the
 *   wire — `goal --clear` empties the goal, `loop --stop` turns a running loop idle.
 *   That is what a `sessions.command` receipt plus the next canonical frame look
 *   like from the renderer's side; the backend half of this pair is
 *   `local-operator`'s own change, and these frames make no claim about it.
 *
 * Three bands, one per path, each with its own `session_id`: the bridge ROUTES BY
 * SESSION the way a backend does, so a press in one band cannot move another.
 *
 * See `../README.md` for the served URL, the interaction, and what each frame is
 * and is not evidence of.
 */

import { ComposerStatusRow } from "@features/chat/components/composer-status-row";
import { ThemedToastContainer } from "@shared/components/common/themed-toast-container";
import { cn } from "@shared/lib/utils";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@renderer/styles/index.css";
import type { DesktopLoopState } from "../../../../src/shared/desktop-control-contract";
import type { CanonicalFrontendState } from "../../../../src/shared/desktop-session-contract";

/** The one request shape this page answers, read off `DesktopCommandRequest`. */
type CommandRequest = {
	op: string;
	sessionId: string;
	command: string;
	args: string;
};

/** What one band's wire carries; the row is a function of this and nothing else. */
type Wire = {
	goal: string;
	loop: DesktopLoopState | null;
};

const STANDING_GOAL = "Reconcile the March invoices";

const LOOP_RUNNING: DesktopLoopState = {
	status: "running",
	completed: 2,
	iterations: 5,
	goal: "",
	reason: "",
};

const LOOP_SETTLED: DesktopLoopState = {
	status: "achieved",
	completed: 5,
	iterations: 5,
	goal: "",
	reason: "",
};

/**
 * The three cases, each with the effect its command has on the wire.
 *
 * Written as the BACKEND's effect rather than as a UI assertion: the harness does
 * not remove the tab, it empties the field the tab is gated on.
 */
const CASES: Array<{
	sessionId: string;
	label: string;
	wire: Wire;
	effect: (wire: Wire) => Wire;
}> = [
	{
		sessionId: "clear-goal",
		label:
			"goal --clear: the X and Clear goal are held at rest, revealed by focus or hover, and the press clears the goal",
		wire: { goal: STANDING_GOAL, loop: null },
		effect: (wire) => ({ ...wire, goal: "" }),
	},
	{
		sessionId: "stop-loop",
		label:
			"loop --stop: the loop is running, the control says Stop loop, and the press settles it",
		wire: { goal: STANDING_GOAL, loop: LOOP_RUNNING },
		effect: (wire) => ({ ...wire, loop: null }),
	},
	{
		sessionId: "clear-loop",
		label:
			"loop --clear: the loop has settled, the same control says Clear loop, and the press takes it off the row",
		wire: { goal: "", loop: LOOP_SETTLED },
		effect: (wire) => ({ ...wire, loop: null }),
	},
	{
		sessionId: "refused",
		label:
			"a REFUSED command: the backend answers 503, the wire does not move, and the refusal is the app's own toast rather than silence",
		wire: { goal: STANDING_GOAL, loop: null },
		effect: (wire) => wire,
	},
];

/**
 * The sessions whose backend refuses, so the refusal path has a frame.
 *
 * A refusal leaves the row exactly as it was — the control is still there and still
 * revealed, because the pointer never left it — which is the state a still can show
 * only if the wire deliberately does not move.
 */
const REFUSING = new Set(["refused"]);

/** The bridge's routing table, keyed by the session the request is addressed to. */
const handlers = new Map<string, (request: CommandRequest) => void>();

/**
 * Install the desktop bridge, exactly as the Electron preload installs it.
 *
 * The request is recorded into the DOM by the band that owns it (a page-level
 * variable would be invisible to a screenshot, and the log line is half of what
 * these frames are for); what happens here is the transport's half only: route, and
 * answer the receipt the owner would answer.
 */
const installBridge = () => {
	(window as unknown as { api: unknown }).api = {
		desktop: {
			request: async (request: CommandRequest) => {
				handlers.get(request.sessionId)?.(request);
				if (REFUSING.has(request.sessionId)) {
					/*
					 * `desktopResult` turns a non-2xx into a `DesktopControlError` carrying this
					 * `detail`, and the row's own handler answers it with the app's error toast —
					 * the same path a real backend refusal takes.
					 */
					return {
						status: 503,
						body: { detail: "the backend refused: no standing goal to clear" },
					};
				}
				return {
					status: 200,
					body: {
						result: {
							command: request.command,
							result: {
								kind: "notice",
								text: `${request.command} ${request.args} ran.`,
								style: "success",
								data: {},
							},
						},
					},
				};
			},
		},
	};
};

installBridge();

/** One band: the row over its wire, with the log of what the bridge heard. */
const Band = ({
	sessionId,
	label,
	initial,
	effect,
}: {
	sessionId: string;
	label: string;
	initial: Wire;
	effect: (wire: Wire) => Wire;
}) => {
	const [wire, setWire] = useState<Wire>(initial);
	const [log, setLog] = useState<string[]>([]);

	useEffect(() => {
		// `effect` is a module constant for each case, so the entry is installed once per
		// band and removed with the band.
		handlers.set(sessionId, (request) => {
			setLog((previous) => [
				...previous,
				`${request.op} ${request.command} ${request.args} -> session ${request.sessionId}`,
			]);
			setWire((previous) => effect(previous));
		});
		return () => {
			handlers.delete(sessionId);
		};
	}, [sessionId, effect]);

	const frontend = {
		goal: wire.goal,
		session_id: sessionId,
		loop: wire.loop,
	} as CanonicalFrontendState;

	return (
		/*
		 * COMPACT ON PURPOSE: every band has to fit one viewport with its own wire and
		 * command lines, because a frame that needs scrolling is a frame whose claims are
		 * split across two files. The geometry is NOT printed here: it is the story set's
		 * `RowFacts`, whose frames are produced by a rig that can be trusted to measure
		 * after layout — a harness line measured before the first layout pass printed
		 * `row 32px` for a 900px row, and a wrong number in a caption is worse than no
		 * number at all.
		 */
		<div data-band={sessionId} className={cn("flex flex-col gap-1 py-2")}>
			<p data-case={sessionId} className={cn("text-body-sm text-ink")}>
				{label}
			</p>
			<div className={cn("@container/chatcol flex w-full flex-col")}>
				<ComposerStatusRow
					frontend={frontend}
					runDetails={null}
					isSmallView={false}
				/>
				{/* The box is a stand-in: the row's ground and its own vertical cost. */}
				<div
					className={cn(
						"flex w-full flex-col rounded-frame border border-control bg-surface p-2",
					)}
				>
					<p className={cn("text-body-sm text-ink-dim")}>
						A message would be typed here.
					</p>
				</div>
			</div>
			{/*
			 * The two lines a still cannot otherwise carry: what the WIRE now holds, and
			 * the request the press dispatched, in the bridge's own words.
			 */}
			<p data-wire={sessionId} className={cn("text-ink-dim text-meta")}>
				{`wire: goal ${JSON.stringify(wire.goal)} · loop ${
					wire.loop ? wire.loop.status : "none"
				}`}
			</p>
			<p data-log={sessionId} className={cn("text-ink-dim text-meta")}>
				{`commands: ${log.length === 0 ? "(none yet)" : log.join(" | ")}`}
			</p>
		</div>
	);
};

const THEME = new URLSearchParams(window.location.search).get("theme");
document.documentElement.dataset.theme = THEME ?? "localOperatorDark";

const App = () => (
	<div className={cn("flex flex-col bg-canvas p-4")}>
		{CASES.map((entry) => (
			<Band
				key={entry.sessionId}
				sessionId={entry.sessionId}
				label={entry.label}
				initial={entry.wire}
				effect={entry.effect}
			/>
		))}
		{/* The app's own toast host: a refusal is the one outcome this row speaks, and it
		 * speaks through the same channel the composer's other failures use. */}
		<ThemedToastContainer />
	</div>
);

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
