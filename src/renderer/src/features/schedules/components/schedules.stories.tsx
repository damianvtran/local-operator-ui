import type { ScheduleResponse } from "@shared/api/local-operator";
import type {
	DesktopWakeEntry,
	DesktopWakeSupervisor,
} from "@shared/api/local-operator/wakes-api";
/**
 * The schedules surface: the page's rows, its states, and the create dialog.
 *
 * `window.fetch` is stubbed at the boundary for every operation this page
 * issues - the wake listing, the legacy schedule list and the agent lookup the
 * legacy rows do for their owner name - so the real page, the real query layer,
 * the real row components and the real dialog all run.
 *
 * ## Every instant here is PINNED, and that is the point
 *
 * The page's labels are a function of the clock twice over: a due label prints
 * a time of day (and a date when the instant is not today), and the create
 * dialog's `Tonight at 8:00 PM` preset exists only while tonight's 8pm is still
 * ahead. A fixture built from `hoursFromNow` therefore makes every frame churn
 * on every recapture, and a diff that churns cannot be read as "here is what
 * moved" - the lesson the surface's previous fixtures recorded after 39 of 41
 * frames changed on a capture where no schedules code had changed at all.
 *
 * So the fixtures are absolute instants around one pinned `FIXTURE_NOW_MS`, and
 * the page takes that instant as a prop (`SchedulesPage`'s `nowMs`) exactly as
 * the run pane's model does.
 */
import { DateTimePicker } from "@shared/components/common/date-time-picker";
import { apiConfig } from "@shared/config/api-config";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import "../../../styles/index.css";
import {
	ScheduledTaskDialog,
	type WakeEditTarget,
} from "./scheduled-task-dialog";
import { SchedulesPage } from "./schedules-page";

/**
 * The instant every label in these stories is derived from.
 *
 * Sunday 15 March 2026, 2:00 PM local. Every due instant below is an offset from
 * THIS value, so the frames say the same thing on every capture that runs.
 */
/** The dialog's own conversation select, by the id the dialog gives it. */
const CONVERSATION_SELECTOR = '[id$="-conversation"]';

const FIXTURE_NOW_MS = new Date(2026, 2, 15, 14, 0, 0, 0).getTime();

/** An instant `minutes` after the pinned now. */
const at = (minutes: number): number => FIXTURE_NOW_MS + minutes * 60_000;

const SUPERVISOR: DesktopWakeSupervisor = {
	supported: true,
	running: true,
	detail: "running",
};

/** One wake row, with the defaults a test or a frame does not care about. */
const wake = (
	id: string,
	minutes: number,
	message: string,
	extra: Partial<DesktopWakeEntry["schedules"][number]> = {},
): DesktopWakeEntry["schedules"][number] => ({
	id,
	message,
	next_due_at: at(minutes),
	every_ms: null,
	until_at: null,
	limit: null,
	fired_count: 0,
	overdue_s: 0,
	stale: false,
	last_fired_at: null,
	last_attempt_at: null,
	...extra,
});

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** One conversation with wakes. */
const conversation = (
	sessionId: string,
	name: string,
	cwd: string,
	schedules: DesktopWakeEntry["schedules"],
	extra: Partial<DesktopWakeEntry> = {},
): DesktopWakeEntry => {
	const due = schedules
		.map((schedule) => schedule.next_due_at)
		.filter((value): value is number => typeof value === "number");
	return {
		session_id: sessionId,
		name,
		cwd,
		origin: "",
		updated_at: at(-30),
		dormant: false,
		ghost: false,
		next_due_at: due.length > 0 ? Math.min(...due) : null,
		schedules,
		...extra,
	};
};

/**
 * The editor's conversation: four wakes, so the dialog's context line can name
 * the one being edited (`Invoices workspace · wake 2 of 4`), and the wake in
 * position 2 is the recurring one whose cadence and bound the `keep` labels have
 * to state.
 */
const EDIT_WAKES: DesktopWakeEntry[] = [
	conversation("c0ffee123456", "Invoices workspace", "~/invoices", [
		wake("w1", 26, "Read my unread email and send me one summary message."),
		wake(
			"w2",
			120,
			"Pull last week's revenue and refunds from the finance sheet and write a short digest with the three biggest movers.",
			{ every_ms: 24 * HOUR_MS, fired_count: 3 },
		),
		wake("w3", 320, "Flag any invoice that is more than 30 days overdue."),
		wake("w4", 400, "Tidy the scratch directory and tell me what was removed."),
	]),
];

