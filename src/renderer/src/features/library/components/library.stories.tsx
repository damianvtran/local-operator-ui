/*
 * The Library tab: the catalogue states, the grid/list, the selected preview,
 * the composer and a real multi-slide PPTX.
 *
 * WHAT STANDS IN FOR THE BACKEND: `window.api.desktop.request` and
 * `.media` - the two bridges the shipped page uses. The page, the query layer,
 * the cards, the preview, the PPTX renderer and the composer all run for real;
 * a story that starts issuing an op the fixture does not know fails loudly.
 *
 * THE PPTX FIXTURE IS A REAL FILE (`scripts/fixtures/library/sample.pptx`,
 * four slides, generated with python-pptx). The media stub serves its bytes,
 * so the viewer's parse and canvas render are exercised rather than mocked.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC, ReactNode } from "react";
import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import "../../../styles/index.css";
import "../../chat/components/story-electron-shim";
import samplePptxUrl from "../../../../../../scripts/fixtures/library/sample.pptx?url";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import { LibraryPage } from "./library-page";

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();

const tag = (id: string, name: string, category = "topic") => ({
	id,
	name,
	category,
});

const asset = (
	id: string,
	patch: Partial<DesktopLibraryAsset> = {},
): DesktopLibraryAsset => ({
	id,
	ref: {
		type: "path",
		path: `/Users/dana/Documents/${id}.md`,
		display_path: `~/Documents/${id}.md`,
		digest: null,
		content_type: "text/markdown",
	},
	name: "",
	derived_name: `${id}.md`,
	description: "",
	kind: "markdown",
	category: "document",
	origin: "written",
	origin_group: "created",
	origins: ["written"],
	tags: [],
	primary_tag: null,
	size_bytes: 2048,
	width: null,
	height: null,
	duration_s: null,
	created_at: 1_759_000_000,
	modified_at: 1_759_000_100,
	last_seen_at: 1_759_000_200,
	exists: true,
	highlighted: false,
	highlight_why: null,
	occurrences: [
		{
			session_id: "abcdef123456",
			session_title: "March invoices",
			origin: "written",
			tool: "write_file",
			at: 1_759_000_000,
			intent: null,
			first_seq: 4,
			last_seq: 8,
			child_id: null,
			label: null,
		},
	],
	session_count: 1,
	chat: null,
	preview: { state: "ready", mime_type: "text/markdown", pages: null },
	organized: { at: 1_759_000_300, by: "librarian", confidence: 0.9 },
	locked: false,
	favorite: false,
	archived: false,
	...patch,
});

const ROWS: DesktopLibraryAsset[] = [
	asset("la_0000000000000021", {
		name: "Invoice illustration",
		derived_name: "invoice-hero.png",
		kind: "image",
		category: "image",
		origin: "generated",
		origin_group: "generated",
		ref: {
			type: "artifact",
			path: null,
			display_path: "attachments/invoice-hero.png",
			digest: "0123456789abcdef0123456789abcdef",
			content_type: "image/png",
		},
		size_bytes: 2_500_000,
		width: 1600,
		height: 1000,
		highlighted: true,
		favorite: true,
		tags: [tag("t1", "finance"), tag("t2", "q4", "project")],
		session_count: 3,
	}),
	asset("la_0000000000000022", {
		name: "Q4 launch deck",
		derived_name: "q4-launch.pptx",
		kind: "pptx",
		category: "presentation",
		ref: {
			type: "path",
			path: "/Users/dana/Documents/q4-launch.pptx",
			display_path: "~/Documents/q4-launch.pptx",
			digest: null,
			content_type:
				"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		},
		size_bytes: 18_200_000,
		tags: [tag("t3", "launch", "project")],
	}),
	asset("la_0000000000000023", {
		name: "March invoices",
		derived_name: "march-invoices.md",
		description: "Reconciliation notes for the March invoice run.",
		tags: [tag("t1", "finance"), tag("t4", "notes")],
		favorite: true,
	}),
	asset("la_0000000000000024", {
		name: "Support call",
		derived_name: "support-call.mp3",
		kind: "audio",
		category: "sound",
		origin: "generated",
		origin_group: "generated",
		ref: {
			type: "artifact",
			path: null,
			display_path: "attachments/support-call.mp3",
			digest: "fedcba9876543210fedcba9876543210",
			content_type: "audio/mpeg",
		},
		duration_s: 184,
		size_bytes: 4_400_000,
	}),
	asset("la_0000000000000025", {
		name: "Forecast",
		derived_name: "forecast.xlsx",
		kind: "spreadsheet",
		category: "spreadsheet",
		size_bytes: 96_000,
		tags: [tag("t1", "finance")],
	}),
	asset("la_0000000000000026", {
		name: "Payments API",
		derived_name: "payments-api.ts",
		kind: "code",
		category: "code",
		origin: "mentioned",
		origin_group: "mentioned",
		size_bytes: 12_800,
		highlighted: false,
		organized: null,
	}),
];

type StubState = {
	rows: DesktopLibraryAsset[];
	detail: DesktopLibraryAsset | null;
	hang: boolean;
	building: boolean;
	failList: string | null;
	media: "text" | "pptx" | "error";
	linkedChat: boolean;
};

let stub: StubState = {
	rows: ROWS,
	detail: null,
	hang: false,
	building: false,
	failList: null,
	media: "text",
	linkedChat: false,
};

const PptxBytes = (() => {
	let promise: Promise<Uint8Array> | null = null;
	return () => {
		promise ??= fetch(samplePptxUrl).then(
			async (response) => new Uint8Array(await response.arrayBuffer()),
		);
		return promise;
	};
})();

const listing = () => {
	const rows = stub.rows;
	const counts = {
		category: rows.reduce<Record<string, number>>((acc, row) => {
			acc[row.category] = (acc[row.category] ?? 0) + 1;
			return acc;
		}, {}),
		origin_group: rows.reduce<Record<string, number>>((acc, row) => {
			acc[row.origin_group] = (acc[row.origin_group] ?? 0) + 1;
			return acc;
		}, {}),
		kind: rows.reduce<Record<string, number>>((acc, row) => {
			acc[row.kind] = (acc[row.kind] ?? 0) + 1;
			return acc;
		}, {}),
	};
	return {
		state: stub.building ? ("building" as const) : ("ready" as const),
		revision: 3,
		total: rows.length,
		counts,
		tags: [
			tag("t1", "finance"),
			tag("t2", "q4", "project"),
			tag("t3", "launch", "project"),
			tag("t4", "notes"),
		],
		rows,
		next_cursor: null,
		cursor_reset: false,
		scan: { sessions_total: 142, sessions_scanned: stub.building ? 42 : 142 },
		librarian: {
			enabled: true,
			session_id: "librarian1234",
			paused: false,
			last_run_at: 1_759_000_000,
			last_summary: "Named 12 assets and tagged 9.",
			unorganized: 3,
		},
	};
};

const answer = (request: { op: string; [key: string]: unknown }) => {
	if (request.op === "capabilities") {
		return {
			status: 200,
			body: {
				result: {
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { library: 1, projects: 1 },
				},
			},
		};
	}
	switch (request.op) {
		case "library.list":
			if (stub.hang) return new Promise(() => {});
			if (stub.failList)
				return { status: 500, body: { detail: stub.failList } };
			return { status: 200, body: { result: listing() } };
		case "library.get": {
			const row =
				stub.detail ??
				stub.rows.find((item) => item.id === String(request.id)) ??
				null;
			if (!row) return { status: 404, body: { detail: "No such asset." } };
			const withChat =
				stub.linkedChat && row.kind === "markdown"
					? {
							...row,
							chat: {
								session_id: "abcdef123456",
								title: "March invoices",
								updated_at: 1_759_000_000,
							},
						}
					: row;
			return { status: 200, body: { result: withChat } };
		}
		case "library.librarian":
			return {
				status: 200,
				body: { result: listing().librarian },
			};
		case "library.tags":
			return { status: 200, body: { result: listing().tags } };
		case "library.update":
			return {
				status: 200,
				body: {
					result: {
						...(stub.rows.find((item) => item.id === request.id) ?? ROWS[2]),
						...((request.fields as object) ?? {}),
					},
				},
			};
		case "library.tags.assign":
			return {
				status: 200,
				body: {
					result: stub.rows.find((item) => item.id === request.id) ?? ROWS[2],
				},
			};
		case "sessions.message":
			return { status: 200, body: { result: { accepted: true } } };
		case "library.chat.link":
			return {
				status: 200,
				body: {
					result: {
						asset_id: request.id,
						chat: {
							session_id: request.sessionId,
							title: "Chat about this asset",
							updated_at: 1_759_000_000,
						},
						cleared: false,
					},
				},
			};
		default:
			throw new TypeError(`unexpected desktop op in this story: ${request.op}`);
	}
};

const install = () => {
	const page = window as unknown as {
		api?: Record<string, unknown> & {
			desktop?: Record<string, unknown>;
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		...api.desktop,
		request: answer,
		media: async (request: { op: string }) => {
			if (stub.media === "error") {
				return {
					status: 500,
					kind: "error",
					detail: "The daemon could not read this asset.",
				};
			}
			if (request.op === "library.thumbnail") {
				return {
					status: 404,
					kind: "error",
					detail: "No thumbnail for this asset.",
				};
			}
			if (stub.media === "pptx")
				return {
					status: 200,
					kind: "bytes",
					mimeType:
						"application/vnd.openxmlformats-officedocument.presentationml.presentation",
					data: await PptxBytes(),
				};
			return {
				status: 200,
				kind: "bytes",
				mimeType: "text/markdown",
				data: new TextEncoder().encode(
					"# March invoices\n\nReconcile the March run against the ledger.\n\n- Net 30\n- Two currencies\n- One disputed line\n",
				),
			};
		},
	};
	api.openFile = async () => {};
	api.showItemInFolder = async () => {};
};

const RouteTo: FC<{ path: string; children: ReactNode }> = ({
	path,
	children,
}) => {
	const navigate = useNavigate();
	useEffect(() => {
		navigate(path, { replace: true });
	}, [navigate, path]);
	return (
		<Routes>
			<Route path="/library" element={children} />
			<Route path="/library/assets/:assetId" element={children} />
		</Routes>
	);
};

const page = (
	state: Partial<StubState> & { route?: string; view?: "grid" | "list" },
) => {
	stub = {
		rows: ROWS,
		detail: null,
		hang: false,
		building: false,
		failList: null,
		media: "text",
		linkedChat: false,
		...state,
	};
	install();
	try {
		if (state.view) localStorage.setItem("library-view", state.view);
		else localStorage.removeItem("library-view");
		sessionStorage.removeItem("library-filters");
	} catch {
		/* storage is not what these stories are about */
	}
	const route = state.route ?? "/library";
	return (
		<div className="h-screen">
			<RouteTo path={route}>
				<LibraryPage nowMs={NOW} />
			</RouteTo>
		</div>
	);
};

