/**
 * The publish dialog, in every state it can be in.
 *
 * These frames are the evidence for the three things this dialog was rewritten
 * to do: say what is actually published, refuse before submitting when it can,
 * and give each refusal its own next step. They drive the SHIPPED component
 * against a stubbed desktop transport — the same `/__desktop` envelope the app
 * uses, carrying the same `{detail: {code, message, details}}` refusals the local
 * backend returns — and the refusal states are reached by PRESSING the two
 * controls that lead there (the consent box and Publish), because a treatment
 * rendered from a prop is not evidence that the flow reaches it.
 *
 * What the frames do NOT prove, stated here rather than left to a reader:
 * nothing about the hub. Every refusal in this file is a fixture of the shape the
 * local backend produces; whether the hub produces that shape for a real
 * duplicate name, a real reserved name and a real moderation decision is what the
 * end-to-end run in the pull request shows. Nor do they prove the consent copy
 * matches what the backend strips — that is a claim about `_EXPORT_SKIP_NAMES`
 * and the document builder, evidenced by the run, not by pixels.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { userEvent } from "@storybook/test";
import "../../../styles/index.css";
import { usePublishedListingsStore } from "@shared/store/published-listings-store";
import { useEffect } from "react";
import { UploadAgentDialog } from "./upload-agent-dialog";

/**
 * The agent every story publishes, in the shape the dialog needs.
 *
 * The name has no spaces on purpose: the hub refuses whitespace, so a fixture
 * named like a human would put the dialog in its blocked state instead of the
 * state the story is about.
 */
const AGENT = {
	id: "b7c1f2a4-0001-4a1e-9f00-000000000001",
	name: "adverse-media-screener",
	description:
		"Screens entities against adverse media and summarises the hits.",
	tags: ["role", "tools:web_search,read"],
};

/** One built-in, as `profiles.list` reports it: the list the hub reserves from. */
const BUILTIN = {
	name: "reviewer",
	kind: "role" as const,
	source: "builtin" as const,
	agent_id: "b7c1f2a4-0002-4a1e-9f00-000000000002",
	description: "Reviews a diff.",
	instructions: "You review diffs.",
	tools: ["read"],
	effort: "hi",
	delegate: false,
};

/** The scenario the stub answers with, set by the story that is rendering. */
type Scenario = {
	agent: typeof AGENT;
	profiles: (typeof BUILTIN)[];
	instructions: string;
	availability: {
		available: boolean;
		code?: string;
		details?: Record<string, unknown>;
	};
	/** The publication answer: a success envelope or a refusal. */
	publish:
		| { kind: "ok"; name: string; hubAgentId: string }
		| {
				kind: "refused";
				status: number;
				code: string;
				message: string;
				details?: unknown;
		  };
	/** A hub listing this app remembers for the agent, for the republish affordance. */
	listing?: { hubAgentId: string };
};

const scenarioOf = (over: Partial<Scenario> = {}): Scenario => ({
	agent: AGENT,
	profiles: [BUILTIN],
	instructions:
		"You screen entities from a supplied list against adverse media coverage and report the hits with their sources.",
	availability: { available: true },
	publish: { kind: "ok", name: AGENT.name, hubAgentId: "listing-7f3a" },
	...over,
});

let scenario: Scenario = scenarioOf();

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

/**
 * The transport's own envelope, not the payload: `/__desktop` answers
 * `{status, body}` and `desktopControlResponse` rebuilds a `Response` from those
 * two fields. A stub returning the bare payload renders as an empty state rather
 * than as the answer, which is how a fixture passes while proving nothing.
 */
const desktop = (body: unknown) => json({ status: 200, body });

/** A refusal, as the local backend returns it: the hub's status and a structured detail. */
const refused = (status: number, detail: unknown) =>
	json({ status, body: { detail } });

/*
 * Installed once, at module scope, for the reason `schedules.stories.tsx` is:
 * a fetch stub per story is a stub some story forgets. The scenario it reads is
 * module state the rendering story sets first.
 */