/** The edit target for one of `EDIT_WAKES`' wakes, by id. */
const editTarget = (
	entries: DesktopWakeEntry[],
	wakeId: string,
	position: number,
): WakeEditTarget => {
	const entry = entries[0];
	const row = entry.schedules.find((schedule) => schedule.id === wakeId);
	if (!row) throw new Error(`no wake ${wakeId} in the fixture`);
	return {
		sessionId: entry.session_id,
		wakeId,
		message: row.message,
		conversationName: entry.name,
		position,
		count: entry.schedules.length,
		wake: row,
		parked: entry.dormant === true,
	};
};

const ONE_WAKE: DesktopWakeEntry[] = [
	conversation("a1b2c3d4e5f6", "Invoices workspace", "~/invoices", [
		wake(
			"w1",
			26,
			"Read my unread email, group it by whether it needs a reply today, and send me one summary message.",
		),
	]),
];

const THREE_WAKES: DesktopWakeEntry[] = [
	conversation("a1b2c3d4e5f6", "Invoices workspace", "~/invoices", [
		/* Published out of due order on purpose: the page sorts them, and a frame
		   that showed the sort's answer without the wire's order would not prove
		   the sort happened. */
		wake(
			"w2",
			555,
			"After the nightly backup finishes, check it restored cleanly and tell me only if it did not.",
			{
				every_ms: 6 * HOUR_MS,
			},
		),
		wake(
			"w1",
			26,
			"Read my unread email, group it by whether it needs a reply today, and send me one summary message.",
			{
				every_ms: 90 * MINUTE_MS,
				limit: 4,
				fired_count: 1,
			},
		),
		wake(
			"w3",
			90,
			"Summarise the pre-market movers and flag anything on my watchlist.",
		),
	]),
];

const MANY: DesktopWakeEntry[] = [
	...ONE_WAKE,
	conversation("111111111111", "Weekly finance digest", "~/finance", [
		wake(
			"w1",
			120,
			"Pull last week's revenue and refunds and write a short digest with the three biggest movers.",
			{
				every_ms: 24 * HOUR_MS,
				fired_count: 3,
			},
		),
		wake("w2", 320, "Flag any invoice that is more than 30 days overdue."),
	]),
	conversation("222222222222", "Site uptime watch", "~/infra", [
		wake(
			"w1",
			14,
			"Check that the status page is up and tell me only if it is not.",
			{
				every_ms: 15 * MINUTE_MS,
				fired_count: 42,
			},
		),
	]),
	conversation("333333333333", "Competitor news", "~/market", [
		wake(
			"w1",
			480,
			"Search for news about our three closest competitors and send me anything that mentions pricing.",
			{
				every_ms: 24 * HOUR_MS,
				limit: 10,
				fired_count: 2,
			},
		),
		wake(
			"w2",
			1_500,
			"Check the changelog of the two libraries we depend on most.",
			{
				every_ms: 7 * 24 * HOUR_MS,
			},
		),
		wake(
			"w3",
			2_000,
			"Send me a Friday summary of everything the competitors shipped this week.",
		),
		wake(
			"w4",
			2_600,
			"Look for new pricing pages and screenshot anything that changed.",
			{
				every_ms: 7 * 24 * HOUR_MS,
			},
		),
	]),
	conversation("444444444444", "Standup notes", "~/team", [
		wake(
			"w1",
			1_020,
			"Collect yesterday's commits and open pull requests into a short standup note.",
			{
				every_ms: 24 * HOUR_MS,
				fired_count: 1,
			},
		),
	]),
	conversation("555555555555", "Nightly cleanup", "~/workspace", [
		wake(
			"w1",
			1_080,
			"Tidy the scratch directory and tell me what was removed.",
			{
				every_ms: 24 * HOUR_MS,
				limit: 30,
				fired_count: 4,
			},
		),
	]),
];

const PARKED: DesktopWakeEntry[] = [
	conversation(
		"a1b2c3d4e5f6",
		"Invoices workspace",
		"~/invoices",
		[
			wake(
				"w1",
				26,
				"Read my unread email, group it by whether it needs a reply today, and send me one summary message.",
				{
					every_ms: 24 * HOUR_MS,
					fired_count: 2,
				},
			),
		],
		{ dormant: true },
	),
	...MANY.slice(1, 3),
];

/**
 * A conversation whose only wake was a one-shot that has FIRED is absent from
 * this frame, deliberately: a spent one-shot retires out of the schedule list,
 * so its absence IS the state (`docs/composer-wakes.md` section 5's rule, and
 * the honest answer here too - the record of what happened is a delivery row
 * inside the conversation). The recurring wake beside it shows `Ran 3 times`,
 * which is how a row that is working does not read as untouched.
 */
