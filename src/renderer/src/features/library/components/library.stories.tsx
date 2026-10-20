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

import { ChatLayout } from "@shared/components/common/chat-layout";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "@storybook/test";
import type { FC, ReactNode } from "react";
import { useEffect, useLayoutEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { glassPaintFor } from "../../../../../shared/window-glass";
import "../../../styles/index.css";
import "../../chat/components/story-electron-shim";
import sampleMp4Url from "../../../../../../scripts/fixtures/library/sample.mp4?url";
import samplePptxUrl from "../../../../../../scripts/fixtures/library/sample.pptx?url";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import { useLibraryAsset } from "../hooks/use-library-queries";
import {
	NO_LIBRARY_FILTERS,
	assetDisplayName,
	filterAssets,
} from "../library-model";
import { LibraryPage } from "./library-page";
import { LibraryPreview } from "./library-preview";

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const THEME_IDS = ["localOperatorDark", "localOperatorLight"];

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
		highlighted: true,
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
		highlighted: true,
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

/**
 * The media set the full-screen viewer's carousel walks: three pictures and a
 * clip, in display order. Why this shape: the operator's item 7 asks for a
 * viewer over the asset, with the left/right arrows and the strip live when the
 * asset HAS siblings — a set of one would exercise the lightbox's no-chrome
 * branch only, and a set of pictures only would never render a video slide.
 */
const MEDIA_ROWS: DesktopLibraryAsset[] = [
	asset("la_0000000000000051", {
		name: "Launch still one",
		derived_name: "launch-01.png",
		kind: "image",
		category: "image",
		origin: "generated",
		origin_group: "generated",
		ref: {
			type: "artifact",
			path: null,
			display_path: "attachments/launch-01.png",
			digest: "11111111111111111111111111111111",
			content_type: "image/png",
		},
		width: 1600,
		height: 1000,
		size_bytes: 2_400_000,
	}),
	asset("la_0000000000000052", {
		name: "Launch still two",
		derived_name: "launch-02.png",
		kind: "image",
		category: "image",
		origin: "generated",
		origin_group: "generated",
		ref: {
			type: "artifact",
			path: null,
			display_path: "attachments/launch-02.png",
			digest: "22222222222222222222222222222222",
			content_type: "image/png",
		},
		width: 1000,
		height: 1400,
		size_bytes: 3_100_000,
	}),
	asset("la_0000000000000053", {
		name: "Launch still three",
		derived_name: "launch-03.png",
		kind: "image",
		category: "image",
		origin: "generated",
		origin_group: "generated",
		ref: {
			type: "artifact",
			path: null,
			display_path: "attachments/launch-03.png",
			digest: "33333333333333333333333333333333",
			content_type: "image/png",
		},
		width: 1600,
		height: 900,
		size_bytes: 1_900_000,
	}),
	asset("la_0000000000000054", {
		name: "Launch teaser",
		derived_name: "launch-teaser.mp4",
		kind: "video",
		category: "video",
		origin: "generated",
		origin_group: "generated",
		ref: {
			type: "artifact",
			path: null,
			display_path: "attachments/launch-teaser.mp4",
			digest: "44444444444444444444444444444444",
			content_type: "video/mp4",
		},
		width: 320,
		height: 180,
		duration_s: 2,
		size_bytes: 2_309,
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

/*
 * Tags created through the preview's add affordance. The desktop stores new
 * names in the vocabulary before assigning their ids, so the stub does the
 * same for the life of one story; without it an add would issue an op the
 * script does not know and the story would fail rather than show the chip.
 */
let extraTags: { id: string; name: string; category: string }[] = [];

/*
 * HOW MANY CONTENT READS THE PREVIEW HAS ISSUED THIS STORY. `library.content` is
 * the byte fetch; opening the full-screen viewer must reuse the URL the preview
 * already resolved rather than reading the asset a second time, and the count is
 * what makes that claim checkable (the `MediaLightbox` play asserts it does not
 * move on open). Reset by `page()`, so a story never inherits another's count.
 */
let contentReads = 0;

const PptxBytes = (() => {
	let promise: Promise<Uint8Array> | null = null;
	return () => {
		promise ??= fetch(samplePptxUrl).then(
			async (response) => new Uint8Array(await response.arrayBuffer()),
		);
		return promise;
	};
})();

/*
 * The clip the media story's `<video>` decodes: a real two-second 320x180 mp4
 * (`scripts/fixtures/library/sample.mp4`, generated with ffmpeg), for the same
 * reason the PPTX story serves a real deck. A stand-in that does not decode
 * would reach the lightbox's own `onError` and the video check would assert
 * the fallback rather than the clip.
 */
const Mp4Bytes = (() => {
	let promise: Promise<Uint8Array> | null = null;
	return () => {
		promise ??= fetch(sampleMp4Url).then(
			async (response) => new Uint8Array(await response.arrayBuffer()),
		);
		return promise;
	};
})();

/**
 * One picture's bytes, keyed by the asset so the strip's tiles are distinct.
 *
 * A gradient plus the asset's name is enough to tell the slides apart in a
 * capture, which is what the media stories are for; nothing here is a decoding
 * stand-in — the lightbox mounts a real `<img>` over these bytes.
 *
 * WIDTH AND HEIGHT ARE ON THE `<svg>` ROOT, not implied by the `viewBox`. With
 * a viewBox alone the document has a ratio but no intrinsic size, and an `<img>`
 * inside the lightbox's shrink-wrapped (`h-fit w-fit`) frame then measures 0x0 —
 * the overlay opened over an empty layer. A real asset (a PNG, an MP4) always
 * carries its dimensions; the fixture must too, or the story photographs a
 * failure the fixture caused.
 */
const pictureSvg = (
	label: string,
	seed: number,
	width: number,
	height: number,
) => {
	const hue = (seed * 47) % 360;
	const circle = Math.round(height * 0.22);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 42% 36%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 52% 15%)"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><circle cx="${Math.round(width * 0.74)}" cy="${Math.round(height * 0.3)}" r="${circle}" fill="#e8c56a" opacity=".8"/><path d="M0 ${Math.round(height * 0.76)} L${Math.round(width * 0.29)} ${Math.round(height * 0.42)} L${Math.round(width * 0.55)} ${Math.round(height * 0.8)} L${Math.round(width * 0.78)} ${Math.round(height * 0.56)} L${width} ${Math.round(height * 0.82)} V${height} H0Z" fill="#0a1f24" opacity=".75"/><text x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.14)}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(height * 0.052)}" fill="#ffffff" opacity=".9">${label}</text></svg>`;
};

const listing = (request: { scope?: string } = {}) => {
	/*
	 * The route's default is `all`; the desktop sends `final`. The story stub
	 * runs the same predicate the route does so the default view a reader sees
	 * here is the one the app paints.
	 */
	const rows = filterAssets(stub.rows, {
		...NO_LIBRARY_FILTERS,
		scope: request.scope === "final" ? "final" : "all",
	});
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
		].map((item) => ({
			...item,
			count: rows.filter((row) =>
				row.tags.some((assigned) => assigned.id === item.id),
			).length,
		})),
		rows,
		next_cursor: null,
		cursor_reset: false,
		scan: { sessions_total: 142, sessions_scanned: stub.building ? 42 : 142 },
		librarian: {
			enabled: true,
			session_id: "librarian1234",
			paused: false,
			last_run_at: Math.floor(NOW / 1000) - 7200,
			last_summary: "Named 12 assets and tagged 9.",
			unorganized: 3,
			library: { total: stub.rows.length, unorganized: 3 },
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
					features: {
						library: 1,
						projects: 1,
						aida: 1,
						profile_catalogue: 1,
						team_catalogue: 1,
						settings: 1,
						agents_config: 1,
						session_interrupt: 1,
					},
				},
			},
		};
	}
	switch (request.op) {
		case "library.list":
			if (stub.hang) return new Promise(() => {});
			if (stub.failList)
				return { status: 500, body: { detail: stub.failList } };
			return {
				status: 200,
				body: {
					result: listing(request as { scope?: string }),
				},
			};
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
			return {
				status: 200,
				body: {
					result: [
						...listing().tags,
						...extraTags.map((item) => ({ ...item, count: 0 })),
					],
				},
			};
		case "library.tags.create": {
			const name = String(request.name ?? "")
				.trim()
				.toLowerCase();
			const existing = [...listing().tags, ...extraTags].find(
				(item) => item.name === name,
			);
			if (existing) return { status: 200, body: { result: existing } };
			const created = {
				...tag(`t-${extraTags.length + 10}`, name),
				count: 0,
			};
			extraTags = [
				...extraTags,
				{ id: created.id, name: created.name, category: created.category },
			];
			return { status: 200, body: { result: created } };
		}
		case "library.update": {
			const row = stub.rows.find((item) => item.id === request.id) ?? ROWS[2];
			const updated = { ...row, ...((request.fields as object) ?? {}) };
			stub.rows = stub.rows.map((item) =>
				item.id === updated.id ? updated : item,
			);
			if (stub.detail?.id === updated.id) stub.detail = updated;
			return { status: 200, body: { result: updated } };
		}
		case "library.tags.assign": {
			const row = stub.rows.find((item) => item.id === request.id) ?? ROWS[2];
			const ids = Array.isArray(request.tags) ? request.tags : [];
			const vocabulary = [...listing().tags, ...extraTags];
			const tags = ids.flatMap((id) => {
				const found = vocabulary.find((item) => item.id === id);
				return found
					? [{ id: found.id, name: found.name, category: found.category }]
					: [];
			});
			const updated = { ...row, tags };
			stub.rows = stub.rows.map((item) =>
				item.id === updated.id ? updated : item,
			);
			if (stub.detail?.id === updated.id) stub.detail = updated;
			return { status: 200, body: { result: updated } };
		}
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
		media: async (request: { op: string; [key: string]: unknown }) => {
			if (stub.media === "error") {
				return {
					status: 500,
					kind: "error",
					detail: "The daemon could not read this asset.",
				};
			}
			/*
			 * CONTENT AND THUMBNAILS FOLLOW THE ROW'S KIND, because the media
			 * stories need bytes a real `<img>` and a real `<video>` can decode. The
			 * pictures are generated SVGs keyed by asset id, so slides and strip tiles
			 * are visibly distinct; the clip is the committed mp4 fixture. A row with
			 * no thumbnail route (a clip, a document) gets the honest 404 the card
			 * falls back to its kind glyph for.
			 */
			const row =
				stub.rows.find((item) => item.id === String(request.assetId ?? "")) ??
				null;
			if (request.op === "library.thumbnail") {
				if (row?.kind === "image" && row.exists) {
					const svg = pictureSvg(
						assetDisplayName(row),
						Number.parseInt(row.id.slice(-2), 10),
						row.width ?? 1600,
						row.height ?? 1000,
					);
					return {
						status: 200,
						kind: "bytes",
						mimeType: "image/svg+xml",
						data: new TextEncoder().encode(svg),
					};
				}
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
			contentReads += 1;
			if (row?.kind === "image") {
				const svg = pictureSvg(
					assetDisplayName(row),
					Number.parseInt(row.id.slice(-2), 10),
					row.width ?? 1600,
					row.height ?? 1000,
				);
				return {
					status: 200,
					kind: "bytes",
					mimeType: "image/svg+xml",
					data: new TextEncoder().encode(svg),
				};
			}
			if (row?.kind === "video")
				return {
					status: 200,
					kind: "bytes",
					mimeType: "video/mp4",
					data: await Mp4Bytes(),
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

/**
 * GLASS IS A DOCUMENT-LEVEL STATE, not a prop the page reads. The frame paints
 * the same `data-glass` kinds and `--lo-glass-*` alphas `use-window-glass.ts`
 * writes in the app, so a story can be captured with the real transparency
 * rules (and a sibling story without it) without a native window.
 */
const GlassFrame: FC<{
	scheme: "dark" | "light";
	coverage: "sidebars" | "full";
	children: ReactNode;
}> = ({ scheme, coverage, children }) => {
	useLayoutEffect(() => {
		const paint = glassPaintFor({
			coverage,
			intensity: 50,
			mechanism: "vibrancy",
			material: "window",
			scheme,
		});
		const root = document.documentElement;
		root.dataset.glass = paint.kinds;
		for (const [name, value] of Object.entries(paint.vars)) {
			root.style.setProperty(name, value);
		}
		return () => {
			delete root.dataset.glass;
			for (const name of Object.keys(paint.vars)) {
				root.style.removeProperty(name);
			}
		};
	}, [scheme, coverage]);
	return <>{children}</>;
};

/** The real rail beside the page, in the composition `app.tsx` draws. */
const ShellLibrary: FC<{ nowMs: number; route?: string }> = ({
	nowMs,
	route = "/library",
}) => (
	<div className="relative flex h-screen flex-col overflow-hidden">
		<ChatLayout
			sidebar={<SidebarNavigation />}
			content={
				<main
					data-glass-region="canvas-backing"
					className="flex min-w-0 grow flex-col overflow-hidden"
				>
					<RouteTo path={route}>
						<LibraryPage nowMs={nowMs} />
					</RouteTo>
				</main>
			}
		/>
	</div>
);

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
	state: Partial<StubState> & {
		route?: string;
		view?: "grid" | "list";
		shell?: boolean;
	},
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
	extraTags = [];
	contentReads = 0;
	install();
	try {
		if (state.view) localStorage.setItem("library-view", state.view);
		else localStorage.removeItem("library-view");
		sessionStorage.removeItem("library-filters");
	} catch {
		/* storage is not what these stories are about */
	}
	const route = state.route ?? "/library";
	return state.shell ? (
		<ShellLibrary nowMs={NOW} route={route} />
	) : (
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
	argTypes: {
		theme: { control: { type: "select" }, options: THEME_IDS },
	},
	args: { theme: "localOperatorDark" },
	decorators: [
		(Story, context) =>
			context.parameters.glass ? (
				<GlassFrame
					scheme={
						context.args.theme === "localOperatorLight" ? "light" : "dark"
					}
					coverage={
						context.parameters.glass === "sidebars" ? "sidebars" : "full"
					}
				>
					<Story />
				</GlassFrame>
			) : (
				<Story />
			),
	],
};
export default meta;
type Story = StoryObj;

export const Empty: Story = { render: () => page({ rows: [] }) };
export const Loading: Story = { render: () => page({ hang: true }) };
export const Building: Story = {
	render: () => page({ rows: ROWS.slice(0, 2), building: true }),
};
/*
 * The building line inside the real shell, which is the state the header's
 * fixed-height defect painted over the grid. Kept as a story rather than a
 * one-off rig so the geometry can be re-measured from the shipped component.
 */
export const InShellBuilding: Story = {
	render: () => page({ shell: true, building: true }),
};
/* The same state under both glass coverages; design round 2 measures the
 * header and results grounds against the titlebar lane from these. */
export const InShellBuildingGlass: Story = {
	parameters: { glass: true },
	render: () => page({ shell: true, building: true }),
};
export const InShellBuildingGlassSidebars: Story = {
	parameters: { glass: "sidebars" },
	render: () => page({ shell: true, building: true }),
};
export const LoadError: Story = {
	render: () => page({ rows: [], failList: "The backend did not answer." }),
};
export const Populated: Story = { render: () => page({}) };
/*
 * The two scopes side by side in the fixture: generated and highlighted rows
 * survive `final`, mentioned and plainly-created scratch rows appear only in
 * `all`. Toggling the rail's Scope section switches between the two.
 */
export const Scope: Story = {
	render: () =>
		page({
			rows: [
				asset("la_0000000000000031", {
					name: "Generated report",
					origin: "generated",
					origin_group: "generated",
				}),
				asset("la_0000000000000032", {
					name: "Kept note",
					highlighted: true,
				}),
				asset("la_0000000000000033", {
					name: "Mentioned file",
					origin: "mentioned",
					origin_group: "mentioned",
				}),
				asset("la_0000000000000034", {
					name: "Created scratch",
					origin: "written",
					origin_group: "created",
				}),
			],
		}),
};
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

/*
 * THE DETAILS VIEW'S MEDIA LIGHTBOX (operator item 7). The fixture is three
 * pictures and a clip, so the arrows, the wrap and the strip are all live. The
 * play is the operator's own gesture: click the picture, walk one slide with
 * the keyboard, close with Escape — and asserts focus comes back to the control
 * that opened it, because a modal that dumps focus on `<body>` is the failure
 * the lightbox's `restoreFocusTo` exists to prevent.
 */
export const MediaLightbox: Story = {
	render: () =>
		page({
			rows: MEDIA_ROWS,
			route: `/library/assets/${MEDIA_ROWS[0].id}`,
			view: "list",
		}),
	play: async () => {
		const user = userEvent.setup();
		const trigger = await waitFor(() => {
			const node = document.querySelector<HTMLElement>(
				'[data-library-media-trigger="image"]',
			);
			if (!node) throw new Error("the preview's picture is not mounted");
			return node;
		});
		const readsBefore = contentReads;
		await user.click(trigger);
		await waitFor(() =>
			expect(document.querySelector("[data-library-lightbox]")).toBeTruthy(),
		);
		/*
		 * Opening reuses the preview's own object URL: no second `library.content`
		 * read for the picture already on screen.
		 */
		expect(contentReads).toBe(readsBefore);
		/*
		 * The set is the listing's four media rows, in display order, including the
		 * asset on screen — and the strip marks the slide the reader is on.
		 */
		expect(
			document.querySelectorAll("[data-library-lightbox-tile]").length,
		).toBe(MEDIA_ROWS.length);
		const currentTile = () =>
			document
				.querySelector('[data-library-lightbox-strip] [aria-current="true"]')
				?.getAttribute("data-library-lightbox-tile") ?? null;
		expect(currentTile()).toBe(MEDIA_ROWS[0].id);
		await user.keyboard("{ArrowRight}");
		await waitFor(() => expect(currentTile()).toBe(MEDIA_ROWS[1].id));
		/*
		 * A strip tile SWITCHES THE SLIDE and does not navigate: the page's route is
		 * the asset the preview selected, and a viewer for the pixels must not move
		 * the reader out of it.
		 */
		const pathBefore = location.pathname;
		const third = document.querySelector<HTMLElement>(
			`[data-library-lightbox-tile="${MEDIA_ROWS[2].id}"]`,
		);
		if (!third) throw new Error("the strip is missing its third tile");
		await user.click(third);
		await waitFor(() => expect(currentTile()).toBe(MEDIA_ROWS[2].id));
		expect(location.pathname).toBe(pathBefore);
		/*
		 * Ends OPEN on purpose: the open overlay is the state the evidence rig
		 * photographs, and a play that closed it would leave every frame of this
		 * story showing the closed preview. The dismissal paths are
		 * `MediaLightboxDismiss`'s, so one story does not do both and neither
		 * depends on the other's timing.
		 */
	},
};

/**
 * Every exit the lightbox owns, and the focus return that goes with them.
 *
 * Escape is Radix's; the assertion that matters is where focus lands after the
 * close, because a composition without a `DialogTrigger` dumps it on `<body>`
 * unless the caller passes `restoreFocusTo` — the defect the shared lightbox's
 * prop exists to prevent.
 */
export const MediaLightboxDismiss: Story = {
	render: () =>
		page({
			rows: MEDIA_ROWS,
			route: `/library/assets/${MEDIA_ROWS[0].id}`,
			view: "list",
		}),
	play: async () => {
		const user = userEvent.setup();
		const trigger = await waitFor(() => {
			const node = document.querySelector<HTMLElement>(
				'[data-library-media-trigger="image"]',
			);
			if (!node) throw new Error("the preview's picture is not mounted");
			return node;
		});
		await user.click(trigger);
		await waitFor(() =>
			expect(document.querySelector("[data-library-lightbox]")).toBeTruthy(),
		);
		await user.keyboard("{Escape}");
		await waitFor(() =>
			expect(document.querySelector("[data-library-lightbox]")).toBeNull(),
		);
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		/* The page did not navigate: the preview is still the same asset route. */
		expect(document.querySelector('[data-library-media-trigger="image"]')).toBe(
			trigger,
		);
	},
};

/**
 * A single picture has no siblings, so the lightbox must render WITHOUT
 * carousel chrome: no strip, no arrows. That is `ImageLightbox`'s own
 * `count > 1` rule, and this story is what keeps the Library's wiring from
 * manufacturing a group of one.
 */
export const MediaLightboxSolo: Story = {
	render: () =>
		page({
			rows: MEDIA_ROWS.slice(0, 1),
			route: `/library/assets/${MEDIA_ROWS[0].id}`,
			view: "list",
		}),
	play: async () => {
		const user = userEvent.setup();
		const trigger = await waitFor(() => {
			const node = document.querySelector<HTMLElement>(
				'[data-library-media-trigger="image"]',
			);
			if (!node) throw new Error("the preview's picture is not mounted");
			return node;
		});
		await user.click(trigger);
		await waitFor(() =>
			expect(document.querySelector("[data-library-lightbox]")).toBeTruthy(),
		);
		expect(document.querySelector("[data-library-lightbox-strip]")).toBeNull();
		expect(document.querySelector("[data-image-viewer-prev]")).toBeNull();
		expect(document.querySelector("[data-image-viewer-next]")).toBeNull();
	},
};

/*
 * The clip's path, both ways in. The picture area is a click target sized to the
 * clip and stops above the native control band; the band's presses belong to the
 * player (`elementFromPoint` is the assertion: the target over the picture, the
 * `<video>` over the band). The corner expand control stays as the keyboard
 * affordance and opens the same lightbox. `data-lightbox-video` is the shared
 * lightbox's own hook on the video element, so the assertion covers a decoded
 * clip rather than the fallback.
 */
export const MediaLightboxVideo: Story = {
	render: () =>
		page({
			rows: MEDIA_ROWS,
			route: `/library/assets/${MEDIA_ROWS[3].id}`,
			view: "list",
		}),
	play: async () => {
		const user = userEvent.setup();
		const video = await waitFor(() => {
			const node = document.querySelector<HTMLVideoElement>("video");
			if (!node) throw new Error("the preview's player is not mounted");
			return node;
		});
		const surface = await waitFor(() => {
			const node = document.querySelector<HTMLElement>(
				'[data-library-media-trigger="video-surface"]',
			);
			if (!node) throw new Error("the clip's click target is not mounted");
			return node;
		});
		const expand = document.querySelector<HTMLElement>(
			'[data-library-media-trigger="video"]',
		);
		if (!expand) throw new Error("the preview's expand control is not mounted");
		/*
		 * The target covers the picture and NOT the control band: the band's own
		 * presses must reach the player, or play/pause and the scrubber are dead.
		 */
		const box = video.getBoundingClientRect();
		const surfaceBox = surface.getBoundingClientRect();
		const centreX = box.left + box.width / 2;
		expect(document.elementFromPoint(centreX, box.top + box.height / 2)).toBe(
			surface,
		);
		expect(document.elementFromPoint(centreX, box.bottom - 10)).toBe(video);
		expect(surfaceBox.height).toBeLessThan(box.height);
		await user.click(surface);
		await waitFor(() =>
			expect(
				document.querySelector("[data-library-lightbox] [data-lightbox-video]"),
			).toBeTruthy(),
		);
		await user.keyboard("{Escape}");
		await waitFor(() =>
			expect(document.querySelector("[data-library-lightbox]")).toBeNull(),
		);
		/* The expand control is the second door, and the keyboard one. */
		await user.click(expand);
		await waitFor(() =>
			expect(
				document.querySelector("[data-library-lightbox] [data-lightbox-video]"),
			).toBeTruthy(),
		);
	},
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

/** The page with the app's real sidebar: the width budget the spec assumes. */
export const InShell: Story = {
	render: () => page({ shell: true }),
};
export const InShellGlass: Story = {
	parameters: { glass: true },
	render: () => page({ shell: true }),
	/*
	 * THE GLOBAL GLASS FRAME MUST NOT CLEAR THIS STORY'S OWN PAINT. The preview's
	 * `GlassFrame` decorator is outermost and its off path used to call
	 * `applyGlassFacts(null)` after this meta decorator had painted, which made
	 * every Library glass story render flat with no assertion to catch it. The
	 * preview frame now yields when `parameters.glass` is set; this play is the
	 * pin that keeps the yield honest.
	 */
	play: async () => {
		for (let attempt = 0; attempt < 40; attempt += 1) {
			if (document.documentElement.dataset.glass?.includes("canvas")) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(
			"the Library glass harness was cleared by the global frame",
		);
	},
};
export const InShellLightGlass: Story = {
	args: { theme: "localOperatorLight" },
	parameters: { glass: true },
	render: () => page({ shell: true }),
};
export const InShellPreview: Story = {
	render: () =>
		page({ shell: true, route: "/library/assets/la_0000000000000023" }),
};
export const InShellPreviewGlass: Story = {
	parameters: { glass: true },
	render: () =>
		page({ shell: true, route: "/library/assets/la_0000000000000023" }),
};

export const InShellFullView: Story = {
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000023?full=1",
		}),
};
export const InShellPptx: Story = {
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000022",
			media: "pptx",
		}),
};
export const InShellPptxGlass: Story = {
	parameters: { glass: true },
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000022",
			media: "pptx",
		}),
};

