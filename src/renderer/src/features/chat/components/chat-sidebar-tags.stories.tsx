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

const REMOVE_TAG_MENU_ITEM = /Remove (all tags|tag)/;
let calls: DesktopRequest[] = [];
let finishRegistry: (() => void) | null = null;
type Scenario =
	| "drop-ux"
	| "held-pin"
	| "pinned-tags"
	| "move-conflict"
	| "menu-wide"
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
	document.body.dataset.tagsOpened = "";
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
	let revealHeld = false;
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
		pinned:
			scenario === "drop-ux" && row.id === "555555555555"
				? true
				: ["held-pin", "pinned-tags"].includes(scenario) &&
						row.id === "222222222222"
					? true
					: row.pinned,
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
		tags_revision: "0",
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
						...(scenario === "menu-wide" ? { session_archive: 1 } : {}),
						session_search: 1,
						...(scenario === "old-backend" ? {} : { session_tags: 1 }),
					},
				});
			case "sessions.list":
				return ok({
					sessions:
						scenario === "held-pin" && !revealHeld
							? rows.filter((row) => row.id !== "222222222222")
							: rows,
					truncated: false,
				});
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
				if (scenario === "move-conflict") {
					// Simulate another client changing assignments after this dialog opened.
					row.tags = tags("project");
					row.primary = "project";
					row.tags_revision = "2";
					return {
						status: 409,
						body: {
							detail: {
								code: "tags_conflict",
								text: "Tags changed elsewhere",
								result: {
									session_id: row.id,
									tags: row.tags,
									primary: row.primary,
									tags_revision: row.tags_revision,
								},
							},
						},
					};
				}
				revealHeld = true;
				row.tags = request.tags.flatMap((id) => {
					const tag = categories.find((entry) => entry.id === id);
					return tag ? [{ id, name: tag.name }] : [];
				});
				row.primary = request.primary;
				return ok({
					session_id: row.id,
					tags: row.tags,
					primary: row.primary,
					tags_revision: row.tags_revision,
				});
			}
			default:
				throw new Error(`Unexpected tag fixture operation: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: { desktop?: { request: typeof handler } };
	};
	page.api = { ...page.api, desktop: { request: handler } };
	useCanonicalSessionsStore.setState({
		sessions: [],
		pinFacts:
			scenario === "held-pin"
				? {
						"222222222222": {
							pinned: true,
							at: 10000,
							title: "Held pinned conversation",
							updated_at: now,
						},
					}
				: {},
	});
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
					onSelectConversation={(id) => {
						document.body.dataset.tagsOpened = id;
					}}
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
		width: { control: "select", options: [220, 260, 320, 640] },
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

/** Real sidebar DOM/optimistic bridge proof. Synthetic pointer events exercise
 * the component lifecycle, not native capture/touch; independent native QA owns
 * those browser delivery guarantees. The node lane separately tests revisions. */
const dragRoundTrip = async (crossSection: boolean, targetBody = false) => {
	await ready();
	const row = () =>
		document.querySelector<HTMLButtonElement>(
			'[data-session-row="222222222222"] [data-chat-row]',
		);
	const button = row();
	if (!button) throw new Error("Missing drag source");
	const box = button.getBoundingClientRect();
	const pointer = {
		pointerId: 41,
		pointerType: "mouse",
		isPrimary: true,
		button: 0,
		clientX: box.left + 60,
		clientY: box.top + 16,
	};
	fireEvent.pointerDown(button, pointer);
	fireEvent.pointerUp(window, pointer);
	fireEvent.click(button, { detail: 1 });
	expect(document.body.dataset.tagsOpened).toBe("222222222222");
	document.body.dataset.tagsOpened = "";
	fireEvent.pointerDown(button, pointer);
	fireEvent.pointerMove(window, { ...pointer, clientY: pointer.clientY + 6 });
	await new Promise((resolve) => setTimeout(resolve, 200));
	fireEvent.pointerUp(window, { ...pointer, clientY: pointer.clientY + 6 });
	expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(0);
	fireEvent.click(button, { detail: 1 });
	expect(document.body.dataset.tagsOpened).toBe("");
	fireEvent.pointerDown(button, pointer);
	await new Promise((resolve) => setTimeout(resolve, 200));
	const sourceSection = button.closest<HTMLElement>("[data-chat-section]");
	const header = crossSection
		? document.querySelector<HTMLElement>(
				`[data-chat-section="pinned"] [data-tag-drop-target="review"]${targetBody ? "[data-tag-drop-body]" : ":not([data-tag-drop-body])"}`,
			)
		: sourceSection?.querySelector<HTMLElement>(
				'[data-tag-drop-target="review"]',
			);
	if (!header) throw new Error("Missing occupied header");
	const target = header.getBoundingClientRect();
	fireEvent.pointerMove(window, {
		...pointer,
		clientX: target.left + 60,
		clientY: target.top + 14,
	});
	if (crossSection) expect(header).not.toHaveClass("bg-row-selected");
	else await waitFor(() => expect(header).toHaveClass("bg-row-selected"));
	fireEvent.pointerUp(window, {
		...pointer,
		clientX: target.left + 60,
		clientY: target.top + 14,
	});
	if (crossSection) {
		await waitFor(() =>
			expect(document.querySelector("[data-dragging]")).toBeNull(),
		);
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(0);
		expect(
			within(document.body).queryByRole("button", { name: "Undo" }),
		).toBeNull();
		expect(row()?.closest("[data-chat-tag-group]")).toHaveAttribute(
			"data-chat-tag-group",
			"project",
		);
		expect(document.querySelector('[role="menu"]')).toBeNull();
		document.body.dataset.tagsProof =
			"PASS: cross-section occupied header never highlighted; release cancelled with 0 writes, no Undo toast, and unchanged Project bucket";
		return;
	}
	await waitFor(() =>
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(1),
	);
	expect(calls.find((call) => call.op === "sessions.tags")).toMatchObject({
		tags: ["project", "review"],
		primary: "review",
	});
	await waitFor(() =>
		expect(row()?.closest("[data-chat-tag-group]")).toHaveAttribute(
			"data-chat-tag-group",
			"review",
		),
	);
	await userEvent.click(
		within(document.body).getByRole("button", { name: "Undo" }),
	);
	await waitFor(() =>
		expect(row()?.closest("[data-chat-tag-group]")).toHaveAttribute(
			"data-chat-tag-group",
			"project",
		),
	);
	expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(2);
	document.body.dataset.tagsProof =
		"PASS: >5px pending movement wrote nothing; 180ms hold painted occupied header; same-section header assigned/preserved tags without pinning; Undo restored bucket (synthetic DOM pointers, not native capture proof)";
};
/** The operator's Untagged source can cross sections into occupied body space.
 * Keep the tagged-source negative first so its zero-write assertion is independent. */
export const DragAssignRoundTrip: Story = {
	...story("drop-ux"),
	play: async () => {
		await dragRoundTrip(true);
		await dragRoundTrip(true, true);
		await untaggedBodyDrop(false);
	},
};

const untaggedBodyDrop = async (previewOnly: boolean) => {
	await ready();
	const source = document.querySelector<HTMLElement>(
		'[data-session-row="555555555555"] [data-chat-row]',
	);
	const target = document.querySelector<HTMLElement>(
		'[data-chat-section="today"] [data-tag-drop-body][data-tag-drop-target="review"]',
	);
	if (!source || !target) throw new Error("Missing Untagged/body fixture");
	expect(getComputedStyle(source).cursor).toBe("grab");
	const box = source.getBoundingClientRect();
	const pointer = {
		pointerId: 81,
		pointerType: "mouse",
		isPrimary: true,
		button: 0,
		clientX: box.left + 60,
		clientY: box.top + 16,
	};
	fireEvent.pointerDown(source, pointer);
	await new Promise((resolve) => setTimeout(resolve, 200));
	await waitFor(() => expect(getComputedStyle(source).cursor).toBe("grabbing"));
	const rect = target.getBoundingClientRect();
	const over = {
		...pointer,
		clientX: rect.left + 60,
		clientY: rect.top + rect.height / 2,
	};
	fireEvent.pointerMove(window, over);
	await waitFor(() =>
		expect(target.closest("[data-chat-tag-group]")).toHaveAttribute(
			"data-tag-drop-preview",
			"true",
		),
	);
	const group = target.closest("[data-chat-tag-group]");
	const header = group?.querySelector<HTMLElement>(
		"[data-tag-drop-target]:not([data-tag-drop-body])",
	);
	if (!header) throw new Error("Missing matching group header");
	expect(header.dataset.tagDropTarget).toBe(target.dataset.tagDropTarget);
	expect(
		document
			.elementFromPoint(over.clientX, over.clientY)
			?.closest("[data-tag-drop-body]"),
	).toBe(target);
	document.body.dataset.tagsProof = `PASS: cursor grab → grabbing; header/body ID ${header.dataset.tagDropTarget}; body ${rect.width}×${rect.height}px; tagged cross-section 0 writes; synthetic pointer preview (not native delivery proof)`;
	if (previewOnly) return;
	fireEvent.pointerUp(window, over);
	await waitFor(() =>
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(1),
	);
	expect(calls.find((call) => call.op === "sessions.tags")).toMatchObject({
		primary: "review",
		tags: ["review"],
	});
	await waitFor(() =>
		expect(
			document
				.querySelector('[data-session-row="555555555555"]')
				?.closest("[data-chat-tag-group]"),
		).toHaveAttribute("data-chat-tag-group", "review"),
	);
	await userEvent.click(
		within(document.body).getByRole("button", { name: "Undo" }),
	);
	await waitFor(() =>
		expect(
			document
				.querySelector('[data-session-row="555555555555"]')
				?.closest("[data-chat-tag-group]"),
		).toHaveAttribute("data-chat-tag-group", "untagged"),
	);
	expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(2);
	document.body.dataset.tagsProof +=
		"; Untagged→tagged body 1 write; Undo restored Untagged (2 total)";
};
export const CursorAndBodyTarget: Story = {
	...story("drop-ux", 220),
	play: async () => untaggedBodyDrop(true),
};
export const SameSectionDragRoundTrip: Story = {
	...story("tags-on"),
	play: async () => dragRoundTrip(false),
};

export const MoveMenuRoundTrip: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		const body = within(document.body);
		const button = () =>
			document.querySelector<HTMLElement>(
				'[data-session-row="111111111111"] [data-chat-row]',
			);
		const source = button();
		if (!source) throw new Error("Missing move source");
		fireEvent.contextMenu(source);
		await body.findByRole("menuitem", { name: "Move to tag…" });
		expect(body.getAllByRole("menuitem")).toHaveLength(9);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "Move to tag…" }),
		);
		await body.findByRole("heading", {
			name: "Move “Review the migration safety checks”",
		});
		await userEvent.click(body.getByRole("button", { name: "Concept" }));
		await waitFor(() =>
			expect(document.querySelector("[role=dialog]")).toBeNull(),
		);
		await waitFor(() => expect(document.activeElement).toBe(button()));
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(1);
		expect(calls.find((call) => call.op === "sessions.tags")).toMatchObject({
			tags: ["review", "project", "concept"],
			primary: "concept",
		});
		const moved = button();
		if (!moved) throw new Error("Moved row missing");
		fireEvent.contextMenu(moved);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "Remove all tags (3)" }),
		);
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(
				2,
			),
		);
		expect(
			calls.filter((call) => call.op === "sessions.tags")[1],
		).toMatchObject({ tags: [], primary: null });
		const cleared = button();
		if (!cleared) throw new Error("Cleared source missing");
		fireEvent.contextMenu(cleared);
		await body.findByRole("menuitem", { name: "Move to tag…" });
		expect(body.getAllByRole("menuitem")).toHaveLength(8);
		expect(
			body.queryByRole("menuitem", { name: REMOVE_TAG_MENU_ITEM }),
		).toBeNull();
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "Escape",
		});
		document.body.dataset.tagsProof =
			"PASS: Move picker preserves assignments and returns row focus; tagged Remove all tags (3) clears once; untagged menu omits Remove and retains Move to tag";
	},
};

export const DragPreview: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		const row = document.querySelector<HTMLButtonElement>(
			'[data-session-row="222222222222"] [data-chat-row]',
		);
		const header = row
			?.closest("[data-chat-section]")
			?.querySelector<HTMLElement>('[data-tag-drop-target="review"]');
		if (!row || !header) throw new Error("Missing preview geometry");
		const box = row.getBoundingClientRect();
		const pointer = {
			pointerId: 42,
			pointerType: "mouse",
			isPrimary: true,
			button: 0,
			clientX: box.left + 60,
			clientY: box.top + 16,
		};
		fireEvent.pointerDown(row, pointer);
		await new Promise((resolve) => setTimeout(resolve, 200));
		const target = header.getBoundingClientRect();
		fireEvent.pointerMove(window, {
			...pointer,
			clientX: target.left + 60,
			clientY: target.top + 14,
		});
		await waitFor(() => expect(header).toHaveClass("bg-row-selected"));
		document.body.dataset.tagsProof =
			"PASS: armed row + header selected-ground/accent-outline preview; no assignment before drop";
	},
};
export const TagActionsMenu: Story = {
	...story("menu-wide"),
	play: async () => {
		await ready();
		const row = document.querySelector<HTMLElement>(
			'[data-session-row="111111111111"] [data-chat-row]',
		);
		if (!row) throw new Error("Missing menu source");
		fireEvent.contextMenu(row);
		await within(document.body).findByRole("menuitem", {
			name: "Move to tag…",
		});
	},
};
export const MovePicker: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		const row = document.querySelector<HTMLElement>(
			'[data-session-row="111111111111"] [data-chat-row]',
		);
		if (!row) throw new Error("Missing move source");
		fireEvent.contextMenu(row);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", {
				name: "Move to tag…",
			}),
		);
		await within(document.body).findByRole("heading", {
			name: "Move “Review the migration safety checks”",
		});
	},
};

export const MoveConflict: Story = {
	...story("move-conflict"),
	play: async () => {
		await ready();
		const body = within(document.body);
		const row = document.querySelector<HTMLElement>(
			'[data-session-row="111111111111"] [data-chat-row]',
		);
		if (!row) throw new Error("Missing conflict source");
		const reads = calls.filter((call) => call.op === "sessions.list").length;
		fireEvent.contextMenu(row);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "Move to tag…" }),
		);
		await userEvent.click(await body.findByRole("button", { name: "Concept" }));
		await body.findByRole("alert");
		await waitFor(() =>
			expect(
				body.getAllByText("Tags changed elsewhere").length,
			).toBeGreaterThan(0),
		);
		await waitFor(() =>
			expect(
				calls.filter((call) => call.op === "sessions.list").length,
			).toBeGreaterThan(reads),
		);
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(1);
		expect(calls.find((call) => call.op === "sessions.tags")).toMatchObject({
			expected_revision: "0",
		});
		const current = useCanonicalSessionsStore
			.getState()
			.sessions.find((entry) => entry.session_id === "111111111111");
		expect(current).toMatchObject({
			primary: "project",
			tags_revision: "2",
			tags: [{ id: "project", name: "Project" }],
		});
		expect(body.queryByRole("button", { name: "Undo" })).toBeNull();
		document.body.dataset.tagsProof =
			"PASS: core-shaped detail.code/detail.result 409 refreshed Project revision 2, showed Tags changed elsewhere, one write attempt, no retry/overwrite/Undo (fixture, not real-core QA)";
	},
};

/** The application floor is 600px. An actual nested browsing context supplies
 * that viewport, so 50dvh measures 300px rather than borrowing the host's 720px. */
export const TagActionsMenu600: Story = {
	...story("menu-wide", 220),
	render: () => (
		<>
			<iframe
				title="Sidebar menu at the 600px application floor"
				src="./iframe.html?id=chat-sidebar-tags--tag-actions-menu&viewMode=story&args=width:220"
				style={{ width: 1000, height: 600, border: 0 }}
			/>
			<output data-floor-proof>Waiting for 600px menu assertions</output>
		</>
	),
	play: async ({ canvasElement }) => {
		const frame = canvasElement.querySelector("iframe");
		if (!frame) throw new Error("Missing 600px viewport");
		await waitFor(
			() =>
				expect(
					frame.contentDocument?.querySelectorAll('[role="menuitem"]').length,
				).toBe(10),
			{ timeout: 15000 },
		);
		const doc = frame.contentDocument;
		const win = frame.contentWindow;
		if (!doc || !win) throw new Error("Missing frame document");
		const menu = doc.querySelector<HTMLElement>('[role="menu"]');
		if (!menu) throw new Error("Missing menu");
		expect(win.innerHeight).toBe(600);
		const items = Array.from(
			doc.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		);
		expect(win.getComputedStyle(menu).overflowY).toBe("auto");
		expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
		for (const item of items)
			expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
		menu.focus();
		fireEvent.keyDown(menu, { key: "End" });
		await waitFor(() => expect(doc.activeElement).toBe(items.at(-1)));
		expect(menu.scrollTop).toBeGreaterThan(0);
		fireEvent.keyDown(doc.activeElement ?? menu, { key: "Home" });
		await waitFor(() => expect(doc.activeElement).toBe(items[0]));
		fireEvent.keyDown(items[0], { key: "End" });
		await waitFor(() => expect(doc.activeElement).toBe(items.at(-1)));
		document.body.dataset.tagsProof = `PASS: 220px sidebar, 600px viewport floor, 10 rows, max-height ${win.getComputedStyle(menu).maxHeight}, scroll ${menu.clientHeight}/${menu.scrollHeight}, >=32px targets, End/Home reach all items`;
		const proof = canvasElement.querySelector("[data-floor-proof]");
		if (proof) proof.textContent = document.body.dataset.tagsProof;
	},
};

export const MoveFailure: Story = {
	...story("picker-error"),
	play: async () => {
		await ready();
		const body = within(document.body);
		const row = document.querySelector<HTMLElement>(
			'[data-session-row="111111111111"] [data-chat-row]',
		);
		if (!row) throw new Error("Missing failure source");
		fireEvent.contextMenu(row);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "Move to tag…" }),
		);
		await userEvent.click(await body.findByRole("button", { name: "Concept" }));
		await waitFor(() =>
			expect(
				body.getAllByText("Tags were not moved. Try again.").length,
			).toBeGreaterThan(0),
		);
		expect(
			useCanonicalSessionsStore
				.getState()
				.sessions.find((entry) => entry.session_id === "111111111111")?.primary,
		).toBe("review");
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(1);
		document.body.dataset.tagsProof =
			"PASS: move 503 rolled back Review, showed Tags were not moved. Try again., no retry/Undo";
	},
};

export const HeldPinnedTagDrop: Story = {
	...story("held-pin"),
	play: async () => {
		await ready();
		const button = document.querySelector<HTMLButtonElement>(
			'[data-session-row="222222222222"] [data-chat-row]',
		);
		const target = document.querySelector<HTMLElement>(
			'[data-chat-section="pinned"] [data-tag-drop-target="review"]',
		);
		if (!button || !target)
			throw new Error("Missing held row or its eligible header");
		expect(
			useCanonicalSessionsStore
				.getState()
				.sessions.some((row) => row.session_id === "222222222222"),
		).toBe(false);
		const box = button.getBoundingClientRect();
		const pointer = {
			pointerId: 77,
			pointerType: "mouse",
			isPrimary: true,
			button: 0,
			clientX: box.left + 60,
			clientY: box.top + 16,
		};
		fireEvent.pointerDown(button, pointer);
		await new Promise((resolve) => setTimeout(resolve, 200));
		const rect = target.getBoundingClientRect();
		const over = {
			...pointer,
			clientX: rect.left + 60,
			clientY: rect.top + 14,
		};
		fireEvent.pointerMove(window, over);
		await waitFor(() => expect(target).toHaveClass("bg-row-selected"));
		expect(document.querySelector("[data-session-pin-indicator]")).toBeNull();
		fireEvent.pointerUp(window, over);
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(
				1,
			),
		);
		expect(calls.find((call) => call.op === "sessions.tags")).toMatchObject({
			sessionId: "222222222222",
			tags: ["review"],
			primary: "review",
		});
		document.body.dataset.tagsProof =
			"PASS: held pin absent from catalogue assigned to same-section Review; header preview had no insertion line; one assignment write";
	},
};
export const PinnedHeaderPreview: Story = {
	...story("pinned-tags"),
	play: async () => {
		await ready();
		const button = document.querySelector<HTMLButtonElement>(
			'[data-session-row="111111111111"] [data-chat-row]',
		);
		const target = document.querySelector<HTMLElement>(
			'[data-chat-section="pinned"] [data-tag-drop-target="project"]',
		);
		if (!button || !target) throw new Error("Missing pinned preview geometry");
		const box = button.getBoundingClientRect();
		const pointer = {
			pointerId: 78,
			pointerType: "mouse",
			isPrimary: true,
			button: 0,
			clientX: box.left + 60,
			clientY: box.top + 16,
		};
		fireEvent.pointerDown(button, pointer);
		await new Promise((resolve) => setTimeout(resolve, 200));
		const rect = target.getBoundingClientRect();
		fireEvent.pointerMove(window, {
			...pointer,
			clientX: rect.left + 60,
			clientY: rect.top + 14,
		});
		await waitFor(() => expect(target).toHaveClass("bg-row-selected"));
		expect(document.querySelector("[data-session-pin-indicator]")).toBeNull();
		document.body.dataset.tagsProof =
			"PASS: same-section Pinned header accent preview, armed row, no pinned insertion line, no write before release";
	},
};

export const SameSectionUntaggedDrop: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		const button = document.querySelector<HTMLButtonElement>(
			'[data-session-row="222222222222"] [data-chat-row]',
		);
		const section = button?.closest("[data-chat-section]");
		const target = section?.querySelector<HTMLElement>(
			'[data-tag-drop-target="untagged"]',
		);
		if (!button || !section || !target)
			throw new Error("Missing same-section Untagged geometry");
		const box = button.getBoundingClientRect();
		const pointer = {
			pointerId: 79,
			pointerType: "mouse",
			isPrimary: true,
			button: 0,
			clientX: box.left + 60,
			clientY: box.top + 16,
		};
		fireEvent.pointerDown(button, pointer);
		await new Promise((resolve) => setTimeout(resolve, 200));
		const rect = target.getBoundingClientRect();
		const over = {
			...pointer,
			clientX: rect.left + 60,
			clientY: rect.top + 14,
		};
		fireEvent.pointerMove(window, over);
		await waitFor(() => expect(target).toHaveClass("bg-row-selected"));
		fireEvent.pointerUp(window, over);
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(
				1,
			),
		);
		expect(calls.find((call) => call.op === "sessions.tags")).toMatchObject({
			tags: [],
			primary: null,
		});
		await waitFor(() =>
			expect(
				document
					.querySelector('[data-session-row="222222222222"]')
					?.closest("[data-chat-tag-group]"),
			).toHaveAttribute("data-chat-tag-group", "untagged"),
		);
		expect(
			document
				.querySelector('[data-session-row="222222222222"]')
				?.closest("[data-chat-section]"),
		).toBe(section);
		document.body.dataset.tagsProof =
			"PASS: eligible same-section Untagged highlighted and cleared all tags/primary in one write without changing section";
	},
};

export const DragPreviewLight: Story = {
	...story("tags-on", 260, "localOperatorLight"),
	play: DragPreview.play,
};
export const PinnedHeaderPreviewLight: Story = {
	...story("pinned-tags", 260, "localOperatorLight"),
	play: PinnedHeaderPreview.play,
};