const SPENT: DesktopWakeEntry[] = [
	conversation("111111111111", "Weekly finance digest", "~/finance", [
		wake(
			"w1",
			120,
			"Pull last week's revenue and refunds and write a short digest with the three biggest movers.",
			{
				every_ms: 24 * HOUR_MS,
				fired_count: 3,
			},
		),
	]),
];

const AGENTS = [
	{ id: "3f21c0aa-1d55-4a8b-9a1e-27a4f0d9b111", name: "Inbox triage" },
	{ id: "8c04b7e2-93f1-4c0d-8d2a-11f4e6c7a222", name: "Weekly finance digest" },
];

/**
 * The legacy rows, in the older engine's own field names.
 *
 * Pinned like everything else here: the cadence's bounds are absolute instants,
 * so a fixture built from "now" would print a different day in every frame.
 */
const LEGACY_SCHEDULES: ScheduleResponse[] = [
	{
		id: "9b2f4c11-63ea-4c7f-9d18-4f60a2c7d001",
		agent_id: AGENTS[0].id,
		prompt:
			"Read my unread email, group it by whether it needs a reply today, and send me one summary message.",
		interval: 1,
		unit: "hours",
		is_active: true,
		one_time: false,
		start_time_utc: new Date(2026, 2, 15, 9, 16, 0, 0).toISOString(),
		end_time_utc: null,
		created_at: new Date(2026, 2, 12, 9, 0, 0, 0).toISOString(),
	},
	{
		id: "6f708192-2c3d-4e5f-9a0b-c1d2e3f4a5b6",
		agent_id: AGENTS[1].id,
		prompt:
			"Check the pre-market movers and tell me only about the ones on my watchlist.",
		interval: 1,
		unit: "days",
		is_active: false,
		one_time: false,
		start_time_utc: null,
		end_time_utc: new Date(2026, 3, 1, 16, 30, 0, 0).toISOString(),
		created_at: new Date(2026, 2, 13, 18, 0, 0, 0).toISOString(),
	},
];

/** What the stubbed desktop bridge answers, per story. */
type StubState = {
	entries: DesktopWakeEntry[];
	legacy: ScheduleResponse[];
	supervisor: DesktopWakeSupervisor;
	readError: boolean;
	/** Never resolves, for the loading state. */
	hang: boolean;
	/** Answers with a backend refusal, for the error state. */
	fail: string | null;
};

let stub: StubState = {
	entries: [],
	legacy: [],
	supervisor: SUPERVISOR,
	readError: false,
	hang: false,
	fail: null,
};

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

/*
 * The origin the page actually calls, read from the same config the app reads
 * rather than written out here - the copy in `shell.stories.tsx` had drifted
 * from the schema default exactly that way.
 */
const BACKEND_ORIGIN = new URL(apiConfig.baseUrl).origin;

/*
 * `/__desktop` answers with the transport's own envelope -- `{status, body}`,
 * where `body` is the backend's CRUD payload -- not with the payload directly.
 * `desktopControlResponse` rebuilds a `Response` from those two fields, so a
 * stub that returns the bare payload yields a 200 whose result is `undefined`
 * and renders as an empty list rather than an error.
 */
/**
 * The desktop bridge's answer, in the TRANSPORT's own envelope.
 *
 * `{status, body}` is what main returns to `desktopRequest`, and what the
 * renderer's `/__desktop` fallback serializes - NOT a `Response`. A stub that
 * answered with a `Response` would satisfy neither path: the IPC one reads
 * `.body` off a plain object, and the fetch one needs it JSON-serialized. So the
 * envelope is built once here and wrapped by each caller.
 */