export const InShellGlassSidebars: Story = {
	parameters: { glass: "sidebars" },
	render: () => page({ shell: true }),
};
export const InShellPreviewGlassSidebars: Story = {
	parameters: { glass: "sidebars" },
	render: () =>
		page({ shell: true, route: "/library/assets/la_0000000000000023" }),
};
export const InShellNoGlass: Story = {
	render: () => page({ shell: true }),
};

export const InShellPreviewLinkedChat: Story = {
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000023",
			linkedChat: true,
		}),
};

/*
 * ---------------------------------------------------------------------------
 * THE PREVIEW'S INLINE EDITING, standalone.
 * ---------------------------------------------------------------------------
 * The panel is mounted directly rather than reached through the catalogue
 * route, so a frame is only the metadata surface: the name row, the
 * description and the tag row. The stub is the same one the page stories use,
 * so every read the preview makes (`library.tags`, `library.update`) is the
 * real bridge call with a scripted answer.
 *
 * THE DATA HOOKS ARE THE DRIVE SURFACE. `data-inline-edit="name"` /
 * `"description"` each contain `[data-inline-edit-control]` (the pencil/X) and,
 * while open, `[data-inline-edit-input]`; `[data-inline-tags]` holds the chip
 * row and its add affordance. The capture rig's `press`, `hover`, `type` and
 * `keys` options address those selectors, so a frame is a state a real pointer
 * or keyboard produced rather than a prop that paints one.
 */
