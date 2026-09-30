import "../../../styles/index.css";
import { AgentsPage } from "@features/agents/components/agents-page";
import type { ReusableProfile } from "@shared/api/local-operator/profile-hooks";
import type { Meta, StoryObj } from "@storybook/react";
import {
	type FC,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import type {
	DesktopRequest,
	DesktopResponse,
} from "../../../../../shared/desktop-contract";

/**
 * The Class control on the Agents view: the four states a reader meets there,
 * and the two ends of one switch.
 *
 * WHY THIS FILE EXISTS. A class is the one property of an agent whose wrong
 * value, by the time the operator reads it, is an agent already messaging them
 * unprompted — so the control has to say what it will do BEFORE the press, and
 * the press itself has to be photographed with the same fidelity as the reading.
 * The states below are the four the brief names (loading, empty, error,
 * populated) plus the pair that makes a switch judgeable: the agent before the
 * press and the SAME screen after it, driven THROUGH the control rather than
 * through two fixtures, which would prove nothing about the write.
 *
 * REAL HERE: `AgentsPage`, its two-column layout and roster, `AgentDetail`'s
 * class section, the class module, and the desktop transport with its contract —
 * the whole path a press takes. STAND-IN: the backend, stubbed at
 * `window.api.desktop.request` (the bridge a packaged app injects), answering the
 * five ops this page reads from an in-memory world that the switch ACTUALLY
 * MUTATES. So the frame after a press shows a value that came back out of a read,
 * not one this file decided to draw. An op nobody stubbed throws, which is what
 * keeps a page that grows a new read from photographing an empty shell.
 *
 * THE PRESSES BELONG TO THE RIG, NOT TO THESE STORIES. `capture-evidence.mjs`'s
 * `press:` option drives the actual pointer through the input pipeline, which a
 * script's `element.click()` cannot honestly stand in for — Blink treats a
 * programmatic click as keyboard-ish for `:focus-visible`, so the frame would
 * carry a focus ring a mouse user never sees, on the one control these frames
 * exist to judge. What each press story owns is the other half: a
 * `data-capture-pending` latch that holds the shutter until the pressed state has
 * SETTLED, so the frame is the read-back and not the optimistic paint.
 */

/* ------------------------------------------------------------- the world -- */

type WorldProfile = ReusableProfile & { instructions: string };

const makeProfile = (
	over: Partial<WorldProfile> & { name: string },
): WorldProfile => ({
	kind: "role",
	source: "installed",
	agent_id: `agent-${over.name}`,
	description: "",
	tools: null,
	effort: null,
	delegate: false,
	instructions: "Do the work and report what changed.",
	...over,
});

/**
 * Three agents, one per state the roster can be in: a proactive chief of staff
 * (so the roster badge and the switch's on position are both on screen), a
 * reactive agent the two press stories actually switch, and a Custom one so the
 * three source words sit beside the class badge.
 *
 * A named agent rather than a literal so the frames do not imply that proactive
 * is a property of any ONE packaged profile — the class is a general mechanism
 * and this view is the general control for it.
 *
 * `packaged` renders her as a STARTER NOBODY HAS INSTALLED YET, which is the
 * state a fresh install is in, and it is not a cosmetic difference: a packaged
 * starter has no registry row, the profile route updates a row rather than
 * creating one, so a switch on this one writes an install first. She still reads
 * PROACTIVE here, because a packaged seed's own frontmatter carries the class —
 * `profile_detail` reads it from the seed whether or not the seed is installed —
 * so the `packaged-starter` frame is the exact picture of the one path that
 * writes two ops.
 */
const world = ({
	packaged = false,
}: { packaged?: boolean } = {}): WorldProfile[] => [
	makeProfile({
		name: "aida",
		source: packaged ? "builtin" : "installed",
		agent_id: packaged ? null : "agent-aida",
		description:
			"Your chief of staff: orchestrates agents and teams on your behalf, keeps an eye on everything in flight, and reports back.",
		action_class: "proactive",
		instructions:
			"You are the operator's chief of staff. You orchestrate; you do the work yourself only when it is small and simple.",
	}),
	makeProfile({
		name: "reviewer",
		description:
			"Reviews a diff for correctness, contract drift and missing evidence.",
		instructions: "Review the diff, not the author's summary of it.",
	}),
	makeProfile({
		name: "trend-scout",
		source: "custom",
		agent_id: null,
		description:
			"Watches a handful of sources and writes a short brief on what moved.",
	}),
];

const envelope = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { result },
});

/** A refusal in the transport's own envelope, so the page renders real copy. */
const refusal = (status: number, detail: string): DesktopResponse => ({
	status,
	body: { detail },
});

const CAPABILITIES = {
	desktop_contract: 1,
	desktop_available: true,
	desktop_auth: "bearer",
	features: { profile_catalogue: 1, team_catalogue: 1 },
};