const answer = async (request: { op: string; [key: string]: unknown }) => {
	switch (request.op) {
		case "wakes.list": {
			if (stub.hang) return new Promise<never>(() => {});
			if (stub.fail) return { status: 503, body: { detail: stub.fail } };
			return {
				status: 200,
				body: {
					status: 200,
					message: "ok",
					result: {
						entries: stub.entries,
						generated_at: FIXTURE_NOW_MS,
						total: stub.entries.length,
						truncated: false,
						supervisor: stub.supervisor,
						read_error: stub.readError,
					},
				},
			};
		}
		/*
		 * The picker's own read, answered from the conversations these fixtures
		 * describe: the create dialog asks `sessions.list` for which conversations
		 * EXIST (a conversation with no wakes is the branch's whole point), while
		 * the ceiling it renders comes from the wake listing's own count.
		 */
		case "sessions.list":
			return {
				status: 200,
				body: {
					status: 200,
					message: "ok",
					result: {
						sessions: stub.entries.map((entry) => ({
							id: entry.session_id,
							name: entry.name,
							/*
							 * SECONDS: this wire's unit, and the one place it differs from the
							 * wake listing beside it. The fixtures above are pinned in
							 * milliseconds (they feed `next_due_at`), so the conversion is
							 * written here rather than by re-expressing every fixture.
							 */
							mtime: Math.floor(entry.updated_at / 1000),
							live_state: "cold",
						})),
					},
				},
			};
		case "legacy.schedules.list":
			return {
				status: 200,
				body: {
					status: 200,
					message: "ok",
					result: {
						schedules: stub.legacy,
						total: stub.legacy.length,
						page: 1,
						per_page: 50,
					},
				},
			};
		/*
		 * The agent lookup answers with ONE agent and the list with the roster: the
		 * legacy row resolves its owner's display name through the single-agent
		 * read, and a stub that answered both with the roster would photograph
		 * "Unknown agent" on every legacy row - which is a defect the frame would
		 * then be unable to tell from a fixture.
		 */
		case "legacy.agent.get":
			return {
				status: 200,
				body: {
					status: 200,
					message: "ok",
					result:
						AGENTS.find((agent) => agent.id === request.agentId) ?? AGENTS[0],
				},
			};
		case "legacy.agents.list":
			return {
				status: 200,
				body: {
					status: 200,
					message: "ok",
					result: {
						agents: AGENTS,
						total: AGENTS.length,
						page: 1,
						per_page: 50,
					},
				},
			};
		/*
		 * The two writes answer as the route does, so a story that drives the
		 * create dialog or the cancel confirm exercises the real mutation paths
		 * rather than a rejected promise. An op this story has not thought about
		 * fails loudly instead of rendering a silently empty success.
		 */
		case "wakes.create":
			return {
				status: 200,
				body: {
					status: 200,
					message: "ok",
					result: {
						session_id: "new000000001",
						wake_id: "w1",
						next_due_at: at(60),
						created_session: true,
						supervisor: SUPERVISOR,
						receipt: { replayed: false },
						index_written: true,
					},
				},
			};
		case "wakes.remove":
			return {
				status: 200,
				body: { status: 200, message: "ok", result: null },
			};
		default:
			throw new TypeError(`unexpected desktop op in this story: ${request.op}`);
	}
};

/**
 * Install the bridge on `window.api.desktop.request`, which `desktopRequest`
 * prefers over its `fetch` fallback.
 *
 * The fetch fallback is stubbed too, because the legacy rows and the agent
 * lookup still reach their REST paths directly - the same two stubs the surface
 * shipped with, kept so the legacy group's frames are the real rows.
 */
const installFetchStub = () => {
	const original = window.fetch;
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("/__desktop")) {
			const request = JSON.parse(String(init?.body ?? "{}"));
			return json(await answer(request));
		}
		if (url.includes("/v1/schedules")) {
			return json({
				status: 200,
				message: "ok",
				result: {
					schedules: stub.legacy,
					total: stub.legacy.length,
					page: 1,
					per_page: 50,
				},
			});
		}
		if (url.includes("/v1/agents")) {
			return json({
				status: 200,
				message: "ok",
				result: { agents: AGENTS, total: AGENTS.length, page: 1, per_page: 50 },
			});
		}
		/*
		 * Unrouted backend paths fail here rather than reaching the network, for
		 * the reason set out in `shell.stories.tsx`: falling through is invisible
		 * while the port is dead and photographs a real server's replies the
		 * moment it is not. It rejects rather than returning `Response.error()`,
		 * because that resolves with status 0 and renders as a third state
		 * belonging to neither a live server nor an absent one.
		 */
		if (url.startsWith(BACKEND_ORIGIN)) {
			throw new TypeError("Load failed");
		}
		return original(input, init);
	}) as typeof window.fetch;

	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (request: { op: string }) => Promise<unknown>;
			};
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		...api.desktop,
		request: (request) => answer(request),
	} as typeof api.desktop;
};

installFetchStub();

/**
 * Render the page against one stub, and hold the capture until it has settled.
 *
 * The assignment happens in the story's render, before React mounts, so the
 * query's first request already sees it - which is what makes a story a frame
 * of ONE state rather than of whichever state the previous story left behind.
 */