const PreviewFromQuery: FC<{ row: DesktopLibraryAsset }> = ({ row }) => {
	/*
	 * The panel reads the same detail query the page hands it. It matters for a
	 * story that WRITES: a save lands in the query cache, the hook re-renders
	 * with the server's row, and the frame shows what the app would. Rendering
	 * the fixture directly would paint the old value straight back over every
	 * successful save and read as a failure.
	 */
	const detail = useLibraryAsset(row.id, true);
	return (
		<div className="flex h-screen justify-end bg-canvas">
			<div className="flex h-full w-[440px] min-w-0 flex-col">
				<LibraryPreview
					asset={detail.data ?? row}
					nowMs={NOW}
					onClose={() => undefined}
					onOpenConversation={() => undefined}
					onFilterSession={() => undefined}
					onAsk={() => undefined}
					onToggleFavorite={() => undefined}
					composerFocusSignal={0}
					focusRequest={null}
				/>
			</div>
		</div>
	);
};

const previewPane = (row: DesktopLibraryAsset) => {
	stub = {
		rows: [row, ...ROWS.filter((item) => item.id !== row.id)],
		detail: row,
		hang: false,
		building: false,
		failList: null,
		media: "text",
		linkedChat: false,
	};
	extraTags = [];
	install();
	return <PreviewFromQuery row={row} />;
};