const originalFetch = window.fetch;
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = typeof input === "string" ? input : input.toString();
	if (!url.includes("/__desktop")) return originalFetch(input, init);
	const request = JSON.parse(String(init?.body ?? "{}"));
	switch (request.op) {
		case "profiles.list":
			return desktop({
				status: 200,
				message: "ok",
				result: { profiles: scenario.profiles },
			});
		case "legacy.agent.systemPrompt.get":
			return desktop({
				status: 200,
				message: "ok",
				result: { system_prompt: scenario.instructions },
			});
		case "agent.nameAvailability":
			return desktop({
				status: 200,
				message: "Name availability checked",
				result: {
					name: request.name,
					available: scenario.availability.available,
					...(scenario.availability.code
						? { code: scenario.availability.code }
						: {}),
					...(scenario.availability.details
						? { details: scenario.availability.details }
						: {}),
				},
			});
		case "agent.publish":
		case "agent.republish": {
			const answer = scenario.publish;
			if (answer.kind === "refused")
				return refused(answer.status, {
					code: answer.code,
					message: answer.message,
					details: answer.details ?? {},
				});
			return desktop({
				status: 200,
				message: "Agent published to Radient successfully",
				result: {
					agent_id: answer.hubAgentId,
					name: answer.name,
					version: "1.0.0",
					document_version: 1,
				},
			});
		}
		default:
			// An op this file does not model: refused loudly rather than answered with
			// an empty success, which would render as a state no user can reach.
			return json({
				status: 501,
				body: { detail: `the story stub does not model ${request.op}` },
			});
	}
}) as typeof window.fetch;

/** Seeds the store a republish needs, on the listing the scenario names. */
const seedRememberedListing = (seeded: Scenario) => {
	usePublishedListingsStore.setState({
		listings: {
			[seeded.agent.id]: {
				hubAgentId: seeded.listing?.hubAgentId ?? "listing-7f3a",
				name: seeded.agent.name,
				publishedAt: new Date().toISOString(),
			},
		},
	});
};

/** Clears the remembered-listing store on unmount, so one story cannot seed the next. */
const ClearListings = () => {
	useEffect(() => {
		return () => usePublishedListingsStore.setState({ listings: {} });
	}, []);
	return null;
};

/**
 * Waits for text to appear, so a `play` finishes on the state under test rather
 * than on whatever happened to have painted. A frame captured mid-flight would be
 * evidence of a state nobody asked about.
 */
