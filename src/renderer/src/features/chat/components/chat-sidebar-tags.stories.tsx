import { DEFAULT_SIDEBAR_VIEW } from "@features/chat/chat-sidebar-view";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useSessionTagsStore } from "@shared/store/session-tags-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, userEvent, waitFor, within } from "@storybook/test";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type {
	DesktopRequest,
	DesktopResponse,
	TagCategory,
	TagRef,
} from "../../../../../shared/desktop-contract";
import { ChatSidebar } from "./chat-sidebar";

let calls: DesktopRequest[] = [];
let finishRegistry: (() => void) | null = null;
type Scenario =
	| "tags-off"
	| "tags-on"
	| "no-categories"
	| "old-backend"
	| "picker"
	| "manage"
	| "picker-error"
	| "picker-loading";
/** The actual sidebar and contract-shaped desktop bridge, not a proposed mock.
 * Mutable fixture data makes Apply/Clear/registry edits observable through the
 * same catalogue refresh as production. No operator backend or config is used.
 */
function installBridge(scenario: Scenario) {
	calls = [];
	finishRegistry = null;
	document.body.dataset.tagsProof = "";
	let categories: TagCategory[] =
		scenario === "no-categories"
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
						...(scenario === "old-backend" ? {} : { session_tags: 1 }),
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
				if (scenario === "old-backend")
					throw new Error("Old backend must not receive a tags request");
				if (scenario === "picker-loading")
					return new Promise<DesktopResponse>((resolve) => {
						finishRegistry = () => resolve(ok({ tags: categories }));
					});
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
				if (scenario === "picker-error")
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
			tagsEnabled: !["tags-off", "old-backend"].includes(scenario),
		},
	});
}

function Page({ scenario, width }: { scenario: Scenario; width: number }) {
	const client = useQueryClient();
	useState(() => {
		// Changing scenario on one story ID must not reuse the previous fixture's
		// cached capabilities/catalogue (especially the old-backend negative control).
		client.clear();
		installBridge(scenario);
	});
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
type Args = { scenario: Scenario; width: number; theme: string };
const meta = {
	title: "Chat sidebar/Tags",
	parameters: { layout: "fullscreen" },
	args: { scenario: "tags-on", width: 260, theme: "localOperatorDark" },
	argTypes: {
		scenario: {
			control: "select",
			options: [
				"tags-off",
				"tags-on",
				"no-categories",
				"old-backend",
				"picker",
				"manage",
				"picker-error",
				"picker-loading",
			],
		},
		width: { control: "select", options: [220, 260, 320] },
		theme: {
			control: "select",
			options: ["localOperatorLight", "localOperatorDark"],
		},
	},
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<Args>;
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
	args: { scenario, width, theme },
	// Args drive both the actual fixture and its interaction, not a closure over
	// an export's convenience defaults. This enables the complete URL matrix.
	render: ({ scenario, width }) => (
		<Page key={scenario} scenario={scenario} width={width} />
	),
	play: async ({ args }) => {
		if (args.scenario === "picker" || args.scenario === "picker-loading")
			await picker();
		else if (args.scenario === "manage") await manage();
		else if (args.scenario === "picker-error") {
			await picker();
			await userEvent.click(
				within(document.body).getByRole("button", { name: "Apply" }),
			);
			await within(document.body).findByRole("alert");
			await within(document.body).findByText("Tags were not saved. Try again.");
			expect(
				within(document.body).getByRole("button", { name: "Retry" }),
			).toBeEnabled();
			expect(
				within(document.body).getByRole("checkbox", { name: "Review" }),
			).toBeChecked();
			document.body.dataset.tagsProof =
				"PASS: assignment 503 shows tag-specific save failure + Retry and preserves draft";
		} else {
			await ready();
			if (args.scenario === "old-backend") {
				expect(calls.filter((call) => call.op === "tags.list")).toHaveLength(0);
				expect(document.querySelector("[data-chat-tag-group]")).toBeNull();
				document.body.dataset.tagsProof =
					"PASS: old backend requests no tags.list and renders no tag groups";
			}
		}
	},
});
export const TagsOff = story("tags-off");
export const TagsOn = story("tags-on");
export const NoCategories = story("no-categories");
export const OldBackend = story("old-backend");
export const Picker = story("picker");
export const Manage = story("manage");
export const PickerError = story("picker-error");
export const PickerLoading = story("picker-loading");
export const Narrow220 = story("tags-on", 220);
export const Wide320 = story("tags-on", 320);
export const Light = story("tags-on", 260, "localOperatorLight");
export const PickerLight = story("picker", 220, "localOperatorLight");
export const ManageLight = story("manage", 320, "localOperatorLight");

