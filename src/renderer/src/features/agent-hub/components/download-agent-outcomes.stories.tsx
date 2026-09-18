/**
 * What a pull from the hub reports, for each of the four outcomes it can have.
 *
 * The pull's only user-visible surface is a toast plus the navigation that
 * follows it, and every one of these states used to read the same way: the
 * requested name, the mutation's own words, and "Agent downloaded". Two of them
 * are not clean successes — an agent the backend had to rename, and an agent that
 * landed beside a name this machine already holds (the case the local lookup's
 * case-sensitivity creates, contract D-4) — and one of them is a refusal whose
 * reason was hidden behind a transport prefix.
 *
 * These stories drive the REAL hook against a stubbed desktop transport, so what
 * is photographed is the shipped message and the shipped transport, and the
 * frames are held open with `toastDuration: Infinity` because a toast that
 * auto-closes is a frame that cannot be reproduced.
 *
 * What they do NOT prove: that the hub answers these shapes. `renamed_from` is
 * the backend contract of §3.6 and it IS on `main` now
 * (`resolve_import_name`, `local_operator/agents.py`), so the adjusted-name frame
 * is a recording of the shape the backend ships rather than a fixture of an
 * agreed one — the suffix included, which is a HYPHEN because the `" (N)"`
 * spelling the contract's prose used carries a space the hub's name rule
 * refuses, and a pull would hand the user an agent the hub will not take. The
 * hook keeps its second, cache-based arm anyway: a backend older than that fix
 * still lands a duplicate silently. They do not prove the navigation either: the app routes to the
 * created agent's id, which is asserted by the code path and by the end-to-end
 * run in the pull request, not by a still.
 */

import type { AgentDetails } from "@shared/api/local-operator/types";
import { resetToastDedup } from "@shared/utils/toast-manager";
import type { Meta, StoryObj } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import "../../../styles/index.css";
import { useDownloadAgentMutation } from "../hooks/use-download-agent-mutation";

/** The listing being pulled, as the hub's card names it. */
const HUB_AGENT_ID = "hub-1f4c9a";
const REQUESTED_NAME = "Inbox triage";

/** One agent already on this machine, for the collision case. */
const localAgent = (id: string, name: string): AgentDetails =>
	({
		id,
		name,
		description: "Already here.",
		created_date: "2026-01-01T00:00:00Z",
		version: "1.0.0",
		security_prompt: "",
		hosting: "",
		model: "",
	}) as AgentDetails;

type PullScenario = {
	/** What the hub answers with. */
	answer:
		| { kind: "ok"; name: string; renamedFrom?: string }
		| { kind: "refused"; status: number; code?: string; detail: string };
	/** Rows already cached locally, for the collision arm. */
	locals: AgentDetails[];
	/** The text the frame must contain before it is worth taking. */
	expect: string;
	/** What this case is, in one line, for the reader of the frame. */
	caption: string;
};

let scenario: PullScenario = {
	answer: { kind: "ok", name: REQUESTED_NAME },
	locals: [],
	expect: "Downloaded",
	caption: "",
};

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

const originalFetch = window.fetch;
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = typeof input === "string" ? input : input.toString();
	if (!url.includes("/__desktop")) return originalFetch(input, init);
	const request = JSON.parse(String(init?.body ?? "{}"));
	if (request.op !== "legacy.agent.download") {
		return json({
			status: 501,
			body: { detail: `the story stub does not model ${request.op}` },
		});
	}
	const answer = scenario.answer;
	if (answer.kind === "refused") {
		// The transport's envelope: the refusal's status travels, so the renderer's
		// ladder sees what a real backend has it see. A code makes it a typed
		// refusal; a bare string is what an older backend sends.
		return json({
			status: answer.status,
			body: {
				detail: answer.code
					? { code: answer.code, message: answer.detail, details: {} }
					: answer.detail,
			},
		});
	}
	return json({
		status: 200,
		body: {
			status: 200,
			message: "Agent downloaded from Radient successfully",
			result: {
				...localAgent("6f2b0d1e-0001-4a1e-9f00-0000000000ff", answer.name),
				...(answer.renamedFrom ? { renamed_from: answer.renamedFrom } : {}),
			},
		},
	});
}) as typeof window.fetch;