const inlineControl = (field: string) => {
	const node = document.querySelector<HTMLButtonElement>(
		`[data-inline-edit="${field}"] [data-inline-edit-control]`,
	);
	if (!node) throw new Error(`the ${field} pencil is not mounted`);
	return node;
};

const inlineInput = (field: string) =>
	document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
		`[data-inline-edit="${field}"] [data-inline-edit-input]`,
	);

/** The resting read state: header name row, description text, tag pills. */
export const PreviewInlinePopulated: Story = {
	render: () => previewPane(ROWS[2]),
};

/**
 * The hover state, produced by a real pointer. No play function can set
 * `:hover` (synthetic pointer events do not move the browser's hover chain),
 * so the rig drives this one with its `hover` option on
 * `[data-inline-edit="name"]` and asserts the pseudo-class before the shutter.
 */
export const PreviewInlineNameHover: Story = {
	render: () => previewPane(ROWS[2]),
};

/** After a real press on the name's pencil: borderless editor, text selected. */
export const PreviewInlineNameEditing: Story = {
	render: () => previewPane(ROWS[2]),
	play: async () => {
		const user = userEvent.setup();
		await user.click(await waitFor(() => inlineControl("name")));
		await waitFor(() => expect(inlineInput("name")).toBeTruthy());
	},
};