/** Real mounted UI path: Cancel writes nothing; Clear + Apply emits exactly one
 * desired-state request and returns focus to the stable originating row. */
export const AssignClearRoundTrip: Story = {
	...story("tags-on"),
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
		await within(document.body).findByText(
			"Tags updated. Shown under Untagged.",
		);
		document.body.dataset.tagsProof =
			"PASS: Cancel 0 writes; Clear 1 atomic write; canonical tags []; focus returned";
	},
};

/** Exercise all four local mutations without touching the registry until Apply. */
const editRegistryDraft = async () => {
	const body = within(document.body);
	await userEvent.type(
		body.getByRole("textbox", { name: "New tag name" }),
		"New category",
	);
	await userEvent.click(body.getByRole("button", { name: "Add" }));
	await body.findByText("New category");
	const review = document.querySelector<HTMLElement>('[data-tag-id="review"]');
	if (!review) throw new Error("Review category missing");
	await userEvent.click(within(review).getByRole("button", { name: "Rename" }));
	const rename = body.getByRole("textbox", { name: "Rename Review" });
	fireEvent.change(rename, { target: { value: "Review renamed" } });
	await waitFor(() => expect(rename).toHaveValue("Review renamed"));
	await userEvent.click(body.getByRole("button", { name: "Save" }));
	await body.findByText("Review renamed");
	for (let index = 0; index < 3; index++) {
		await userEvent.click(
			body.getByRole("button", { name: "Move New category up" }),
		);
		await waitFor(() =>
			expect(
				document.activeElement
					?.closest("[data-tag-id]")
					?.getAttribute("data-tag-id"),
			).toBe("new:New category"),
		);
	}
	expect(
		body.getByRole("button", { name: "Move New category up" }),
	).toBeDisabled();
	const project = document.querySelector<HTMLElement>(
		'[data-tag-id="project"]',
	);
	if (!project) throw new Error("Project category missing");
	await userEvent.click(
		within(project).getByRole("button", { name: "Delete" }),
	);
	await body.findByText(
		"Remove this tag from 2 conversations. Conversations grouped here move to their oldest remaining tag, or Untagged. Conversations will not be deleted.",
	);
	const confirmation = document.querySelector<HTMLElement>(
		'section[aria-label="Delete “Project”?"]',
	);
	if (!confirmation) throw new Error("No delete confirmation");
	await waitFor(() =>
		expect(document.activeElement).toBe(
			within(confirmation).getByRole("button", { name: "Cancel" }),
		),
	);
	expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(0);
	await userEvent.click(body.getByRole("button", { name: "Delete tag" }));
	await waitFor(() =>
		expect(document.querySelector('[data-tag-id="project"]')).toBeNull(),
	);
	expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(0);
	expect(useSessionTagsStore.getState().categories).toHaveLength(3);
};
export const ManagementRoundTrip: Story = {
	...story("tags-on"),
	play: async () => {
		await manage();
		await editRegistryDraft();
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Cancel" }),
		);
		await waitFor(() =>
			expect(document.querySelector("[role=dialog]")).toBeNull(),
		);
		expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(0);
		expect(
			useSessionTagsStore.getState().categories.map((tag) => tag.name),
		).toEqual(["Review", "Project", "Concept"]);
		await manage();
		await editRegistryDraft();
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Apply" }),
		);
		await waitFor(() =>
			expect(document.querySelector("[role=dialog]")).toBeNull(),
		);
		expect(calls.filter((call) => call.op === "tags.replace")).toEqual([
			{
				op: "tags.replace",
				tags: [
					{ name: "New category" },
					{ id: "review", name: "Review renamed" },
					{ id: "concept", name: "Concept" },
				],
			},
		]);
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
		await waitFor(() =>
			expect(document.activeElement).toBe(
				document.querySelector("[data-sidebar-view-options]"),
			),
		);
		document.body.dataset.tagsProof =
			"PASS: local add/rename/reorder/delete; confirmation 0 writes; Cancel 0 writes; Apply 1 desired-state request; 5 chats retained; trigger focus returned";
	},
};

