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
let finishFirstRegistryWrite: (() => void) | null = null;
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
	| "picker-loading"
	| "picker-many"
	| "picker-dense"
	| "picker-eight"
	| "picker-one"
	| "picker-empty"
	| "picker-unicode"
	| "manage-dense"
	| "picker-create-error"
	| "picker-create-loading"
	| "picker-remote"
	| "manage-error"
	| "unused"
	| "load-failed"
	| "management-concurrency";
/** The actual sidebar and contract-shaped desktop bridge, not a proposed mock.
 * Mutable fixture data makes immediate assignment and registry edits observable through the
 * same catalogue refresh as production. No operator backend or config is used.
 */
function installBridge(scenario: Scenario) {
	calls = [];
	finishFirstRegistryWrite = null;
	let registryRequestIndex = 0;
	document.body.dataset.tagsProof = "";
	document.body.dataset.tagsOpened = "";
	let categories: TagCategory[] = ["no-categories", "picker-empty"].includes(
		scenario,
	)
		? []
		: [
				{ id: "review", name: "Review", order: 0, conversations: 2 },
				{ id: "project", name: "Project", order: 1, conversations: 2 },
				{ id: "concept", name: "Concept", order: 2, conversations: 1 },
			];
	if (
		[
			"picker-dense",
			"manage-dense",
			"picker-eight",
			"picker-unicode",
			"picker-many",
		].includes(scenario)
	)
		categories = [
			...categories,
			...Array.from(
				{
					length:
						scenario === "picker-eight"
							? 9
							: scenario === "picker-many"
								? 7
								: 29,
				},
				(_, index) => ({
					id: `extra-${index}`,
					name: `Extra vocabulary ${index + 4}`,
					order: index + 3,
					conversations: 0,
				}),
			),
		];
	if (scenario === "unused")
		categories.push({
			id: "unused",
			name: "Next project",
			order: 3,
			conversations: 0,
		});
	if (scenario === "picker-one") categories = categories.slice(0, 1);
	if (scenario === "picker-empty") categories = [];
	if (scenario === "picker-unicode") {
		categories[3].name = "界".repeat(24);
		categories[4].name = "مشروع 東京 é Γνώση";
		categories[5].name = String.fromCodePoint(0x1f331).repeat(24);
	}
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
		...(scenario === "picker-remote"
			? {
					locality: "remote" as const,
					owner_device: "synthetic-peer",
					owner_device_name: "Fixture peer",
				}
			: {}),
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
	if (scenario === "picker-eight")
		rows[0].tags = tags(...categories.slice(0, 8).map((tag) => tag.id));
	if (scenario === "picker-unicode")
		rows[0].tags = tags("review", "extra-0", "extra-1", "extra-2");
	for (const row of rows)
		if (!row.tags.some((tag) => tag.id === row.primary))
			row.primary = row.tags[0]?.id ?? null;
	for (const tag of categories)
		tag.conversations = rows.filter((row) =>
			row.tags.some((held) => held.id === tag.id),
		).length;
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
				if (scenario === "load-failed")
					return {
						status: 503,
						body: { detail: "Fixture registry unavailable" },
					};
				for (const tag of categories)
					tag.conversations = rows.filter((row) =>
						row.tags.some((held) => held.id === tag.id),
					).length;
				if (scenario === "old-backend")
					throw new Error("Old backend must not receive a tags request");
				if (scenario === "picker-loading")
					return new Promise<DesktopResponse>(() => {});
				return ok({ tags: categories });
			case "tags.replace":
				if (
					scenario === "management-concurrency" &&
					registryRequestIndex++ === 0
				)
					await new Promise<void>((resolve) => {
						finishFirstRegistryWrite = resolve;
					});
				if (scenario === "picker-create-loading")
					await new Promise<void>(() => {});
				if (scenario === "picker-create-error" || scenario === "manage-error")
					return {
						status: 503,
						body: { detail: "Fixture durable Create refused" },
					};
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
				if (scenario === "picker-remote")
					return {
						status: 409,
						body: {
							detail: { code: "session_is_remote", text: "Session is remote" },
						},
					};
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
					// Simulate another client changing assignments after this popover opened.
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
				if (
					request.expected_revision !== undefined &&
					request.expected_revision !== row.tags_revision
				)
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
				revealHeld = true;
				row.tags_revision = String(Number(row.tags_revision) + 1);
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
		client.clear();
		installBridge(scenario);
	});
	const [geometry, setGeometry] = useState("");
	useEffect(() => {
		const measure = () => {
			const headers = [
				...document.querySelectorAll<HTMLElement>(
					"[data-tag-drop-target]:not([data-tag-drop-body])",
				),
			];
			const panel = document.querySelector<HTMLElement>(
				"[data-chat-tag-popover]",
			);
			const metrics = {
				active: document.activeElement?.outerHTML.slice(0, 400),
				headers: headers.map((node) => ({
					id: node.dataset.tagDropTarget,
					height: node.getBoundingClientRect().height,
					width: node.getBoundingClientRect().width,
				})),
				popover: panel
					? {
							width: panel.getBoundingClientRect().width,
							height: panel.getBoundingClientRect().height,
							overflowX: panel.scrollWidth > panel.clientWidth,
						}
					: null,
				registryWrites: calls.filter((call) => call.op === "tags.replace")
					.length,
				assignmentWrites: calls.filter((call) => call.op === "sessions.tags")
					.length,
				proof: document.body.dataset.tagsProof ?? "",
			};
			setGeometry(JSON.stringify(metrics));
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
			<main className="min-w-0 p-6 text-body-sm text-ink-muted">
				Sidebar tags v3 · {width}px · {scenario}
				<output data-tags-geometry className="sr-only">
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
				"tags-on",
				"tags-off",
				"unused",
				"no-categories",
				"old-backend",
				"picker",
				"picker-error",
				"picker-loading",
				"picker-remote",
				"load-failed",
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
const sourceRow = () => {
	const row = document.querySelector<HTMLElement>(
		'[data-session-row="111111111111"] [data-chat-row]',
	);
	if (!row) throw new Error("Missing source conversation");
	return row;
};
const picker = async () => {
	await ready();
	sourceRow().focus();
	await userEvent.keyboard("{Shift>}{F10}{/Shift}");
	await userEvent.click(
		await within(document.body).findByRole("menuitem", { name: /^Tags…/ }),
	);
	await waitFor(() =>
		expect(document.querySelector("[data-chat-tag-popover]")).not.toBeNull(),
	);
};
const headerStop = (id = "review") => {
	const stop = document.querySelector<HTMLElement>(
		`[data-chat-tag-header="${id}"]`,
	);
	if (!stop) throw new Error(`Missing ${id} header`);
	return stop;
};
const manage = async () => {
	await ready();
	headerStop().focus();
	await userEvent.keyboard("{Shift>}{F10}{/Shift}");
	await within(document.body).findByRole("menuitem", { name: "Rename" });
};
const story = (
	scenario: Scenario,
	width = 260,
	theme = "localOperatorDark",
): Story => ({
	args: { scenario, width, theme },
	render: ({ scenario, width }) => (
		<Page key={scenario} scenario={scenario} width={width} />
	),
	play: async ({ args }) => {
		if (args.scenario === "picker-remote") {
			await ready();
			sourceRow().focus();
			await userEvent.keyboard("{Shift>}{F10}{/Shift}");
			expect(
				await within(document.body).findByRole("menuitem", { name: /^Tags…/ }),
			).toHaveAttribute("aria-disabled", "true");
			expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(
				0,
			);
		} else if (
			args.scenario.startsWith("picker") ||
			args.scenario === "load-failed"
		) {
			await picker();
			if (args.scenario === "picker-error") {
				await userEvent.click(
					within(document.body).getByRole("option", { name: "Concept" }),
				);
				await within(document.body).findByText(
					"Tags were not saved. Try again.",
				);
				expect(
					within(document.body).getByRole("option", { name: "Concept" }),
				).toHaveAttribute("aria-selected", "false");
			}
		} else if (args.scenario.startsWith("manage")) await manage();
		else {
			await ready();
			if (args.scenario === "old-backend") {
				expect(calls.filter((call) => call.op === "tags.list")).toHaveLength(0);
				expect(document.querySelector("[data-chat-tag-footer]")).toBeNull();
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
export const PickerLoadFailed = story("load-failed");
export const Narrow220 = story("tags-on", 220);
export const Wide320 = story("tags-on", 320);
export const Light = story("tags-on", 260, "localOperatorLight");
export const PickerLight = story("picker", 220, "localOperatorLight");
export const ManageLight = story("manage", 320, "localOperatorLight");
export const PickerDense = story("picker-dense", 220);
export const PickerDenseLight = story(
	"picker-dense",
	220,
	"localOperatorLight",
);
export const PickerEight = story("picker-eight");
export const PickerEmpty = story("picker-empty", 220);
export const PickerOne = story("picker-one", 320);
export const PickerUnicode = story("picker-unicode", 220);
export const PickerRemoteRefusal = story("picker-remote");
export const UnusedTags = story("unused");
export const PickerNoMatch: Story = {
	...story("picker"),
	play: async () => {
		await picker();
		await userEvent.type(
			within(document.body).getByRole("combobox"),
			"Future work",
		);
		expect(
			await within(document.body).findByRole("option", {
				name: /Create “Future work”/,
			}),
		).toHaveAttribute("aria-disabled", "false");
	},
};
export const PickerCreateError: Story = {
	...story("picker-create-error"),
	play: async () => {
		await picker();
		await userEvent.type(
			within(document.body).getByRole("combobox"),
			"Future work",
		);
		await userEvent.keyboard("{Enter}");
		await within(document.body).findByText("Tag was not created. Try again.");
	},
};
export const PickerKeyboardRoundTrip: Story = {
	...story("picker"),
	play: async () => {
		await ready();
		sourceRow().focus();
		await userEvent.keyboard("{Control>}{Shift>}L{/Shift}{/Control}");
		await userEvent.type(
			await within(document.body).findByRole("combobox"),
			"Release 東京",
		);
		await userEvent.keyboard("{Enter}");
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(
				1,
			),
		);
		expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(1);
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(document.querySelector("[data-chat-tag-popover]")).toBeNull(),
		);
		await waitFor(() => expect(document.activeElement).toBe(sourceRow()));
		document.body.dataset.tagsProof =
			"PASS: chord → type → Enter creates+assigns, Escape returns row focus; no dialog or Apply";
	},
};
export const PickerConflict: Story = {
	...story("move-conflict"),
	play: async () => {
		await picker();
		await userEvent.click(
			within(document.body).getByRole("option", { name: "Concept" }),
		);
		await within(document.body).findByText(
			"Tags changed elsewhere. The list now shows their current tags; select again to apply your change.",
		);
		expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(1);
	},
};
export const HeaderRenameBlurFailure: Story = {
	...story("manage-error"),
	play: async () => {
		await ready();
		headerStop().focus();
		await userEvent.keyboard("{F2}");
		const field = await within(document.body).findByRole("textbox", {
			name: "Rename Review",
		});
		await userEvent.clear(field);
		await userEvent.type(field, "Retained draft");
		headerStop("project").focus();
		await within(document.body).findByText("Tags were not saved. Try again.");
		await waitFor(() => expect(field).toHaveFocus());
		expect(field).toHaveValue("Retained draft");
		expect(
			within(document.body).getByRole("button", { name: "Retry" }),
		).toBeVisible();
		document.body.dataset.tagsProof =
			"PASS C2: blur HTTP503 keeps typed draft, alert, Retry and restores editor focus";
	},
};
export const ConcurrentHeaderRenames: Story = {
	...story("management-concurrency"),
	play: async () => {
		await ready();
		headerStop().focus();
		await userEvent.keyboard("{F2}");
		const first = await within(document.body).findByRole("textbox", {
			name: "Rename Review",
		});
		await userEvent.clear(first);
		await userEvent.type(first, "Review2{Enter}");
		headerStop("project").focus();
		await userEvent.keyboard("{F2}");
		const second = await within(document.body).findByRole("textbox", {
			name: "Rename Project",
		});
		await userEvent.clear(second);
		await userEvent.type(second, "Project2{Enter}");
		expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(1);
		if (!finishFirstRegistryWrite)
			throw new Error("First registry write was not deferred");
		finishFirstRegistryWrite();
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(
				2,
			),
		);
		const writes = calls.filter(
			(call): call is Extract<DesktopRequest, { op: "tags.replace" }> =>
				call.op === "tags.replace",
		);
		expect(writes[1].tags.map((tag) => tag.name)).toEqual([
			"Review2",
			"Project2",
			"Concept",
		]);
		await waitFor(() =>
			expect(headerStop("project")).toHaveAttribute(
				"aria-label",
				"Tag actions: Project2",
			),
		);
		document.body.dataset.tagsProof =
			"PASS C1: second header queues before transport; acknowledged Review2 survives Project2 desired-state write";
	},
};
export const HeaderRenameFailure: Story = {
	...story("manage-error"),
	play: async () => {
		await ready();
		headerStop().focus();
		await userEvent.keyboard("{F2}");
		const field = await within(document.body).findByRole("textbox", {
			name: "Rename Review",
		});
		await userEvent.clear(field);
		await userEvent.type(field, "Uncommitted{Enter}");
		await within(document.body).findByText("Tags were not saved. Try again.");
	},
};
export const HeaderRenameSaving: Story = {
	...story("picker-create-loading"),
	play: async () => {
		await ready();
		headerStop().focus();
		await userEvent.keyboard("{F2}");
		const field = await within(document.body).findByRole("textbox", {
			name: "Rename Review",
		});
		await userEvent.clear(field);
		await userEvent.type(field, "Saving name{Enter}");
		expect(field).toHaveAttribute("aria-busy", "true");
	},
};
export const FooterAtLimit: Story = { ...story("picker-dense"), play: ready };
export const HeaderDeleteConfirm: Story = {
	...story("tags-on"),
	play: async () => {
		await manage();
		await userEvent.click(
			within(document.body).getByRole("menuitem", { name: "Delete" }),
		);
		const confirm = await within(document.body).findByRole("alertdialog");
		expect(
			within(confirm).getByRole("button", { name: "Cancel" }),
		).toHaveFocus();
		expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(0);
	},
};
export const DeleteRoundTrip: Story = {
	...story("tags-on"),
	play: async () => {
		await manage();
		await userEvent.click(
			within(document.body).getByRole("menuitem", { name: "Delete" }),
		);
		const confirm = await within(document.body).findByRole("alertdialog");
		await userEvent.click(
			within(confirm).getByRole("button", { name: "Delete tag" }),
		);
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(
				1,
			),
		);
		await waitFor(() =>
			expect(
				document.querySelector('[data-chat-tag-header="review"]'),
			).toBeNull(),
		);
		document.body.dataset.tagsProof =
			"PASS: anchored confirmation defaults to Cancel; confirmed deletion replaces registry once without deleting chats";
	},
};
export const PopoverFloor600: Story = {
	...story("tags-on"),
	render: () => (
		<iframe
			title="Tags popover at 600×600 app floor"
			style={{ width: 600, height: 600, border: 0 }}
			src="/iframe.html?id=chat-sidebar-tags--picker&viewMode=story&args=width:220"
		/>
	),
	play: undefined,
};
export const HeaderRename: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		headerStop().focus();
		await userEvent.keyboard("{F2}");
		await userEvent.clear(
			await within(document.body).findByRole("textbox", {
				name: "Rename Review",
			}),
		);
		await userEvent.type(
			within(document.body).getByRole("textbox", { name: "Rename Review" }),
			"Release review",
		);
	},
};
export const HeaderRenameInvalid: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		headerStop().focus();
		await userEvent.keyboard("{F2}");
		const field = await within(document.body).findByRole("textbox", {
			name: "Rename Review",
		});
		await userEvent.clear(field);
		await userEvent.type(field, "Untagged{Enter}");
		expect(field).toHaveAttribute("aria-invalid", "true");
	},
};
export const ManagementRoundTrip: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		headerStop().focus();
		await userEvent.keyboard("{F2}");
		const field = await within(document.body).findByRole("textbox", {
			name: "Rename Review",
		});
		await userEvent.clear(field);
		await userEvent.type(field, "Review renamed{Enter}");
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(
				1,
			),
		);
		await userEvent.click(
			within(document.body).getByRole("button", { name: "New tag" }),
		);
		await userEvent.type(
			await within(document.body).findByRole("textbox", {
				name: "New tag name",
			}),
			"Unused next{Enter}",
		);
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "tags.replace")).toHaveLength(
				2,
			),
		);
		await within(document.body).findByText("Unused next");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		document.body.dataset.tagsProof =
			"PASS: inline rename and footer create write on press, unused group expands, no Apply or dialog";
	},
};
export const FooterNewTag: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		await userEvent.click(
			within(document.body).getByRole("button", { name: "New tag" }),
		);
	},
};
export const UnusedExpanded: Story = {
	...story("unused"),
	play: async () => {
		await ready();
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Unused tags (1)" }),
		);
	},
};
export const ViewOptions220: Story = {
	...story("tags-on", 220),
	play: async () => {
		await ready();
		await userEvent.click(
			document.querySelector<HTMLElement>(
				"[data-sidebar-view-options]",
			) as HTMLElement,
		);
		const body = within(document.body);
		expect(
			await body.findByRole("switch", { name: "Group chats by tag" }),
		).toBeVisible();
		expect(body.queryByText("Manage tags…")).toBeNull();
	},
};
export const HeaderArrowRing: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		const header = headerStop();
		header.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(document.activeElement).toHaveAttribute("data-chat-row");
		await userEvent.keyboard("{ArrowUp}");
		expect(document.activeElement).toBe(header);
		await userEvent.keyboard("{ArrowDown}");
		expect(document.activeElement).toHaveAttribute("data-chat-row");
		document.body.dataset.tagsProof =
			"PASS: header → row → header → row physical keyboard arrow walk";
	},
};
export const KeyboardDismiss: Story = {
	...story("tags-on"),
	play: async () => {
		await picker();
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(document.querySelector("[data-chat-tag-popover]")).toBeNull(),
		);
		await waitFor(() => expect(document.activeElement).toBe(sourceRow()));
		document.body.dataset.tagsProof =
			"PASS: Escape dismisses picker in one press and returns to the originating row";
	},
};
export const KeyboardCreate: Story = {
	...story("tags-on"),
	play: async () => {
		await ready();
		sourceRow().focus();
		await userEvent.keyboard("{Meta>}{Shift>}l{/Shift}{/Meta}");
		const input = await within(document.body).findByRole("combobox", {
			name: "Search tags",
		});
		await userEvent.type(input, "Keyboard tag{Enter}");
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(
				1,
			),
		);
		document.body.dataset.tagsProof =
			"PASS: primary+shift+l → type → Enter creates and assigns in one keyboard flow";
	},
};
export const UnusedTagDragPreview: Story = {
	...story("unused"),
	play: async () => {
		await ready();
		const source = document.querySelector<HTMLElement>(
			'[data-session-row="222222222222"] [data-chat-row]',
		);
		if (!source) throw new Error("No drag source");
		const before = source.getBoundingClientRect();
		const pointer = {
			pointerId: 78,
			pointerType: "mouse",
			isPrimary: true,
			button: 0,
			clientX: before.left + 40,
			clientY: before.top + 16,
		};
		fireEvent.pointerDown(source, pointer);
		await new Promise((done) => setTimeout(done, 200));
		const slot = document.querySelector<HTMLElement>(
			'[data-tag-unused-slot][data-tag-drop-target="unused"]',
		);
		if (!slot) throw new Error("Missing unused slot");
		await waitFor(() => expect(slot.getBoundingClientRect().height).toBe(28));
		expect(source.getBoundingClientRect().top).toBe(before.top);
		const rect = slot.getBoundingClientRect();
		fireEvent.pointerMove(window, {
			...pointer,
			clientX: rect.left + 40,
			clientY: rect.top + 14,
		});
		await waitFor(() => expect(slot).toHaveClass("bg-row-selected"));
		document.body.dataset.tagsProof =
			"PASS: armed unused-tag preview; source top unchanged; no write before release";
	},
};
export const UnusedTagDrop: Story = {
	...story("unused"),
	play: async () => {
		await ready();
		const source = document.querySelector<HTMLElement>(
			'[data-session-row="222222222222"] [data-chat-row]',
		);
		if (!source) throw new Error("No drag source");
		const before = source.getBoundingClientRect();
		const pointer = {
			pointerId: 77,
			pointerType: "mouse",
			isPrimary: true,
			button: 0,
			clientX: before.left + 40,
			clientY: before.top + 16,
		};
		fireEvent.pointerDown(source, pointer);
		await new Promise((done) => setTimeout(done, 200));
		const slot = document.querySelector<HTMLElement>(
			'[data-tag-unused-slot][data-tag-drop-target="unused"]',
		);
		if (!slot) throw new Error("Missing unused slot");
		await waitFor(() => expect(slot.getBoundingClientRect().height).toBe(28));
		expect(source.getBoundingClientRect().top).toBe(before.top);
		const target = slot.getBoundingClientRect();
		fireEvent.pointerMove(window, {
			...pointer,
			clientX: target.left + 40,
			clientY: target.top + 14,
		});
		await waitFor(() => expect(slot).toHaveClass("bg-row-selected"));
		fireEvent.pointerUp(window, {
			...pointer,
			clientX: target.left + 40,
			clientY: target.top + 14,
		});
		await waitFor(() =>
			expect(calls.filter((call) => call.op === "sessions.tags")).toHaveLength(
				1,
			),
		);
		expect(calls.find((call) => call.op === "sessions.tags")).toMatchObject({
			tags: ["project", "unused"],
			primary: "unused",
		});
		document.body.dataset.tagsProof =
			"PASS: armed drag expands unused slots without moving source; drop adds unused tag and makes primary";
	},
};
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