const page = (state: Partial<StubState>) => {
	stub = {
		entries: [],
		legacy: [],
		supervisor: SUPERVISOR,
		readError: false,
		hang: false,
		fail: null,
		...state,
	};
	stageWorkspace();
	/*
	 * `h-screen`, because in the app the panel is `min-h-0 flex-1` inside a
	 * full-height page: without it every story photographed a panel hugging its
	 * own content - `empty` a 262px card where the app shows a large empty panel -
	 * and that is the input to every judgement about the fence's weight (the
	 * designer's D8).
	 */
	return (
		<div className="h-screen">
			<SchedulesPage nowMs={FIXTURE_NOW_MS} />
		</div>
	);
};

/**
 * Hold the capture until a piece of text is on screen.
 *
 * The load-error frames came out byte-identical to the loading ones in all 12
 * themes: the app's own query policy retries once (`query-client.ts:35`), so the
 * page is still `isLoading` for a tick after mount and the rig shot the spinner
 * (the designer's D1). `data-capture-pending` is the rig's own opt-in wait, so
 * the story asserts the branch rendered rather than hoping the tick landed.
 */
const HoldUntilText = ({ text }: { text: string }) => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		const timer = window.setInterval(() => {
			if (document.body.textContent?.includes(text)) {
				document.documentElement.removeAttribute("data-capture-pending");
				window.clearInterval(timer);
			}
		}, 50);
		return () => window.clearInterval(timer);
	}, [text]);
	return null;
};

/**
 * Stage the workspace a new conversation starts in.
 *
 * The page reads it from the canonical sessions store, and the sentence under
 * `Run in` names that directory. Pinned for the same reason as every instant
 * here - a story that left the store at its `~` default would photograph
 * `Starts in ~ with your default model.` on every capture - and called by the
 * DIALOG stories too, which do not go through `page()`: the store is module
 * state, so a dialog story that relied on a neighbour's render would show this
 * line or not depending on which stories ran before it.
 */
const stageWorkspace = () =>
	useCanonicalSessionsStore.setState({ cwd: "~/invoices" });