export const ViewOptions220: Story = {
	...story("tags-on", 220),
	play: async ({ args }) => {
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
		const content = group.firstElementChild?.getBoundingClientRect();
		const baseHeight =
			(content?.height ?? 0) +
			Number.parseFloat(getComputedStyle(group).borderBottomWidth);
		expect(baseHeight).toBe(40);
		expect(lines).toBe(1);
		expect(action.scrollWidth).toBeLessThanOrEqual(action.clientWidth);
		if (args.scenario === "no-categories") {
			await within(document.body).findByText("No tags yet");
			for (
				let step = 0;
				step < 60 &&
				document.activeElement?.getAttribute("data-sidebar-view-section") !==
					"older";
				step++
			)
				await userEvent.tab();
			expect(
				document.activeElement?.getAttribute("data-sidebar-view-section"),
			).toBe("older");
			const panel = document.querySelector<HTMLElement>(
				"[data-sidebar-view-panel]",
			);
			if (!panel) throw new Error("No scrollable View panel");
			const focused = document.activeElement?.getBoundingClientRect();
			expect(focused?.bottom ?? 0).toBeLessThanOrEqual(
				panel.getBoundingClientRect().bottom,
			);
		}
		document.body.dataset.tagsProof = `PASS: ${args.width}px sidebar; base Tags row ${baseHeight}px; Tags row ${box.width}×${box.height}px; Manage ${button.width}×${button.height}px; text lines ${lines}; no horizontal overflow`;
	},
};

export const PickerManageRoundTrip: Story = {
	...story("tags-on", 220),
	play: async () => {
		await picker();
		const body = within(document.body);
		useSessionTagsStore.setState({
			categories: [
				...useSessionTagsStore.getState().categories,
				...Array.from({ length: 7 }, (_, index) => ({
					id: `extra-${index}`,
					name: `Extra ${index}`,
					order: index + 3,
					conversations: 0,
				})),
			],
		});
		await userEvent.click(body.getByRole("checkbox", { name: "Concept" }));
		await userEvent.click(body.getByRole("radio", { name: "Project" }));
		await userEvent.type(
			body.getByRole("textbox", { name: "Search tags" }),
			"e",
		);
		const scroll = document.querySelector<HTMLElement>(
			"[role=dialog] .overflow-y-auto",
		);
		if (!scroll) throw new Error("No picker scroller");
		scroll.scrollTop = 60;
		let heldScroll = scroll.scrollTop;
		expect(heldScroll).toBeGreaterThan(0);
		const openManager = async () => {
			const invokingScroller = document.querySelector<HTMLElement>(
				"[role=dialog] .overflow-y-auto",
			);
			const button = body.getByRole("button", { name: "Manage tags…" });
			// Capture after the click's own scroll-into-view, before React unmounts
			// the old modal content (detached nodes report scrollTop = 0).
			button.addEventListener(
				"click",
				() => {
					heldScroll = invokingScroller?.scrollTop ?? 0;
				},
				{ once: true, capture: true },
			);
			await userEvent.click(button);
			await body.findByRole("heading", { name: "Manage tags" });
			await new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			);
			expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
			expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
		};
		const restored = async () => {
			await body.findByRole("heading", {
				name: "Tags for “Review the migration safety checks”",
			});
			expect(body.getByRole("checkbox", { name: "Concept" })).toBeChecked();
			expect(body.getByRole("radio", { name: "Project" })).toBeChecked();
			expect(body.getByRole("textbox", { name: "Search tags" })).toHaveValue(
				"e",
			);
			await waitFor(() =>
				expect(
					document.activeElement,
					`Picker return focus: ${document.activeElement?.getAttribute("role") ?? "button"} ${document.activeElement?.textContent}`,
				).toBe(body.getByRole("button", { name: "Manage tags…" })),
			);
			expect(
				document.querySelector<HTMLElement>("[role=dialog] .overflow-y-auto")
					?.scrollTop,
			).toBe(heldScroll);
		};
		await openManager();
		await userEvent.click(body.getByRole("button", { name: "Cancel" }));
		await restored();
		expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(0);
		await openManager();
		await userEvent.type(
			body.getByRole("textbox", { name: "New tag name" }),
			"Nested category",
		);
		await userEvent.click(body.getByRole("button", { name: "Add" }));
		await userEvent.click(body.getByRole("button", { name: "Apply" }));
		await restored();
		expect(
			body.getByRole("checkbox", { name: "Nested category" }),
		).not.toBeChecked();
		expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(1);
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(0);
		await userEvent.click(body.getByRole("button", { name: "Cancel" }));
		await waitFor(() =>
			expect(document.activeElement).toBe(
				document.querySelector(
					'[data-session-row="111111111111"] [data-chat-row]',
				),
			),
		);
		document.body.dataset.tagsProof =
			"PASS: picker checks/primary/search/scroll survive Manage Cancel and Apply; refreshed categories; one modal; no assignment; row focus returned";
	},
};