type BridgeOptions = {
	/** Refuse the class write, the way a backend that rejects it would. */
	refuseClassWrite?: boolean;
	/** Never answer a detail read, for the loading frame. */
	holdDetail?: boolean;
};

/**
 * Install the desktop bridge over a world, answering the ops this page reads.
 *
 * The handler MUTATES the world on a class write and answers with the row it
 * wrote, so the frames after a press are produced by the same re-read the product
 * performs (React Query invalidates `["desktop"]` and the detail is fetched
 * again) rather than by this file's own idea of what the answer would be.
 */
const installBridge = (
	rows: WorldProfile[],
	{ refuseClassWrite = false, holdDetail = false }: BridgeOptions = {},
) => {
	const handler = async (request: DesktopRequest): Promise<DesktopResponse> => {
		switch (request.op) {
			case "capabilities":
				return envelope(CAPABILITIES);
			case "profiles.list":
				return envelope({ profiles: rows });
			case "profiles.get": {
				if (holdDetail) return new Promise<DesktopResponse>(() => {});
				const hit = rows.find((row) => row.name === request.name);
				if (!hit) return refusal(404, `No agent named ${request.name}.`);
				return envelope(hit);
			}
			/*
			 * Read on BOTH tabs, because the page reads both lists deliberately (so
			 * a screen can say what it means) — an unrouted op throws here rather
			 * than reaching a developer's live server.
			 */
			case "teams.list":
				return envelope({ teams: [] });
			case "settings.list":
				return envelope({ settings: [] });
			case "profiles.install": {
				const hit = rows.find((row) => row.name === request.name);
				if (!hit) return refusal(404, `No agent named ${request.name}.`);
				hit.source = "installed";
				return envelope(hit);
			}
			case "profiles.update": {
				if (refuseClassWrite)
					return refusal(
						422,
						"Value error, the class could not be written [type=value_error]",
					);
				const hit = rows.find((row) => row.name === request.name);
				if (!hit) return refusal(404, `No agent named ${request.name}.`);
				const fields = (request.fields ?? {}) as { action_class?: string };
				if (
					fields.action_class === "proactive" ||
					fields.action_class === "reactive"
				)
					hit.action_class = fields.action_class;
				return envelope(hit);
			}
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: { desktop?: { request: typeof handler } };
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: handler };
	return rows;
};

/* --------------------------------------------------------------- the rig -- */

const RouteTo = ({ path, children }: { path: string; children: ReactNode }) => {
	const navigate = useNavigate();
	useEffect(() => {
		navigate(path, { replace: true });
	}, [navigate, path]);
	return (
		<Routes>
			<Route path="/agents" element={children} />
			<Route path="/agents/:agentId" element={children} />
		</Routes>
	);
};

/**
 * The page's own shell and world.
 *
 * THE WORLD IS BUILT ONCE PER MOUNT and held in a ref, which is load-bearing
 * rather than tidy: a capture sweep re-renders the story once per theme, and a
 * world rebuilt on each of those renders would reset the agent a press had just
 * switched — so the "after" frame would be identical to the "before" one in
 * every theme but the first, and nothing would say so.
 */
const Scene: FC<{
	at: string;
	refuseClassWrite?: boolean;
	holdDetail?: boolean;
	packaged?: boolean;
	children?: ReactNode;
}> = ({
	at,
	refuseClassWrite = false,
	holdDetail = false,
	packaged = false,
	children,
}) => {
	const rows = useRef<WorldProfile[] | null>(null);
	rows.current ??= world({ packaged });
	/*
	 * A LAYOUT effect, so the bridge exists before any query effect can run: the
	 * page reads its catalogue on mount, and a stub installed afterwards would
	 * lose the race it is the only answer for.
	 */
	useLayoutEffect(() => {
		installBridge(rows.current as WorldProfile[], {
			refuseClassWrite,
			holdDetail,
		});
	}, [refuseClassWrite, holdDetail]);
	return (
		<div className="flex h-screen overflow-hidden bg-canvas">
			<RouteTo path={at}>
				<AgentsPage />
			</RouteTo>
			{children}
		</div>
	);
};

/**
 * Hold the shutter until the pressed state has SETTLED.
 *
 * WHY THIS IS A LATCH AND NOT A PRESS. The press itself belongs to the rig
 * (`press:` on the story's row in `capture-evidence.mjs`), which drives it
 * through the input pipeline — a script's `element.click()` is treated as
 * keyboard-ish by Blink for `:focus-visible`, so the frame would carry a focus
 * ring a mouse user never sees on the one control these frames exist to judge.
 * What the story owns is the OTHER half: the press produces a pending window
 * (the optimistic paint) and then a settled one (the read comes back), and a
 * shutter that fires on the first of those records a state no user sits on.
 *
 * `done` is re-evaluated on every DOM mutation rather than after a timeout,
 * because "wait a second" photographs whichever of the two the machine happened
 * to be showing on the day.
 *
 * A rig that never sees its condition leaves the flag UP rather than clearing it,
 * so a run that could not reach the state FAILS loudly instead of quietly
 * recording a frame of the wrong one (the failure mode `SettingsAtAppearance`
 * names from the other direction).
 */
const HoldShutterUntil: FC<{ done: () => boolean }> = ({ done }) => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		const settle = () => {
			if (done())
				document.documentElement.removeAttribute("data-capture-pending");
		};
		const observer = new MutationObserver(settle);
		observer.observe(document.body, { childList: true, subtree: true });
		settle();
		return () => {
			observer.disconnect();
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, [done]);
	return null;
};

