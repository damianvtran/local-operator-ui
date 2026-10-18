import { DEFAULT_SIDEBAR_VIEW } from "@features/chat/chat-sidebar-view";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useSessionTagsStore } from "@shared/store/session-tags-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useEffect, useState } from "react";
import type {
	DesktopRequest,
	DesktopResponse,
	TagCategory,
	TagRef,
} from "../../../../../shared/desktop-contract";
import { ChatSidebar } from "./chat-sidebar";

let calls: DesktopRequest[] = [];
type Scenario =
	| "off"
	| "on"
	| "empty"
	| "old"
	| "picker"
	| "manage"
	| "error"
	| "loading";
/** The actual sidebar and contract-shaped desktop bridge, not a proposed mock.
 * Mutable fixture data makes Apply/Clear/registry edits observable through the
 * same catalogue refresh as production. No operator backend or config is used.
 */
function installBridge(scenario: Scenario) {
	calls = [];
	document.body.dataset.tagsProof = "";
	let categories: TagCategory[] =
		scenario === "empty"
			? []
			: [
					{ id: "review", name: "Review", order: 0, conversations: 2 },
					{ id: "project", name: "Project", order: 1, conversations: 2 },
					{ id: "concept", name: "Concept", order: 2, conversations: 1 },
				];
	const now = Date.now() / 1000;
	const tags = (...ids: string[]) =>
		categories
			.filter((tag) => ids.includes(tag.id))
			.map(({ id, name }) => ({ id, name }));
	const rows = [
		{
			id: "111111111111",
			name: "Review the migration safety checks",
			pinned: true,
			tags: tags("review", "project"),
			primary: "review",
		},
		{
			id: "222222222222",
			name: "Ship the desktop sidebar improvements",
			pinned: false,
			tags: tags("project"),
			primary: "project",
		},
		{
			id: "333333333333",
			name: "Check the narrow layout and a deliberately long conversation title",
			pinned: false,
			tags: tags("review"),
			primary: "review",
		},
		{
			id: "444444444444",
			name: "Explore the grouping interaction",
			pinned: false,
			tags: tags("concept"),
			primary: "concept",
		},
		{
			id: "555555555555",
			name: "An untagged conversation",
			pinned: false,
			tags: [] as TagRef[],
			primary: null,
		},
	].map((row, index) => ({
		...row,
		mtime: now - index * 60,
		created_at: now - index * 60,
		preview: "",
		live_state: "attached",
		pending: null,
		active: true,
		binding: { agent: null, team: null },
		status: { code: "idle", label: "Recent" },
		status_revision: 1,
		status_epoch: "tag-fixture-epoch",
	}));
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const handler = async (request: DesktopRequest): Promise<DesktopResponse> => {
		calls.push(request);
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						session_catalogue: 2,
						session_pins: 1,
						session_search: 1,
						...(scenario === "old" ? {} : { session_tags: 1 }),
					},
				});
			case "sessions.list":
				return ok({ sessions: rows, truncated: false });
			case "profiles.list":
				return ok({ profiles: [] });
			case "teams.list":
				return ok({ teams: [] });
			case "sessions.search":
				return ok({
					sessions: rows.filter((row) =>
						row.name.toLowerCase().includes(request.q.toLowerCase()),
					),
				});
			case "tags.list":
				if (scenario === "old")
					throw new Error("Old backend must not receive a tags request");
				if (scenario === "loading") return new Promise(() => {});
				return ok({ tags: categories });
			case "tags.replace":
				categories = request.tags.map((tag, index) => ({
					id: tag.id ?? `new-${index}`,
					name: tag.name,
					order: index,
					conversations: rows.filter((row) =>
						row.tags.some((held) => held.id === tag.id),
					).length,
				}));
				for (const row of rows) {
					row.tags = row.tags
						.filter((tag) => categories.some((held) => held.id === tag.id))
						.map((tag) => ({
							id: tag.id,
							name:
								categories.find((held) => held.id === tag.id)?.name ?? tag.name,
						}));
					if (!row.tags.some((tag) => tag.id === row.primary))
						row.primary = row.tags[0]?.id ?? null;
				}
				return ok({ tags: categories });
			case "sessions.tags": {
				if (scenario === "error")
					return {
						status: 503,
						body: {
							detail: "Fixture assignment failed. Retry preserves your draft.",
						},
					};
				const row = rows.find((entry) => entry.id === request.sessionId);
				if (!row) throw new Error("Unknown fixture conversation");
				row.tags = request.tags.flatMap((id) => {
					const tag = categories.find((entry) => entry.id === id);
					return tag ? [{ id, name: tag.name }] : [];
				});
				row.primary = request.primary;
				return ok({ session_id: row.id, tags: row.tags, primary: row.primary });
			}
			default:
				throw new Error(`Unexpected tag fixture operation: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: { desktop?: { request: typeof handler } };
	};
	page.api = { ...page.api, desktop: { request: handler } };
	useCanonicalSessionsStore.setState({ sessions: [] });
	useSessionTagsStore.setState({ categories: [], loading: false, error: null });
	useUiPreferencesStore.setState({
		chatSidebarView: {
			...DEFAULT_SIDEBAR_VIEW,
			hidden: ["agents", "teams"],
			tagsEnabled: !["off", "old"].includes(scenario),
		},
	});
}

function Page({ scenario, width }: { scenario: Scenario; width: number }) {
	useState(() => installBridge(scenario));
	const [geometry, setGeometry] = useState("");
	useEffect(() => {
		const measure = () => {
			const rows = [
				...document.querySelectorAll<HTMLElement>(
					"[data-session-row] [data-chat-row]",
				),
			];
			const headers = [
				...document.querySelectorAll<HTMLElement>(
					"[data-chat-tag-group] > div:first-child",
				),
			];
			const modal = document.querySelector<HTMLElement>("[role=dialog]");
			setGeometry(
				`rows ${rows.length} · row heights ${[...new Set(rows.map((row) => row.getBoundingClientRect().height))].join(",")} · subheaders ${headers.length} × ${[...new Set(headers.map((header) => header.getBoundingClientRect().height))].join(",")}px · modal ${modal ? Math.round(modal.getBoundingClientRect().width) : "none"} · assignment writes ${calls.filter((call) => call.op === "sessions.tags").length} · ${document.body.dataset.tagsProof ?? ""}`,
			);
		};
		const timer = setInterval(measure, 200);
		return () => clearInterval(timer);
	}, []);

	return (
		<div className="flex h-screen bg-canvas text-ink">
			<div className="shrink-0 border-hairline border-r" style={{ width }}>
				<ChatSidebar
					selectedConversation={undefined}
					onSelectConversation={() => undefined}
					onStageDraft={() => undefined}
				/>
			</div>
			<main className="p-6 text-body-sm text-ink-muted">
				Implemented tag grouping · {width}px sidebar · {scenario}
				<output data-tags-geometry className="mt-3 block">
					{geometry}
				</output>
			</main>
		</div>
	);
}
const meta = {
	title: "Chat sidebar/Tags",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj;
const ready = async () =>
	waitFor(() =>
		expect(
			document.querySelectorAll("[data-session-row]").length,
		).toBeGreaterThan(0),
	);
const picker = async () => {
	await ready();
	const row = document.querySelector<HTMLElement>(
		"[data-session-row] [data-chat-row]",
	);
	if (!row) throw new Error("No fixture row");
	row.focus();
	await userEvent.keyboard("{Shift>}{F10}{/Shift}");
	await userEvent.click(await within(document.body).findByText("Tags…"));
	await within(document.body).findByRole("dialog");
};
const manage = async () => {
	await ready();
	const trigger = document.querySelector<HTMLElement>(
		"[data-sidebar-view-options]",
	);
	if (!trigger) throw new Error("No view options trigger");
	await userEvent.click(trigger);
	await userEvent.click(await within(document.body).findByText("Manage tags…"));
	await within(document.body).findByRole("dialog");
};
const story = (
	scenario: Scenario,
	width = 260,
	theme = "localOperatorDark",
): Story => ({
	args: { theme },
	render: () => <Page scenario={scenario} width={width} />,
	play:
		scenario === "picker" || scenario === "loading"
			? picker
			: scenario === "manage"
				? manage
				: scenario === "error"
					? async () => {
							await picker();
							await userEvent.click(
								within(document.body).getByRole("button", {
									name: "Apply",
								}),
							);
							await within(document.body).findByRole("alert");
						}
					: ready,
});
export const TagsOff = story("off");
export const TagsOn = story("on");
export const NoCategories = story("empty");
export const OldBackend = story("old");
export const Picker = story("picker");
export const Manage = story("manage");
export const PickerError = story("error");
export const PickerLoading = story("loading");
export const Narrow220 = story("on", 220);
export const Wide320 = story("on", 320);
export const Light = story("on", 260, "localOperatorLight");
export const PickerLight = story("picker", 220, "localOperatorLight");
export const ManageLight = story("manage", 320, "localOperatorLight");

/** Real mounted UI path: Cancel writes nothing; Clear + Apply emits exactly one
 * desired-state request and returns focus to the stable originating row. */
export const AssignClearRoundTrip: Story = {
	...story("on"),
	play: async () => {
		await picker();
		await userEvent.click(
			within(document.body).getByRole("checkbox", { name: "Concept" }),
		);
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Cancel" }),
		);
		await waitFor(() =>
			expect(document.querySelector("[role=dialog]")).toBeNull(),
		);
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(0);
		await picker();
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Clear tags" }),
		);
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Apply" }),
		);
		await waitFor(() =>
			expect(document.querySelector("[role=dialog]")).toBeNull(),
		);
		expect(calls.filter((call) => call.op === "sessions.tags")).toEqual([
			{
				op: "sessions.tags",
				sessionId: "111111111111",
				tags: [],
				primary: null,
			},
		]);
		expect(
			useCanonicalSessionsStore
				.getState()
				.sessions.find((row) => row.session_id === "111111111111")?.tags,
		).toEqual([]);
		await waitFor(() =>
			expect(document.activeElement).toBe(
				document.querySelector(
					'[data-session-row="111111111111"] [data-chat-row]',
				),
			),
		);
		document.body.dataset.tagsProof =
			"PASS: Cancel 0 writes; Clear 1 atomic write; canonical tags []; focus returned";
	},
};

export const ManagementRoundTrip: Story = {
	...story("on"),
	play: async () => {
		await manage();
		const body = within(document.body);
		await userEvent.type(
			body.getByRole("textbox", { name: "New tag name" }),
			"New category",
		);
		await userEvent.click(body.getByRole("button", { name: "Add" }));
		await waitFor(() =>
			expect(useSessionTagsStore.getState().categories).toHaveLength(4),
		);
		const project = document.querySelector<HTMLElement>(
			'[data-tag-id="project"]',
		);
		if (!project) throw new Error("Project category missing");
		await userEvent.click(
			within(project).getByRole("button", { name: "Rename" }),
		);
		const rename = body.getByRole("textbox", { name: "Rename Project" });
		await userEvent.clear(rename);
		await userEvent.type(rename, "Project renamed");
		await userEvent.click(body.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(
				useSessionTagsStore
					.getState()
					.categories.find((tag) => tag.id === "project")?.name,
			).toBe("Project renamed"),
		);
		await userEvent.click(
			body.getByRole("button", { name: "Move Project renamed up" }),
		);
		await waitFor(() =>
			expect(useSessionTagsStore.getState().categories[0].id).toBe("project"),
		);
		await waitFor(() =>
			expect(
				document.activeElement
					?.closest("[data-tag-id]")
					?.getAttribute("data-tag-id"),
			).toBe("project"),
		);
		expect(
			useCanonicalSessionsStore
				.getState()
				.sessions.find((row) => row.session_id === "222222222222")?.primary,
		).toBe("project");
		const moved = document.querySelector<HTMLElement>(
			'[data-tag-id="project"]',
		);
		if (!moved) throw new Error("Moved category missing");
		await userEvent.click(
			within(moved).getByRole("button", { name: "Delete" }),
		);
		await waitFor(() =>
			expect(
				body.getByText(
					"Remove this tag from 2 conversations. Conversations grouped here move to their oldest remaining tag, or Untagged. Conversations will not be deleted.",
				),
			).toBeTruthy(),
		);
		await waitFor(() =>
			expect(document.activeElement).toBe(
				body.getByRole("button", { name: "Cancel" }),
			),
		);
		await userEvent.click(body.getByRole("button", { name: "Delete tag" }));
		await waitFor(() =>
			expect(document.querySelector('[data-tag-id="project"]')).toBeNull(),
		);
		await waitFor(() =>
			expect(
				useCanonicalSessionsStore
					.getState()
					.sessions.every(
						(row) => !row.tags?.some((tag) => tag.id === "project"),
					),
			).toBe(true),
		);
		expect(useCanonicalSessionsStore.getState().sessions).toHaveLength(5);
		await userEvent.click(body.getByRole("button", { name: "Done" }));
		await waitFor(() =>
			expect(document.activeElement).toBe(
				document.querySelector("[data-sidebar-view-options]"),
			),
		);
		document.body.dataset.tagsProof =
			"PASS: add; rename keeps ID; reorder keeps primary/focus; delete count 2; 5 chats retained; trigger focus returned";
	},
};

export const ViewOptions220: Story = {
	...story("on", 220),
	play: async () => {
		await ready();
		const trigger = document.querySelector<HTMLElement>(
			"[data-sidebar-view-options]",
		);
		if (!trigger) throw new Error("No view trigger");
		await userEvent.click(trigger);
		const action = await within(document.body).findByRole("button", {
			name: "Manage tags…",
		});
		const group = action.closest<HTMLElement>("[data-sidebar-tags-options]");
		if (!group) throw new Error("No Tags row");
		const box = group.getBoundingClientRect();
		const button = action.getBoundingClientRect();
		const range = document.createRange();
		range.selectNodeContents(action);
		const lines = range.getClientRects().length;
		expect(box.height).toBe(40);
		expect(lines).toBe(1);
		expect(action.scrollWidth).toBeLessThanOrEqual(action.clientWidth);
		document.body.dataset.tagsProof = `PASS: 220px sidebar; Tags row ${box.width}×${box.height}px; Manage ${button.width}×${button.height}px; text lines ${lines}; no horizontal overflow`;
	},
};

export const PickerManageRoundTrip: Story = {
	...story("on", 220),
	play: async () => {
		await picker();
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Manage tags…" }),
		);
		await within(document.body).findByRole("heading", { name: "Manage tags…" });
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
		expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
		expect(document.activeElement?.closest("[role=dialog]")).not.toBeNull();
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(0);
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Done" }),
		);
		await waitFor(() =>
			expect(document.activeElement).toBe(
				document.querySelector(
					'[data-session-row="111111111111"] [data-chat-row]',
				),
			),
		);
		document.body.dataset.tagsProof =
			"PASS: picker → Manage; one modal; no assignment; originating row focus returned";
	},
};