/** After typing and Escape: the editor closed, the stored name back in place. */
export const PreviewInlineNameEscape: Story = {
	render: () => previewPane(ROWS[2]),
	play: async () => {
		const user = userEvent.setup();
		await user.click(await waitFor(() => inlineControl("name")));
		const input = await waitFor(() => {
			const found = inlineInput("name");
			if (!found) throw new Error("the name editor did not open");
			return found;
		});
		await user.type(input, "changed");
		await user.keyboard("{Escape}");
		await waitFor(() => expect(inlineInput("name")).toBeNull());
		await waitFor(() =>
			expect(
				document.querySelector('[data-inline-edit="name"]')?.textContent,
			).toContain("March invoices"),
		);
	},
};

/** Description editing: the same gesture, multiline, no box. */
export const PreviewInlineDescriptionEditing: Story = {
	render: () => previewPane(ROWS[2]),
	play: async () => {
		const user = userEvent.setup();
		await user.click(await waitFor(() => inlineControl("description")));
		await waitFor(() => expect(inlineInput("description")).toBeTruthy());
	},
};

/** The tag row with nothing in it: the add affordance is the empty state. */
export const PreviewInlineEmptyTags: Story = {
	render: () =>
		previewPane(
			asset("la_0000000000000041", {
				name: "Untagged note",
				description: "",
				tags: [],
			}),
		),
	play: async () => {
		const row = await waitFor(() => {
			const found = document.querySelector("[data-inline-tags]");
			if (!found) throw new Error("the tag row is not mounted");
			return found;
		});
		expect(row.textContent).toContain("Add a tag");
	},
};