/** The class control's own state, as the reader sees it. */
const switchIsOn = () =>
	document
		.querySelector('[data-testid="agent-class-switch"]')
		?.getAttribute("aria-checked") === "true";

/** Whether a roster row is showing the proactive badge. */
const rowSaysProactive = (name: string) =>
	Boolean(
		document
			.querySelector(`[data-testid="roster-row-${name}"]`)
			?.textContent?.includes("Proactive"),
	);

const meta: Meta = {
	title: "Agents/Class",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * POPULATED, reactive — the state nearly every agent is in: the switch is off,
 * the section says what the class means, and the roster says nothing about it
 * (reactive is the wire's absent value, so a badge would be a row of default).
 */
export const Reactive: Story = {
	render: () => <Scene at="/agents?kind=agent&name=reviewer" />,
};

/**
 * POPULATED, proactive — the state the switch produces. The roster badge and the
 * switch's position are the same fact read from the same payload.
 */
export const Proactive: Story = {
	render: () => <Scene at="/agents?kind=agent&name=aida" />,
};

/**
 * THE PACKAGED STARTER: a shipped agent nobody has installed yet, which is what
 * a fresh install's chief of staff looks like.
 *
 * WHY THIS ONE IS NOT LIKE THE OTHERS. A packaged starter has no registry row of
 * its own, and the profile route UPDATES a row rather than creating one — so the
 * switch here writes an install first, then the class. That is the backend's own
 * behaviour for a seeded role (`action_class.set_registered_action_class` does
 * exactly this), and it is a fact the reader has to be told BEFORE the press
 * rather than discover from a source chip that changed. Hence the third sentence
 * under the control, which appears only in this state.
 *
 * She reads proactive here, and that is the honest value rather than a choice
 * made for the frame: a packaged seed's frontmatter carries the class, and
 * `profile_detail` reads it from the seed whether or not the seed is installed.
 */
export const PackagedStarter: Story = {
	render: () => <Scene at="/agents?kind=agent&name=aida" packaged />,
};

/**
 * AFTER THE PRESS: the round trip, driven through the control.
 *
 * The RIG presses the switch (the `press` on this story's row in
 * `capture-evidence.mjs`); this holds the shutter until the ROSTER carries the
 * badge for the agent that was switched — a value that came back out of
 * `profiles.list` after the write — so the frame is evidence of the whole path
 * (press, write, invalidate, re-read) rather than of a component's local state.
 */
export const SwitchedOn: Story = {
	render: () => (
		<Scene at="/agents?kind=agent&name=reviewer">
			<HoldShutterUntil
				done={() => switchIsOn() && rowSaysProactive("reviewer")}
			/>
		</Scene>
	),
};

/**
 * ERROR: the write was refused.
 *
 * The same press against a backend that answers 422. Two things are on screen and
 * both are the point: the refusal is stated beside the switch in the page's own
 * refusal vocabulary (the pydantic envelope is stripped, as it is for every other
 * failure on this pane), and the switch is back OFF — the displayed state
 * reverted rather than sitting on the value the operator asked for.
 */
export const SwitchRefused: Story = {
	render: () => (
		<Scene at="/agents?kind=agent&name=reviewer" refuseClassWrite>
			<HoldShutterUntil
				done={() =>
					!switchIsOn() &&
					Boolean(document.querySelector('[data-testid="agent-class-error"]'))
				}
			/>
		</Scene>
	),
};

/**
 * LOADING: the detail read has not landed, so the pane is its own skeleton and
 * the class section is not drawn at all — a control that renders a value it does
 * not have yet is a control that guesses.
 */
export const Loading: Story = {
	render: () => <Scene at="/agents?kind=agent&name=reviewer" holdDetail />,
};

/** EMPTY: nothing selected, so the pane that names what the page is for. */
export const Empty: Story = {
	render: () => <Scene at="/agents?kind=agent" />,
};