const meta: Meta = {
	title: "Library/Tab",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

export const Empty: Story = { render: () => page({ rows: [] }) };
export const Loading: Story = { render: () => page({ hang: true }) };
export const Building: Story = {
	render: () => page({ rows: ROWS.slice(0, 2), building: true }),
};
export const LoadError: Story = {
	render: () => page({ rows: [], failList: "The backend did not answer." }),
};
export const Populated: Story = { render: () => page({}) };
export const ListView: Story = { render: () => page({ view: "list" }) };
export const Preview: Story = {
	render: () =>
		page({ route: "/library/assets/la_0000000000000023", view: "list" }),
};
export const PreviewLinkedChat: Story = {
	render: () =>
		page({
			route: "/library/assets/la_0000000000000023",
			linkedChat: true,
		}),
};
export const Pptx: Story = {
	render: () =>
		page({
			route: "/library/assets/la_0000000000000022",
			media: "pptx",
		}),
};
export const PptxError: Story = {
	render: () =>
		page({
			route: "/library/assets/la_0000000000000022",
			media: "error",
		}),
};

/* The overflow states are captured on the shell's own stories, where the real
 * sidebar composes inside ChatLayout (`Shell/App shell`). */
export const ResetOverflow: Story = {
	render: () => {
		const set = useUiPreferencesStore.getState().setSidebarOverflowExpanded;
		set(false);
		return page({});
	},
};