const meta: Meta = {
	title: "Schedules/Page",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

/** Empty: no wake row and no legacy row anywhere on this machine. */
export const Empty: Story = { render: () => page({}) };

/** Loading: the header and the panel stay, so nothing jumps when rows arrive. */
export const Loading: Story = { render: () => page({ hang: true }) };

/** The load failed: what happened, what it means, and a way back. */
export const LoadError: Story = {
	render: () => (
		<>
			<HoldUntilText text="Could not load scheduled tasks." />
			{page({ fail: "The backend did not answer." })}
		</>
	),
};

/** The common row: one conversation, one wake. */
export const OneWake: Story = { render: () => page({ entries: ONE_WAKE }) };

/**
 * Three wakes on one conversation, published out of due order: the frame proves
 * the page sorted them (soonest first) rather than echoing the wire.
 */
export const ThreeWakes: Story = {
	render: () => page({ entries: THREE_WAKES }),
};

/**
 * The populated list: six conversations and the fenced legacy group - the state
 * a machine that has used both engines shows.
 */
export const List: Story = {
	render: () => page({ entries: MANY, legacy: LEGACY_SCHEDULES }),
};

/** The same list at the app's minimum width, where the labels yield. */
export const ListNarrow: Story = {
	render: () => (
		<div className="h-screen w-[720px]">
			{page({ entries: MANY, legacy: LEGACY_SCHEDULES })}
		</div>
	),
};

/** A conversation the user stopped: no instant anywhere, the fact instead. */
export const Parked: Story = { render: () => page({ entries: PARKED }) };

/**
 * A recurring wake that has fired, and the ABSENCE of the one-shot that fired.
 *
 * The absence cannot be photographed as a state - it is the absence of a row -
 * so this frame carries what can be shown: `Ran 3 times` on a recurrence, with
 * the one-shot that already fired missing from the same listing on purpose.
 */
export const Spent: Story = { render: () => page({ entries: SPENT }) };

/** The listing answered but could not be read: not an empty store. */
export const ReadError: Story = { render: () => page({ readError: true }) };

/** The supervisor is not running: these will not fire. */
export const SupervisorDown: Story = {
	render: () =>
		page({
			entries: MANY,
			supervisor: {
				supported: true,
				running: false,
				detail: "launchd reports the agent as not running",
			},
		}),
};

/** The fenced legacy group on its own, with no wakes at all. */
export const LegacyOnly: Story = {
	render: () => page({ legacy: LEGACY_SCHEDULES }),
};

/**
 * The row actions, revealed.
 *
 * `:hover` cannot be forced from markup, so the open/cancel buttons - and the
 * tooltips and accessible names they carry - would exist in no captured frame.
 * This story writes the revealed state statically, the way the primitives sheet
 * fakes focus and pressed.
 */
export const RowActionsRevealed: Story = {
	render: () => (
		<div className="[&_.pointer-events-none.opacity-0]:pointer-events-auto [&_.pointer-events-none.opacity-0]:opacity-100">
			{page({ entries: MANY, legacy: LEGACY_SCHEDULES })}
		</div>
	),
};

/**
 * Drive a story's controls in order, and hold the capture until the last one has
 * settled.
 *
 * A frame of an interaction has to come from the interaction: `<Select>` is a
 * Radix portal with no state a story can reach, and a hand-mounted copy of a
 * dialog is not the dialog. So each step is a real press - `selector` finds the
 * control, `option` picks a row out of whatever list it opened - and the capture
 * is held (`data-capture-pending`, the rig's own opt-in wait) until the sequence
 * finishes.
 *
 * A step that never finds its control leaves the flag SET on purpose: the probe
 * exists to fail loudly when the control this story is about is missing, and
 * clearing the flag would let a frame without it be written and pass every guard.
 */
const Drive = ({
	steps,
}: {
	steps: Array<{ selector: string; option?: string; text?: string }>;
}) => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const wait = (ms: number) =>
			new Promise((resolve) => setTimeout(resolve, ms));
		/**
		 * Type into a controlled field the way a person does.
		 *
		 * A React-controlled input ignores a direct `.value =` assignment: the
		 * setter has to go through the PROTOTYPE and an `input` event has to follow,
		 * or React never sees the change (`input.focus()`/`sendKeys` would do it
		 * too, but this rig has no input pipeline). Without this a story could only
		 * ever photograph an empty prompt, and the `Create` it renders would be
		 * disabled for a reason the frame cannot explain.
		 */
		const type = async (selector: string, text: string) => {
			for (let attempt = 0; attempt < 80; attempt++) {
				if (cancelled) return false;
				const field = document.querySelector<
					HTMLTextAreaElement | HTMLInputElement
				>(selector);
				if (field) {
					/* Both prototypes: the prompt is a `Textarea` and the repeat
					   interval is a number `Input`, and React re-renders from the
					   prototype's setter in either case. */
					const setter = Object.getOwnPropertyDescriptor(
						field instanceof HTMLInputElement
							? window.HTMLInputElement.prototype
							: window.HTMLTextAreaElement.prototype,
						"value",
					)?.set;
					setter?.call(field, text);
					field.dispatchEvent(new Event("input", { bubbles: true }));
					await wait(200);
					return true;
				}
				await wait(50);
			}
			return false;
		};

		const press = async (selector: string, option?: string) => {
			for (let attempt = 0; attempt < 80; attempt++) {
				if (cancelled) return false;
				const scope = document.querySelector<HTMLElement>(selector);
				/*
				 * `option` picks a ROW out of whatever the `selector` opened (a Radix
				 * `<Select>` renders its list in a portal, so the row is not a child of
				 * the trigger-adjacent DOM): the search is scoped to the listbox the
				 * previous step opened rather than to the document, so a second open
				 * list cannot satisfy the wrong step.
				 */
				const target = option
					? Array.from(
							scope?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
						).find((node) => node.textContent?.includes(option))
					: scope;
				if (target) {
					target.click();
					await wait(200);
					return true;
				}
				await wait(50);
			}
			return false;
		};
		const run = async () => {
			for (const step of steps) {
				const done = step.text
					? await type(step.selector, step.text)
					: await press(step.selector, step.option);
				if (!done) return;
			}
			await wait(300);
			document.documentElement.removeAttribute("data-capture-pending");
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [steps]);
	return null;
};

export const CancelConfirm: Story = {
	render: () => (
		<>
			<div className="[&_.pointer-events-none.opacity-0]:pointer-events-auto [&_.pointer-events-none.opacity-0]:opacity-100">
				{page({ entries: ONE_WAKE })}
			</div>
			<Drive steps={[{ selector: 'button[aria-label="Cancel wake"]' }]} />
		</>
	),
};

/**
 * Opens the first row's `Open conversation` tooltip, and holds the capture until
 * it is up.
 *
 * The label is one of the strings that has never appeared in a frame - which is
 * how a rename once put a stale word on both a tooltip and an icon-only
 * button's accessible name and survived a design round. A tooltip is also a
 * positioned surface, so whether it collides with the row's own text, covers
 * the line below, or clears the hairline is only answerable against the row it
 * actually opens on.
 *
 * Opened by focusing the button rather than by forcing state: Radix opens on
 * focus, so this is the path a keyboard user takes and the frame shows what
 * they see.
 */