export const ManagementFailureRetry: Story = {
	...story("tags-on"),
	play: async () => {
		await manage();
		const original = window.api.desktop.request;
		let attempts = 0;
		window.api.desktop.request = async (request) => {
			if (request.op === "tags.replace" && attempts++ === 0) {
				calls.push(request);
				return {
					status: 503,
					body: {
						detail: "Fixture registry save failed. Retry keeps the draft.",
					},
				};
			}
			return original(request);
		};
		const body = within(document.body);
		await userEvent.type(
			body.getByRole("textbox", { name: "New tag name" }),
			"Retry category",
		);
		await userEvent.click(body.getByRole("button", { name: "Add" }));
		await userEvent.click(body.getByRole("button", { name: "Apply" }));
		await body.findByRole("alert");
		await body.findByText("Tags were not saved. Try again.");
		expect(body.getByText("Retry category")).toBeTruthy();
		expect(useSessionTagsStore.getState().categories).toHaveLength(3);
		await userEvent.click(body.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(document.querySelector("[role=dialog]")).toBeNull(),
		);
		expect(
			useSessionTagsStore
				.getState()
				.categories.some((tag) => tag.name === "Retry category"),
		).toBe(true);
		expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(2);
		window.api.desktop.request = original;
		document.body.dataset.tagsProof =
			"PASS: failed Apply retains draft; Retry repeats one full desired-state request and closes on success";
	},
};

export const AssignPrimaryAnnouncement: Story = {
	...story("tags-on"),
	play: async () => {
		await picker();
		await userEvent.click(
			within(document.body).getByRole("radio", { name: "Project" }),
		);
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Apply" }),
		);
		await within(document.body).findByText(
			"Tags updated. Grouped under Project.",
		);
		await waitFor(() =>
			expect(document.querySelector("[role=dialog]")).toBeNull(),
		);
		await waitFor(() =>
			expect(document.activeElement).toBe(
				document.querySelector(
					'[data-session-row="111111111111"] [data-chat-row]',
				),
			),
		);
		document.body.dataset.tagsProof =
			"PASS: primary assignment announces Tags updated. Grouped under Project.; row focus returned";
	},
};

export const DeleteNameReuseGuard: Story = {
	...story("tags-on"),
	play: async () => {
		await manage();
		const body = within(document.body);
		const project = document.querySelector<HTMLElement>(
			'[data-tag-id="project"]',
		);
		if (!project) throw new Error("Missing Project tag");
		await userEvent.click(
			within(project).getByRole("button", { name: "Delete" }),
		);
		await userEvent.click(body.getByRole("button", { name: "Delete tag" }));
		fireEvent.change(body.getByRole("textbox", { name: "New tag name" }), {
			target: { value: "Project" },
		});
		await userEvent.click(body.getByRole("button", { name: "Add" }));
		await waitFor(() =>
			expect(
				document.querySelector('[data-tag-id="new:Project"]'),
			).not.toBeNull(),
		);
		await userEvent.click(body.getByRole("button", { name: "Apply" }));
		await body.findByText(
			"Apply the deletion first, then add “Project” again.",
		);
		expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(0);
		expect(
			useSessionTagsStore
				.getState()
				.categories.some((tag) => tag.id === "project"),
		).toBe(true);
		await userEvent.click(body.getByRole("button", { name: "Cancel" }));
		await waitFor(() =>
			expect(document.querySelector("[role=dialog]")).toBeNull(),
		);
		document.body.dataset.tagsProof =
			"PASS: delete + same-name ID-less add blocks Apply; zero registry writes; existing assignments retained";
	},
};

export const PickerLoadingFocus: Story = {
	...story("picker-loading", 220),
	play: async () => {
		await picker();
		const heading = within(document.body).getByRole("heading", {
			name: "Tags for “Review the migration safety checks”",
		});
		expect(document.activeElement).toBe(heading);
		const scroller = document.querySelector<HTMLElement>(
			"[role=dialog] .overflow-y-auto",
		);
		if (!scroller) throw new Error("No picker scroll body");
		const padding = getComputedStyle(scroller);
		expect(padding.paddingLeft).toBe("4px");
		expect(padding.paddingBottom).toBe("4px");
		const manageButton = within(document.body).getByRole("button", {
			name: "Manage tags…",
		});
		const bodyBox = scroller.getBoundingClientRect();
		const manageBox = manageButton.getBoundingClientRect();
		expect(manageBox.left - bodyBox.left).toBeGreaterThanOrEqual(4);
		expect(bodyBox.bottom - manageBox.bottom).toBeGreaterThanOrEqual(4);
		const measurements = `loading body ${bodyBox.width}×${bodyBox.height}px, ring inset left ${manageBox.left - bodyBox.left}px bottom ${bodyBox.bottom - manageBox.bottom}px`;
		expect(finishRegistry).not.toBeNull();
		finishRegistry?.();
		await waitFor(() =>
			expect(document.activeElement).toBe(
				within(document.body).getByRole("checkbox", { name: "Review" }),
			),
		);
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Cancel" }),
		);
		document.body.dataset.tagsProof = `PASS: initial focus heading; loaded focus first checkbox; ${measurements}`;
	},
};