/** Polls for text, so the held frame is the state under test. */
const waitForText = async (root: ParentNode, text: string, timeout = 5000) => {
	const deadline = Date.now() + timeout;
	for (;;) {
		if ((root.textContent ?? "").includes(text)) return;
		if (Date.now() > deadline) throw new Error(`never rendered: ${text}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

/**
 * The harness: the real mutation, one pull, and the case named on screen.
 *
 * `capturePending` is set for the whole run and cleared once the toast is in the
 * DOM — the harness's own readiness signal, so no frame is taken mid-flight.
 */
const PullOutcome = () => {
	const download = useDownloadAgentMutation();
	const queryClient = useQueryClient();

	// Fired once per mount: a fixture that re-fires on every render produces a
	// different number of toasts per theme, and the mutation's own identity is
	// stable for the life of the mount.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the pull fires once, on mount
	useEffect(() => {
		void (async () => {
			document.documentElement.dataset.capturePending = "1";
			try {
				resetToastDedup();
				// Seeded before the mutation resolves, which is when the real cache
				// would hold the rows this machine already had.
				queryClient.setQueryData(["agents", { page: 1, perPage: 50 }], {
					agents: scenario.locals,
					total: scenario.locals.length,
					page: 1,
					per_page: 50,
				});
				await download.mutateAsync({
					agentId: HUB_AGENT_ID,
					agentName: REQUESTED_NAME,
				});
			} catch {
				// A refusal IS the state under test for two of these stories.
			}
			await waitForText(document.body, scenario.expect);
			delete document.documentElement.dataset.capturePending;
		})();
	}, []);

	return (
		<div className="mx-auto flex h-screen max-w-2xl flex-col justify-center gap-3 bg-canvas p-8">
			<h1 className="text-title">Pull from the hub</h1>
			<p className="text-body text-ink-muted">{scenario.caption}</p>
			<p className="text-body-sm text-ink">
				Requested: <span className="font-mono">{REQUESTED_NAME}</span>
			</p>
		</div>
	);
};

/** What a story states: everything except the local rows, which most cases have none of. */
type PullScenarioInput = Omit<PullScenario, "locals"> & {
	locals?: AgentDetails[];
};

const pullStory = (over: PullScenarioInput): StoryObj<typeof PullOutcome> => {
	const captured: PullScenario = { ...scenario, ...over };
	return {
		render: () => {
			scenario = captured;
			return <PullOutcome />;
		},
		// A toast that auto-closes cannot be re-photographed, and the dedup keys are
		// module state a fixture has to clear for itself.
		parameters: { toastDuration: Number.POSITIVE_INFINITY },
	};
};

const meta: Meta<typeof PullOutcome> = {
	title: "Agents/Pull outcomes",
	component: PullOutcome,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof PullOutcome>;

/** The clean case: the agent arrived under the name the hub published it as. */
export const Downloaded: Story = pullStory({
	answer: { kind: "ok", name: REQUESTED_NAME },
	expect: 'Downloaded "Inbox triage" from the hub.',
	caption:
		"No name was in the way, so the agent arrived under the hub's own name.",
});

/**
 * The backend renamed it on the way in, and the receipt says so — the reason
 * §3.6 asks for a `renamed_from`, and the reason the message must name what was
 * CREATED rather than what was requested.
 *
 * The suffix is a HYPHEN, because that is the shape the backend ships
 * (`resolve_import_name`: `Coder-2`). It is not the `" (N)"` spelling the
 * contract's prose used — that one carries a space, which the hub's name rule
 * refuses, so a renamed row could never be published.
 */
export const AdjustedName: Story = pullStory({
	answer: { kind: "ok", name: "Inbox triage-2", renamedFrom: REQUESTED_NAME },
	expect: 'Downloaded "Inbox triage-2"',
	caption:
		"The backend disambiguated the name, and the receipt quotes the name it collided with.",
});

/**
 * The SAME situation on a backend that has not disambiguated yet: the row landed
 * beside a name this machine already holds, which it then did silently. The hook
 * compares the created name against the rows already cached and says plainly that
 * two agents now answer to it — the one state that must never read as a clean
 * success, and the fallback arm for a backend older than the disambiguation.
 */
export const AlreadyHeld: Story = pullStory({
	answer: { kind: "ok", name: REQUESTED_NAME },
	locals: [localAgent("9a1e0f3b-0002-4a1e-9f00-0000000000aa", "inbox triage")],
	expect: "two agents now answer to that name",
	caption:
		"A backend that does not disambiguate: the local registry already held this name in another case, so the pull landed beside it.",
});

/** The refused case, with the reason from the code rather than from prose. */
export const Refused: Story = pullStory({
	answer: {
		kind: "refused",
		status: 404,
		code: "agent_not_found",
		detail: "Agent not found.",
	},
	expect: "is no longer on the hub",
	caption:
		"The listing is gone, so nothing was downloaded and nothing is worth retrying.",
});

/**
 * The refusal an OLDER backend sends: one prose string, with the transport's own
 * wrappers in it — the listing id, the connection-pool class, the host and the
 * port all arrive between the wrapper and the reason.
 *
 * The state this story is about is the CLASSIFICATION, not the stripping: what is
 * left once the machine voice comes off is a `requests` read timeout, which is
 * the retryable case, and it gets the sentence the `hub_unavailable` arm uses
 * rather than a Python exception repr. A frame of the raw residue is what the
 * round-1 review found here, so this fixture is the one that has to keep
 * producing a sentence a person can act on.
 */
export const RefusedProse: Story = pullStory({
	answer: {
		kind: "refused",
		status: 400,
		detail:
			"Error downloading agent from Radient: Failed to download agent hub-1f4c9a " +
			"from Radient Agent Hub due to a requests error: HTTPSConnectionPool(host='api.radienthq.com', port=443): Read timed out.",
	},
	expect: "The hub could not be reached",
	caption:
		"An older backend's single prose refusal: the transport's machine voice is stripped, and what remains is classified.",
});