const waitForText = async (
	root: ParentNode,
	text: string,
	timeout = 5000,
): Promise<void> => {
	const deadline = Date.now() + timeout;
	for (;;) {
		if ((root.textContent ?? "").includes(text)) return;
		if (Date.now() > deadline) throw new Error(`never rendered: ${text}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

/** Presses the consent box and then Publish, in that order, waiting for each to take. */
const submitPublication = async (canvasElement: HTMLElement): Promise<void> => {
	const consent = canvasElement.querySelector<HTMLElement>(
		'[data-testid="publish-consent"]',
	);
	if (!consent) throw new Error("the consent control is not on screen");
	await userEvent.click(consent);
	const deadline = Date.now() + 5000;
	for (;;) {
		const submit = canvasElement.querySelector<HTMLButtonElement>(
			'[data-testid="publish-submit"]',
		);
		if (submit && !submit.disabled) {
			await userEvent.click(submit);
			return;
		}
		if (Date.now() > deadline)
			throw new Error("the publish control never became available");
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

/**
 * Submits the form and holds the shutter until the named state is on screen.
 *
 * `capturePending` is the harness's own readiness signal (see
 * `scripts/capture-evidence.mjs`): without it a capture can land between the
 * click and the refusal, and the frame would evidence a state nobody asked
 * about. Cleared in `finally` so a story that never reaches its state fails the
 * capture by name instead of writing a frame of the form.
 */
const playTo =
	(text: string) =>
	async ({ canvasElement }: { canvasElement: HTMLElement }): Promise<void> => {
		document.documentElement.dataset.capturePending = "1";
		try {
			await submitPublication(canvasElement);
			await waitForText(canvasElement, text);
		} finally {
			delete document.documentElement.dataset.capturePending;
		}
	};

const meta: Meta<typeof UploadAgentDialog> = {
	title: "Agents/Publish dialog",
	component: UploadAgentDialog,
	parameters: { layout: "fullscreen" },
};

type Story = StoryObj<typeof UploadAgentDialog>;

/**
 * One story, built from one scenario.
 *
 * The scenario is assigned in `render`, not when the module loads: `args` is
 * plain data evaluated for every story in the file as it is imported, so a
 * module-level assignment there would leave every story reading the LAST
 * scenario in the file — the classic fixture that photographs the wrong state
 * and passes.
 */
const publishDialog = (
	over: Partial<Scenario> = {},
	seedListing = false,
): Story => {
	const captured = scenarioOf(over);
	return {
		args: {
			open: true,
			onClose: () => {},
			agent: captured.agent,
			isAuthenticated: true,
		},
		render: (args) => {
			scenario = captured;
			if (seedListing) seedRememberedListing(captured);
			return (
				<div className="flex min-h-screen items-center justify-center bg-canvas p-8">
					<ClearListings />
					<UploadAgentDialog {...args} />
				</div>
			);
		},
	};
};
export default meta;

/** The default state: what is published, what is not, and a name field that is free. */
export const Default: Story = publishDialog();

/**
 * The rules the dialog can enforce itself, all of them at once.
 *
 * Both sentence halves come from the same place the hub's rule text does — the
 * name rules from `publicationNameRule`, the cap from
 * `PUBLICATION_INSTRUCTIONS_MAX_CHARS` — and submit is disabled with the reasons
 * above it, which is the whole point of a pre-flight rather than a silent button.
 */
export const PreValidationBlocked: Story = publishDialog({
	agent: { ...AGENT, name: "Adverse media screener", description: "" },
	instructions: "",
});

/**
 * The name is already on the hub under another account, discovered after
 * submitting: the hub's own answer, not this dialog's opinion.
 */
export const NameTaken: Story = {
	...publishDialog({
		publish: {
			kind: "refused",
			status: 409,
			code: "name_taken",
			message:
				'The name "adverse-media-screener" is already published on the hub.',
			details: { existing_agent_id: "listing-other", owned_by_caller: false },
		},
	}),
	play: playTo("That name is taken"),
};

/**
 * The same code, owned by the caller: a different headline and a different next
 * step — "update that listing" rather than "pick another name". This pair is what
 * a single prose toast cannot carry.
 */
export const NameTakenByYou: Story = {
	...publishDialog(
		{
			publish: {
				kind: "refused",
				status: 409,
				code: "name_taken",
				message:
					'The name "adverse-media-screener" is already published on the hub.',
				details: { existing_agent_id: "listing-7f3a", owned_by_caller: true },
			},
		},
		true,
	),
	play: playTo("You already published this agent"),
};

/**
 * A built-in's name, caught BEFORE submitting — the name is compared by
 * `name_key` against the built-in rows `profiles.list` already returns, so this
 * refusal costs no round trip and works with no credential at all.
 */
export const ReservedBuiltin: Story = publishDialog({
	agent: { ...AGENT, name: "Reviewer" },
});

/**
 * The same refusal arriving from the hub instead: a machine whose built-in list
 * is older than the hub's manifest reserves a name this app does not know about,
 * so the hub is the one that refuses, and the built-in's own name is what the
 * author is told to stop using.
 */
export const ReservedBuiltinRefusal: Story = {
	...publishDialog({
		profiles: [],
		publish: {
			kind: "refused",
			status: 409,
			code: "name_reserved_builtin",
			message:
				'The name "adverse-media-screener" is reserved by the built-in agent "reviewer".',
			details: {
				builtin_name: "reviewer",
				builtin_source_url: "https://example.invalid/reviewer",
			},
		},
	}),
	play: playTo("That name is reserved"),
};

/**
 * The reviewer refused the instructions. A content decision, so there is no retry
 * — retrying cannot change the answer — and the category line is what the author
 * has to act on.
 */
export const ModerationRejected: Story = {
	...publishDialog({
		publish: {
			kind: "refused",
			status: 422,
			code: "moderation_rejected",
			message:
				"This agent was not accepted for publication: the instructions build a page that collects entered passwords.",
			details: {
				categories: ["fraud_or_deception"],
				reason:
					"the instructions build a page that collects entered passwords.",
			},
		},
	}),
	play: playTo("This agent was not accepted"),
};

/**
 * The review could not run. A WARNING and a retry, and the sentence says outright
 * that nothing was published — the distinction that keeps an outage from reading
 * as a rejection.
 */
export const ModerationUnavailable: Story = {
	...publishDialog({
		publish: {
			kind: "refused",
			status: 503,
			code: "moderation_unavailable",
			message:
				"Publication review is temporarily unavailable. Try again shortly.",
			details: { attempts: 2 },
		},
	}),
	play: playTo("Review is temporarily unavailable"),
};

/** The hub accepted it, and the receipt repeats what left the machine. */
export const Published: Story = {
	...publishDialog(),
	play: playTo("Published to the hub"),
};

/**
 * The republish affordance, which needs the hub listing id.
 *
 * Seeded from the store rather than from a previous story, because the store is
 * persisted and a story that depended on a sibling having run would produce a
 * frame nothing could reproduce.
 */
export const UpdateListing: Story = publishDialog({}, true);