const OpenRowTooltip = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		const clear = () =>
			document.documentElement.removeAttribute("data-capture-pending");
		let tries = 0;
		let settle: number | undefined;
		const id = setInterval(() => {
			const button = document.querySelector<HTMLElement>(
				'button[aria-label="Open conversation"]',
			);
			if (button) {
				button.focus();
				clearInterval(id);
				/* One more beat for Radix to mount the tooltip it opens on focus. */
				settle = window.setTimeout(clear, 300);
			} else if (++tries > 100) {
				/* Deliberately does NOT clear the flag. The probe looks for the exact
				   accessible name this story exists to prove is present, so the one
				   regression it guards against is also the thing that makes the probe
				   fail. Clearing here would let a tooltip-less frame be written and
				   pass every guard, since none of them can see a missing tooltip. */
				clearInterval(id);
			}
		}, 50);
		return () => {
			clearInterval(id);
			clearTimeout(settle);
			clear();
		};
	}, []);
	return null;
};

export const RowActionLabel: Story = {
	render: () => (
		<>
			<div className="[&_.pointer-events-none.opacity-0]:pointer-events-auto [&_.pointer-events-none.opacity-0]:opacity-100">
				{page({ entries: MANY })}
			</div>
			<OpenRowTooltip />
		</>
	),
};

/** The create dialog, default branch: a new conversation. */
export const CreateDialog: Story = {
	render: () => {
		stageWorkspace();
		stub = {
			entries: MANY,
			legacy: [],
			supervisor: SUPERVISOR,
			readError: false,
			hang: false,
			fail: null,
		};
		return (
			<ScheduledTaskDialog open onClose={() => {}} nowMs={FIXTURE_NOW_MS} />
		);
	},
};

/**
 * The editor: the same form on an ARMED wake.
 *
 * `Run in` is absent (a wake is edited where it lives) and every timing control
 * defaults to `keep`, because a PATCH that omitted a field would be "leave it
 * alone" rather than "clear it" - the difference between this branch and the
 * create branch, which has no `keep` and whose omitted `every` means a
 * one-shot.
 */
export const EditWake: Story = {
	render: () => {
		stageWorkspace();
		stub = {
			entries: EDIT_WAKES,
			legacy: [],
			supervisor: SUPERVISOR,
			readError: false,
			hang: false,
			fail: null,
		};
		return (
			<ScheduledTaskDialog
				open
				onClose={() => {}}
				nowMs={FIXTURE_NOW_MS}
				edit={editTarget(EDIT_WAKES, "w2", 2)}
			/>
		);
	},
};

/**
 * The editor after a REPEAT-only change.
 *
 * The path the old sentence was false on (`build_wake_edit` moves the anchor
 * only when the request carries `in`/`at`) and the path the old `Save` was
 * enabled on with nothing to save (the designer's D11). The frame carries both:
 * a dirty, enabled `Save`, and the sentence that no longer claims a re-anchor.
 */
export const EditWakeRepeatOnly: Story = {
	render: () => {
		stageWorkspace();
		stub = {
			entries: EDIT_WAKES,
			legacy: [],
			supervisor: SUPERVISOR,
			readError: false,
			hang: false,
			fail: null,
		};
		return (
			<>
				<ScheduledTaskDialog
					open
					onClose={() => {}}
					nowMs={FIXTURE_NOW_MS}
					edit={editTarget(EDIT_WAKES, "w2", 2)}
				/>
				<Drive
					steps={[
						/* A Radix `<Select>` opens in a PORTAL, so picking a row is two
						   steps: press the trigger, then the listbox that appeared. */
						{ selector: '[id$="-repeat"]' },
						{ selector: '[role="listbox"]', option: "Every" },
						{ selector: '[aria-label="Repeat interval"]', text: "30" },
					]}
				/>
			</>
		);
	},
};

/**
 * The repeat floor, refused inline with the reason.
 *
 * The dialog owns this refusal rather than letting the transport answer for it,
 * which is the class of fix the reviewer's R3 asked for on the prompt too.
 */
export const CreateDialogRepeatFloor: Story = {
	render: () => (
		<>
			<ScheduledTaskDialog open onClose={() => {}} nowMs={FIXTURE_NOW_MS} />
			<Drive
				steps={[
					{ selector: 'button[aria-pressed="false"]' },
					{ selector: '[id$="-repeat"]' },
					{ selector: '[role="listbox"]', option: "Every" },
					{ selector: '[aria-label="Repeat interval"]', text: "0" },
				]}
			/>
		</>
	),
};

/**
 * The create dialog on the existing-conversation branch, with the picker open on
 * the conversations `sessions.list` answers with.
 *
 * The picker's own read, not the wake listing's: the list below names
 * conversations that need not have a wake yet, which is the whole point of the
 * branch.
 */
export const CreateDialogExisting: Story = {
	render: () => {
		stageWorkspace();
		stub = {
			entries: MANY,
			legacy: [],
			supervisor: SUPERVISOR,
			readError: false,
			hang: false,
			fail: null,
		};
		return (
			<>
				<ScheduledTaskDialog open onClose={() => {}} nowMs={FIXTURE_NOW_MS} />
				<Drive
					steps={[
						{ selector: 'button[aria-pressed="false"]' },
						{ selector: CONVERSATION_SELECTOR },
					]}
				/>
			</>
		);
	},
};

/**
 * The same branch with nothing to pick, which is a machine that has never had a
 * conversation.
 *
 * The state this change exists to make honest: the control used to be DISABLED
 * with no reason, which reads as a broken dialog. "There is nothing here yet,
 * and here is the other choice" is the sentence it says instead.
 */
export const CreateDialogNoConversations: Story = {
	render: () => {
		stageWorkspace();
		stub = {
			entries: [],
			legacy: [],
			supervisor: SUPERVISOR,
			readError: false,
			hang: false,
			fail: null,
		};
		return (
			<>
				<ScheduledTaskDialog open onClose={() => {}} nowMs={FIXTURE_NOW_MS} />
				<Drive steps={[{ selector: 'button[aria-pressed="false"]' }]} />
			</>
		);
	},
};

/**
 * The ceiling state: a conversation already holding `MAX_WAKE_SCHEDULES` wakes
 * refuses the create inline rather than after the press.
 *
 * DRIVEN, because the ceiling is measured against the conversation the user
 * picked: the refusal only exists on the existing-conversation branch, and a
 * frame of the untouched dialog would photograph the happy path under this
 * story's name. So the story presses `An existing conversation` and then
 * chooses the conversation, which is the state the reason is written for.
 */
export const CreateDialogCeiling: Story = {
	render: () => {
		const full = (items: number) =>
			Array.from({ length: items }, (_, index) =>
				wake(
					`w${index + 1}`,
					30 + index * 30,
					`Scheduled task number ${index + 1}, armed some time ago.`,
					{ every_ms: 24 * HOUR_MS },
				),
			);
		stageWorkspace();
		stub = {
			entries: [
				conversation(
					"a1b2c3d4e5f6",
					"Invoices workspace",
					"~/invoices",
					full(16),
				),
			],
			legacy: [],
			supervisor: SUPERVISOR,
			readError: false,
			hang: false,
			fail: null,
		};
		return (
			<>
				<ScheduledTaskDialog open onClose={() => {}} nowMs={FIXTURE_NOW_MS} />
				<Drive
					steps={[
						{ selector: 'button[aria-pressed="false"]' },
						{ selector: '[role="combobox"]' },
						{ selector: '[id$="-conversation"]' },
						{ selector: '[role="listbox"]', option: "Invoices" },
					]}
				/>
			</>
		);
	},
};

/**
 * The repeat branch, revealed: `Every` with its count and unit, and `Ends`.
 *
 * The two controls the create flow gains once a wake repeats, and the ones a
 * frame of the default branch cannot show. Driven for the same reason as the
 * ceiling: `<Select>` keeps its list in a portal, so there is no prop that opens
 * it.
 */
export const CreateDialogEvery: Story = {
	render: () => {
		stageWorkspace();
		stub = {
			entries: MANY,
			legacy: [],
			supervisor: SUPERVISOR,
			readError: false,
			hang: false,
			fail: null,
		};
		return (
			<>
				<ScheduledTaskDialog open onClose={() => {}} nowMs={FIXTURE_NOW_MS} />
				<Drive
					steps={[
						{
							selector: 'textarea[name="prompt"]',
							text: "Send me a summary of last week's support tickets.",
						},
						{ selector: '[id$="-repeat"]' },
						{ selector: '[role="listbox"]', option: "Every" },
					]}
				/>
			</>
		);
	},
};

/**
 * The date-time picker, open.
 *
 * The picker's calendar never had a frame in any round - nothing ever opened it
 * - so its one MUI surface was reviewed from the stylesheet alone. The wrapper
 * takes `initialOpen` for exactly this.
 */
export const PickerOpen: Story = {
	render: () => (
		<div className="flex h-screen items-center justify-center bg-canvas p-8">
			<div className="w-90 rounded-lg border border-hairline bg-surface p-4">
				<DateTimePicker
					label="First run at"
					value="2026-08-06T01:05:00.000Z"
					onChange={() => {}}
					initialOpen
				/>
			</div>
		</div>
	),
};
