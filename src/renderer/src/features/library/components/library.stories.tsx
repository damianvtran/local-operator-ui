/*
 * The Library tab: the catalogue states, the grid/list, the selected preview,
 * the composer and a real multi-slide PPTX.
 *
 * WHAT STANDS IN FOR THE BACKEND: `window.api.desktop.request`, `.media` and
 * `.stream` - the three bridges the shipped page uses. The page, the query
 * layer, the cards, the preview, the trajectory, the PPTX renderer and the
 * composer all run for real; a story that starts issuing an op the fixture does
 * not know fails loudly.
 *
 * THE PPTX FIXTURE IS A REAL FILE (`scripts/fixtures/library/sample.pptx`,
 * four slides, generated with python-pptx). The media stub serves its bytes,
 * so the viewer's parse and canvas render are exercised rather than mocked.
 */

import { ChatLayout } from "@shared/components/common/chat-layout";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { useAudioEngineStore } from "@shared/store/audio-engine-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "@storybook/test";
import type { FC, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { LibraryPreview, type LibraryPreviewFocus } from "./library-preview";
import { VIDEO_CONTROL_BAND_PX } from "./library-viewers";

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

/*
 * A LISTING DEEP ENOUGH THAT THE STRIP HAS TO SCROLL. Four siblings always fit
 * inside the strip lane, so they cannot show whether tile thumbnails are read
 * before a reader scrolls to them; forty do (agent review round 1, M3). Only the
 * first few tiles are inside the strip's clip, which is what the `MediaLightboxMany`
 * play uses to name a tile whose thumbnail must never have been requested.
 */
const MANY_ROWS: DesktopLibraryAsset[] = Array.from(
	{ length: 40 },
	(_, index) => {
		const id = `la_${String(9000 + index).padStart(16, "0")}`;
		return asset(id, {
			name: `Contact sheet ${index + 1}`,
			derived_name: `contact-${index + 1}.png`,
			kind: "image",
			category: "image",
			origin: "generated",
			origin_group: "generated",
			ref: {
				type: "artifact",
				path: null,
				display_path: `attachments/contact-${index + 1}.png`,
				digest: String(index).padStart(32, "0"),
				content_type: "image/png",
			},
			width: 1600,
			height: 1000,
			size_bytes: 1_200_000,
		});
	},
);

/**
 * WHAT THE LINKED CONVERSATION'S STREAM PAINTS, and why a story needs a stream
 * at all.
 *
 * The transcript holds hydration until the canonical stream's first `snapshot`
 * frame, so a desktop-REQUEST mock (`sessions.history`) leaves the well on the
 * shared spinner — the QA-round-1 finding. These frames go through the NATIVE
 * transport instead (`window.api.desktop.stream.subscribe`), which is the same
 * shape `library-page.cases.mjs` installs, and the hook's `JSON.parse` is
 * unvalidated, so one snapshot frame is the whole mock. A durable row's
 * `content` is a BLOCK LIST — a bare string paints nothing (`messageText`).
 */
type TrajectoryState = "populated" | "streaming" | "long" | "question";

const TRAJECTORY_SESSION = "abcdef123456";

const durableRow = (
	id: string,
	role: "user" | "assistant",
	text: string,
	ts: number,
) => ({
	id,
	ts,
	type: "message",
	payload: { role, content: [{ type: "text", text }] },
});

const TRAJECTORY_LINES: ReadonlyArray<["user" | "assistant", string]> = [
	["user", "Which invoices are still open for March?"],
	["assistant", "Three are unpaid: two net-30 and one disputed line."],
	["user", "Show me the disputed one."],
	["assistant", "INV-2291, 1,240.00 EUR, flagged twice by the same reviewer."],
];

const trajectoryEntries = (state: TrajectoryState) =>
	state === "long"
		? Array.from({ length: 36 }, (_, index) =>
				durableRow(
					`row-${index}`,
					index % 2 === 0 ? "user" : "assistant",
					index % 2 === 0
						? `Follow-up ${index / 2 + 1}: what changed on this line?`
						: `Line ${index}: the ledger moved by 120.00 and the note was re-dated.`,
					1_759_000_000 + index * 60,
				),
			)
		: TRAJECTORY_LINES.map(([role, text], index) =>
				durableRow(`row-${index}`, role, text, 1_759_000_000 + index * 60),
			);

const trajectoryFrames = (state: TrajectoryState) => [
	{
		session_id: TRAJECTORY_SESSION,
		epoch: "epoch-1",
		seq: 1,
		type: "snapshot",
		payload: {
			frontend: {
				state_version: 1,
				epoch: "epoch-1",
				sequence: 1,
				live_cursor: null,
				snapshot: {
					state_version: 1,
					session_id: TRAJECTORY_SESSION,
					epoch: "epoch-1",
					sequence: 1,
					cwd: "/tmp",
					conversation_title: "March invoices",
					conversation_title_user_set: false,
					conversation_title_forked: false,
					goal: "",
					active_agent: "",
					active_team: "",
					selected_model: null,
					effective_model: null,
					streaming: state === "streaming",
					generation: 1,
					...(state === "question"
						? {
								pending_gate: {
									request_id: "gate-1",
									kind: "ask",
									title: "Which ledger should I reconcile against?",
									detail: "",
									options: [{ label: "March" }, { label: "April" }],
									secret: false,
									question_index: 0,
									question_total: 1,
								},
							}
						: {}),
				},
			},
			history: {
				entries: trajectoryEntries(state),
				// A long page says there is more behind it, which is what the
				// older-history row is for.
				has_more: state === "long",
				cursor_missing: false,
			},
			cold: false,
		},
	},
];

type StubState = {
	rows: DesktopLibraryAsset[];
	detail: DesktopLibraryAsset | null;
	hang: boolean;
	building: boolean;
	failList: string | null;
	media: "text" | "pptx" | "error";
	/** `none` serves the 404 a path-backed audio asset answers for peaks. */
	waveform: "stored" | "none";
	linkedChat: boolean;
	/**
	 * What the linked conversation's stream paints, or null for a stream that
	 * never answers (the subscriber-only default).
	 */
	trajectory: TrajectoryState | null;
	/** Rows whose thumbnail is the pale artwork; see `palePictureSvg`. */
	brightThumbnails: string[];
};

let stub: StubState = {
	rows: ROWS,
	detail: null,
	hang: false,
	building: false,
	failList: null,
	media: "text",
	waveform: "stored",
	linkedChat: false,
	trajectory: null,
	brightThumbnails: [],
};

/*
 * Tags created through the preview's add affordance. The desktop stores new
 * names in the vocabulary before assigning their ids, so the stub does the
 * same for the life of one story; without it an add would issue an op the
 * script does not know and the story would fail rather than show the chip.
 */
let extraTags: { id: string; name: string; category: string }[] = [];
let longContent = false;

/*
 * HOW MANY CONTENT READS THE PREVIEW HAS ISSUED THIS STORY. `library.content` is
 * the byte fetch; opening the full-screen viewer must reuse the URL the preview
 * already resolved rather than reading the asset a second time, and the count is
 * what makes that claim checkable (the `MediaLightbox` play asserts it does not
 * move on open). Reset by `page()`, so a story never inherits another's count.
 */
let contentReads = 0;

/*
 * WHICH ASSETS THE STUB HAS SERVED A `library.thumbnail` READ FOR. The count of
 * content reads above answers "does opening the viewer re-read the pixels on
 * screen"; this list answers the sibling-strip question (agent review round 1,
 * M3): a viewer must not read a thumbnail for every media row in the listing,
 * only for the tiles the strip can actually show. Ids rather than a bare count,
 * so a story can name the tile that must not have been read.
 */
let thumbnailReads: string[] = [];

const PptxBytes = (() => {
	let promise: Promise<Uint8Array> | null = null;
	return () => {
		promise ??= fetch(samplePptxUrl).then(
			async (response) => new Uint8Array(await response.arrayBuffer()),
		);
		return promise;
	};
})();

/** The envelope every audio story draws: deterministic, 240 bars. */
const AUDIO_PEAKS = Array.from({ length: 240 }, (_, index) =>
	Math.min(1, 0.12 + Math.abs(Math.sin(index / 9)) * 0.82),
);

/**
 * A short valid WAV the shared player can resolve into a blob URL. A story
 * never plays it (the playing frames write the ENGINE's state directly, the
 * `sound-player.stories.tsx` convention), so this only has to be a real sound
 * of the right shape rather than a long one.
 */
const AudioBytes = (() => {
	let cached: Uint8Array | null = null;
	return () => {
		if (cached) return cached;
		const rate = 8000;
		const samples = rate / 4;
		const wav = new Uint8Array(44 + samples * 2);
		const view = new DataView(wav.buffer);
		const ascii = (offset: number, text: string) => {
			for (let index = 0; index < text.length; index += 1)
				view.setUint8(offset + index, text.charCodeAt(index));
		};
		ascii(0, "RIFF");
		view.setUint32(4, wav.length - 8, true);
		ascii(8, "WAVEfmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, rate, true);
		view.setUint32(28, rate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		ascii(36, "data");
		view.setUint32(40, samples * 2, true);
		for (let index = 0; index < samples; index += 1)
			view.setInt16(
				44 + index * 2,
				Math.round(6000 * Math.sin((2 * Math.PI * 220 * index) / rate)),
				true,
			);
		cached = wav;
		return wav;
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

/**
 * A BRIGHT thumbnail, for judging a mark that sits on top of the picture.
 *
 * The generated artwork above is deliberately saturated (a dark gradient with a
 * gold disc), and a heart's legibility cannot be judged against it: the QA
 * fixture a design round reaches for is often a pale screenshot, and the
 * operator's own files are invoices on white. This is a near-white ground with
 * faint grey content, drawn by the same stub so the frame needs no asset.
 */
const palePictureSvg = (label: string, width: number, height: number) => {
	const w = width;
	const h = height;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fbfbfc"/><rect x="${Math.round(w * 0.06)}" y="${Math.round(h * 0.16)}" width="${Math.round(w * 0.46)}" height="${Math.round(h * 0.035)}" fill="#e6e8ec"/><rect x="${Math.round(w * 0.06)}" y="${Math.round(h * 0.26)}" width="${Math.round(w * 0.72)}" height="${Math.round(h * 0.022)}" fill="#eceef1"/><rect x="${Math.round(w * 0.06)}" y="${Math.round(h * 0.33)}" width="${Math.round(w * 0.64)}" height="${Math.round(h * 0.022)}" fill="#eceef1"/><rect x="${Math.round(w * 0.06)}" y="${Math.round(h * 0.4)}" width="${Math.round(w * 0.55)}" height="${Math.round(h * 0.022)}" fill="#eceef1"/><circle cx="${Math.round(w * 0.82)}" cy="${Math.round(h * 0.24)}" r="${Math.round(h * 0.09)}" fill="#f1f2f4"/><text x="${Math.round(w * 0.06)}" y="${Math.round(h * 0.9)}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(h * 0.05)}" fill="#c9ccd2">${label}</text></svg>`;
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
		/*
		 * THE STREAM'S NATIVE TRANSPORT. `desktop-api` prefers it over the
		 * EventSource proxy, so a fake subscription that emits one JSON frame is
		 * all a story needs to paint a durable transcript. Frames are emitted on
		 * a task, not synchronously inside the subscriber's own effect.
		 */
		stream: {
			subscribe: (
				_args: { sessionId: string },
				onEvent: (event: {
					streamId: string;
					kind: "data" | "error" | "end";
					data?: string;
				}) => void,
			) => {
				const streamId = "library-story-stream";
				const frames = stub.trajectory
					? trajectoryFrames(stub.trajectory)
					: null;
				if (frames) {
					setTimeout(() => {
						for (const frame of frames) {
							onEvent({
								streamId,
								kind: "data",
								data: JSON.stringify(frame),
							});
						}
					}, 0);
				}
				return { streamId: Promise.resolve(streamId), dispose: () => {} };
			},
		},
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
			if (request.op === "library.waveform") {
				// The sidecar the producer writes beside generated audio. A
				// path-backed import has none, and the `none` story is that 404:
				// the player must draw its flat scrubber rather than a guessed
				// shape.
				if (stub.waveform === "none")
					return {
						status: 404,
						kind: "error",
						detail: "No peaks sidecar for this asset.",
					};
				return {
					status: 200,
					kind: "json",
					body: {
						version: 1,
						bars: AUDIO_PEAKS.length,
						peaks: AUDIO_PEAKS,
					},
				};
			}
			if (request.op === "library.thumbnail") {
				thumbnailReads.push(String(request.assetId ?? ""));
				if (row?.kind === "image" && row.exists) {
					if (stub.brightThumbnails.includes(row.id)) {
						return {
							status: 200,
							kind: "bytes",
							mimeType: "image/svg+xml",
							data: new TextEncoder().encode(
								palePictureSvg(assetDisplayName(row), 1600, 1000),
							),
						};
					}
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
			if (row?.kind === "audio")
				return {
					status: 200,
					kind: "bytes",
					mimeType: "audio/wav",
					data: AudioBytes(),
				};
			return {
				status: 200,
				kind: "bytes",
				mimeType: "text/markdown",
				data: new TextEncoder().encode(
					longContent
						? Array.from(
								{ length: 36 },
								(_, index) =>
									`## Entry ${index + 1}\n\nA deliberately long reconciliation note keeps the real viewer scrollable.`,
							).join("\n\n")
						: "# March invoices\n\nReconcile the March run against the ledger.\n\n- Net 30\n- Two currencies\n- One disputed line\n",
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
					/* The app's own `<main>` carries this; a story that draws the shell
					   must carry it too, or `panel-flush` cancels a pad that is absent. */
					className="panel-top-pad flex min-w-0 grow flex-col overflow-hidden"
				>
					<RouteTo path={route}>
						<LibraryPage nowMs={nowMs} />
					</RouteTo>
				</main>
			}
		/>
	</div>
);

const RouteTo: FC<{ path: string; fixed?: boolean; children: ReactNode }> = ({
	path,
	fixed = true,
	children,
}) => {
	const navigate = useNavigate();
	const routed = useRef(false);
	useEffect(() => {
		if (routed.current && !fixed) return;
		routed.current = true;
		navigate(path, { replace: true });
	}, [fixed, navigate, path]);
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
		compact?: boolean;
		docked?: boolean;
		workspaceWidth?: number;
		preserveDockWidth?: boolean;
		freeNavigation?: boolean;
		longContent?: boolean;
	},
) => {
	stub = {
		rows: ROWS,
		detail: null,
		hang: false,
		building: false,
		failList: null,
		media: "text",
		waveform: "stored",
		linkedChat: false,
		trajectory: null,
		brightThumbnails: [],
		...state,
	};
	extraTags = [];
	contentReads = 0;
	thumbnailReads = [];
	longContent = Boolean(state.longContent);
	install();
	try {
		if (state.view) localStorage.setItem("library-view", state.view);
		else localStorage.removeItem("library-view");
		if (!state.preserveDockWidth)
			localStorage.removeItem("library-details-width");
		sessionStorage.removeItem("library-filters");
	} catch {
		/* storage is not what these stories are about */
	}
	const route = state.route ?? "/library";
	return state.shell ? (
		<ShellLibrary nowMs={NOW} route={route} />
	) : (
		<div
			className={`${state.compact ? "h-[640px]" : "h-screen"} ${state.docked ? "flex" : ""}`}
			style={{ width: state.workspaceWidth }}
		>
			<RouteTo path={route} fixed={!state.freeNavigation}>
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

/*
 * THE FAVOURITE MARK AT REST, IN BOTH VIEWS (operator: a persisted heart, not a
 * star - the top-left badge already means `highlighted`). Two of the four rows
 * are favourited, so one frame shows the mark and its absence side by side; the
 * mark is not a control, so there is no gesture to play.
 */
const FAVORITE_ROWS: DesktopLibraryAsset[] = ROWS.slice(0, 4).map(
	(row, index) => ({ ...row, favorite: index < 2 }),
);
export const CardsFavourited: Story = {
	render: () => page({ rows: FAVORITE_ROWS }),
};
export const RowsFavourited: Story = {
	render: () => page({ rows: FAVORITE_ROWS, view: "list" }),
};

/*
 * THE SAME MARK ON A BRIGHT GROUND (design round 2, R1's evidence gap). The
 * operator's own screenshots are invoices on white, and the generic artwork is
 * dark enough that a mark's contrast against a pale image cannot be judged from
 * it. These four rows are near-white thumbnails — two favourited, two not — so
 * one frame answers "can I see the heart on a white document". The production
 * mark is untouched: the fixture changes the PICTURE, never the styling.
 */
const BRIGHT_ROWS: DesktopLibraryAsset[] = [0, 1, 2, 3].map((index) =>
	asset(`la_000000000000006${index + 1}`, {
		name: `Scanned invoice ${index + 1}`,
		derived_name: `invoice-0${index + 1}.png`,
		kind: "image",
		category: "image",
		origin: "mentioned",
		origin_group: "mentioned",
		favorite: index < 2,
		width: 1600,
		height: 1000,
		size_bytes: 240_000,
	}),
);
export const CardsFavouritedOnBright: Story = {
	render: () =>
		page({
			rows: BRIGHT_ROWS,
			brightThumbnails: BRIGHT_ROWS.map((row) => row.id),
		}),
};
export const RowsFavouritedOnBright: Story = {
	render: () =>
		page({
			rows: BRIGHT_ROWS,
			brightThumbnails: BRIGHT_ROWS.map((row) => row.id),
			view: "list",
		}),
};

/*
 * The real page and shell at the dock's default and keyboard-driven bounds.
 * The plays leave the actual persisted width in place, so these frames also
 * prove the separator's value and the drawer's painted width agree.
 */
export const DockedPreview: Story = {
	render: () =>
		page({
			docked: true,
			route: "/library/assets/la_0000000000000023",
		}),
	play: async () => {
		await waitFor(() => {
			expect(
				document
					.querySelector("[data-library-dock]")
					?.getAttribute("data-glass-region"),
			).toBe("pane");
			expect(document.querySelector("[data-library-preview]")).not.toBeNull();
			expect(document.querySelector("[data-library-composer]")).not.toBeNull();
		});
	},
};
export const DockedImage: Story = {
	render: () =>
		page({
			docked: true,
			route: "/library/assets/la_0000000000000021",
		}),
	play: async () => {
		await waitFor(() =>
			expect(
				document.querySelector('[data-library-media-trigger="image"]'),
			).not.toBeNull(),
		);
	},
};
export const DockedLongContent: Story = {
	render: () =>
		page({
			docked: true,
			longContent: true,
			route: "/library/assets/la_0000000000000023",
		}),
	play: async () => {
		await waitFor(() => {
			const scroller = document.querySelector<HTMLElement>(
				"[data-lo-pane-edge-cues]",
			);
			if (!scroller) throw new Error("the text scroller is not mounted");
			expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
			scroller.scrollTop = scroller.scrollHeight;
		});
		await waitFor(() => {
			const scroller = document.querySelector<HTMLElement>(
				"[data-lo-pane-edge-cues]",
			);
			expect(scroller?.scrollTop).toBeGreaterThan(0);
			expect(scroller ? scroller.scrollTop + scroller.clientHeight : 0).toBe(
				scroller?.scrollHeight,
			);
		});
	},
};
export const DockedPreviewNarrow: Story = {
	render: () =>
		page({
			docked: true,
			route: "/library/assets/la_0000000000000023",
		}),
	play: async () => {
		const separator = await waitFor(() => {
			const node = document.querySelector<HTMLElement>('[role="separator"]');
			if (!node) throw new Error("the dock separator is not mounted");
			return node;
		});
		separator.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
		);
		await waitFor(() =>
			expect(
				document.querySelector<HTMLElement>("[data-library-dock]")?.style.width,
			).toBe("320px"),
		);
	},
};
const playResizeEnd =
	(expected: string): Story["play"] =>
	async () => {
		const separator = await waitFor(() => {
			const node = document.querySelector<HTMLElement>('[role="separator"]');
			if (!node) throw new Error("the dock separator is not mounted");
			return node;
		});
		separator.dispatchEvent(
			new KeyboardEvent("keydown", { key: "End", bubbles: true }),
		);
		await waitFor(() =>
			expect(
				document.querySelector<HTMLElement>("[data-library-dock]")?.style.width,
			).toBe(expected),
		);
	};

export const DockedPreviewWide: Story = {
	render: () =>
		page({
			docked: true,
			route: "/library/assets/la_0000000000000023",
		}),
	play: playResizeEnd("720px"),
};
/* The smallest dock-eligible workspaces exercise the real toolbar at its
 * 320px results floor, rather than leaving a deceptively comfortable surplus. */
export const DockedPreviewConstrained1152: Story = {
	render: () =>
		page({
			docked: true,
			workspaceWidth: 1152,
			route: "/library/assets/la_0000000000000023",
		}),
	play: playResizeEnd("640px"),
};
export const DockedPreviewConstrained1200: Story = {
	render: () =>
		page({
			docked: true,
			workspaceWidth: 1200,
			route: "/library/assets/la_0000000000000023",
		}),
	play: playResizeEnd("688px"),
};
/* These two fixtures deliberately KEEP the stored width: cross-document
 * restoration and close/reopen need the real preference read, not a reset. */
export const DockedPreviewPersistent: Story = {
	render: () =>
		page({
			docked: true,
			preserveDockWidth: true,
			route: "/library/assets/la_0000000000000023",
		}),
	play: DockedPreview.play,
};
export const DockedReopen: Story = {
	render: () =>
		page({ docked: true, preserveDockWidth: true, freeNavigation: true }),
};
export const StandaloneNarrow: Story = {
	render: () =>
		page({
			docked: true,
			workspaceWidth: 1000,
			route: "/library/assets/la_0000000000000023",
		}),
	play: async () => {
		await waitFor(() => {
			expect(
				document
					.querySelector('[aria-label="Asset preview"]')
					?.getAttribute("data-glass-region"),
			).toBe("pane");
			expect(document.querySelector("[data-library-preview]")).not.toBeNull();
			expect(document.querySelector('[role="separator"]')).toBeNull();
		});
	},
};
export const DockedEmpty: Story = {
	render: () =>
		page({
			docked: true,
			route: "/library/assets/la_missing",
		}),
	play: async () => {
		await waitFor(() =>
			expect(
				document
					.querySelector("[data-library-dock]")
					?.getAttribute("data-glass-region"),
			).toBe("pane"),
		);
	},
};
export const DockedPreviewCompact: Story = {
	render: () =>
		page({
			compact: true,
			docked: true,
			route: "/library/assets/la_0000000000000023",
		}),
	play: DockedPreview.play,
};
export const TrajectoryCompact: Story = {
	render: () =>
		page({
			compact: true,
			docked: true,
			route: "/library/assets/la_0000000000000023",
			linkedChat: true,
			trajectory: "populated",
		}),
	play: async () => {
		const disclosure = await waitFor(() => {
			const node = [...document.querySelectorAll("button")].find((button) =>
				button.textContent?.includes("Chat about this asset"),
			);
			if (!node) throw new Error("the trajectory disclosure is not mounted");
			return node;
		});
		await userEvent.click(disclosure);
		await waitFor(() => {
			expect(document.querySelector("[data-library-composer]")).not.toBeNull();
			expect(document.body.textContent).toContain(
				"Which invoices are still open for March?",
			);
		});
	},
};

/*
 * THE CONVERSATION STATES THE QA ROUND ASKED FOR, painted from a real snapshot
 * frame through the stream's native transport (see `TrajectoryState`). Each is
 * the same dock with the same asset; only the stream's answer changes.
 */
export const TrajectoryPopulated: Story = {
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000023",
			linkedChat: true,
			trajectory: "populated",
		}),
	/*
	 * THE PLAY IS THE PROOF THE FRAME PAINTS ROWS, not that a spinner rendered:
	 * it waits for the snapshot's own sentence. A story whose stream mock
	 * regressed fails here instead of being captured as evidence.
	 */
	play: async () => {
		await waitFor(() =>
			expect(document.body.textContent).toContain(
				"Which invoices are still open for March?",
			),
		);
	},
};
export const TrajectoryStreaming: Story = {
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000023",
			linkedChat: true,
			trajectory: "streaming",
		}),
	play: async () => {
		await waitFor(() =>
			expect(document.body.textContent).toContain(
				"INV-2291, 1,240.00 EUR, flagged twice by the same reviewer.",
			),
		);
	},
};
export const TrajectoryLong: Story = {
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000023",
			linkedChat: true,
			trajectory: "long",
		}),
	play: async () => {
		await waitFor(() =>
			expect(document.body.textContent).toContain(
				"Line 17: the ledger moved by 120.00 and the note was re-dated.",
			),
		);
	},
};
export const TrajectoryQuestion: Story = {
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000023",
			linkedChat: true,
			trajectory: "question",
		}),
	play: async () => {
		await waitFor(() =>
			expect(
				document.querySelector("[data-library-trajectory-gate]"),
			).not.toBeNull(),
		);
	},
};
export const Preview: Story = {
	render: () =>
		page({ route: "/library/assets/la_0000000000000023", view: "list" }),
};
export const PreviewLinkedChat: Story = {
	render: () =>
		page({
			route: "/library/assets/la_0000000000000023",
			linkedChat: true,
			// A linked chat that paints nothing waits forever on the stream mock;
			// this one answers with the populated snapshot and its play waits for a
			// row (review round 2, F12).
			trajectory: "populated",
		}),
	play: async () => {
		await waitFor(() =>
			expect(document.body.textContent).toContain(
				"Which invoices are still open for March?",
			),
		);
	},
};

/*
 * SOUND CARDS AND THE SOUND DRAWER (operator report, 2026-10-23).
 *
 * The card used to paint a glyph and only played after the drawer opened. These
 * stories are the three states the fix is judged on - idle with a real
 * envelope, playing in place (the ENGINE's state written directly, the
 * `sound-player.stories.tsx` convention: a story never starts real playback),
 * and a 404 sidecar that must degrade to the flat scrubber rather than vanish -
 * plus the drawer, whose native control is gone in favour of the same player.
 */
const AUDIO_ROWS: DesktopLibraryAsset[] = [
	asset("la_0000000000000061", {
		name: "Storm swell",
		derived_name: "storm-swell.wav",
		kind: "audio",
		category: "sound",
		origin: "generated",
		origin_group: "generated",
		ref: {
			type: "artifact",
			path: null,
			display_path: "attachments/storm-swell.wav",
			digest: "11111111111111111111111111111111",
			content_type: "audio/wav",
		},
		duration_s: 12,
		size_bytes: 96_000,
	}),
	asset("la_0000000000000062", {
		name: "Door chime",
		derived_name: "door-chime.wav",
		kind: "audio",
		category: "sound",
		origin: "generated",
		origin_group: "generated",
		ref: {
			type: "artifact",
			path: null,
			display_path: "attachments/door-chime.wav",
			digest: "22222222222222222222222222222222",
			content_type: "audio/wav",
		},
		duration_s: 6,
		size_bytes: 48_000,
	}),
];

/** Drives the shared engine so the card's own player paints a playing frame. */
const CardEnginePlaying: FC<{ assetId: string }> = ({ assetId }) => {
	const ownerId = `sound:library:${assetId}`;
	useEffect(() => {
		useAudioEngineStore.setState({
			element: { currentTime: 4.2, duration: 12 } as HTMLAudioElement,
			ownerId,
			url: "story://silent",
			status: "playing",
			currentTime: 4.2,
			duration: 12,
			volume: 1,
			playbackRate: 1,
		});
		return () => {
			useAudioEngineStore.setState({
				element: null,
				ownerId: null,
				url: null,
				status: "idle",
				currentTime: 0,
				duration: 0,
			});
		};
	}, [ownerId]);
	return null;
};

/** Audio cards, idle: every well carries the shared player and its envelope. */
export const AudioCards: Story = { render: () => page({ rows: AUDIO_ROWS }) };

/** The same cards with one transport running, in place, without a drawer. */
export const AudioCardPlaying: Story = {
	name: "Audio card / playing",
	render: () => (
		<>
			<CardEnginePlaying assetId={AUDIO_ROWS[0].id} />
			{page({ rows: AUDIO_ROWS })}
		</>
	),
};

/** No sidecar: the player must still work, on its honest flat scrubber. */
export const AudioCardNoPeaks: Story = {
	name: "Audio card / no peaks",
	render: () => page({ rows: AUDIO_ROWS, waveform: "none" }),
};

/** The drawer: the shared full player, and no native `<audio controls>`. */
export const PreviewAudio: Story = {
	name: "Audio drawer",
	render: () =>
		page({ rows: AUDIO_ROWS, route: `/library/assets/${AUDIO_ROWS[0].id}` }),
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
		/*
		 * THE PREVIEW'S ASSET ID IS "THE PAGE DID NOT NAVIGATE" (QA round 1, Q2).
		 * `location.pathname` is `/iframe.html` in every Storybook state, so the
		 * old assertion could not fail; the preview's own `data-library-preview`
		 * carries what a reader would see move if the viewer pushed a route.
		 */
		const previewOf = () =>
			document
				.querySelector("[data-library-preview]")
				?.getAttribute("data-library-preview") ?? null;
		const trigger = await waitFor(() => {
			const node = document.querySelector<HTMLElement>(
				'[data-library-media-trigger="image"]',
			);
			if (!node) throw new Error("the preview's picture is not mounted");
			return node;
		});
		const previewBefore = previewOf();
		expect(previewBefore).toBe(MEDIA_ROWS[0].id);
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
		expect(previewOf()).toBe(previewBefore);
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
		expect(previewOf()).toBe(previewBefore);
		/*
		 * A strip tile SWITCHES THE SLIDE and does not navigate: a viewer for the
		 * pixels must not move the reader's selection underneath it.
		 */
		const third = document.querySelector<HTMLElement>(
			`[data-library-lightbox-tile="${MEDIA_ROWS[2].id}"]`,
		);
		if (!third) throw new Error("the strip is missing its third tile");
		await user.click(third);
		await waitFor(() => expect(currentTile()).toBe(MEDIA_ROWS[2].id));
		expect(previewOf()).toBe(previewBefore);
		/*
		 * Ends OPEN on purpose: the open overlay is the state the evidence rig
		 * photographs, and a play that closed it would leave every frame of this
		 * story showing the closed preview. The dismissal paths are
		 * `MediaLightboxDismiss`'s, so one story does not do both and neither
		 * depends on the other's timing.
		 */
	},
};

/*
 * A LISTING DEEPER THAN THE STRIP'S CLIP (agent review round 1, M3). Opening the
 * viewer mounts every sibling tile, and each used to issue a `library.thumbnail`
 * read at mount: a page is 60 media rows, so a 60-image listing read ~59
 * thumbnails for pixels nobody had scrolled to. The stub's `thumbnailReads` list
 * makes the claim checkable - the tiles the strip shows still read, and the far
 * end of a forty-row strip never does.
 */
export const MediaLightboxMany: Story = {
	render: () =>
		page({
			rows: MANY_ROWS,
			route: `/library/assets/${MANY_ROWS[0].id}`,
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
		const readsBefore = thumbnailReads.length;
		await user.click(trigger);
		await waitFor(() =>
			expect(document.querySelector("[data-library-lightbox]")).toBeTruthy(),
		);
		/*
		 * The near tiles still read, so the absence below cannot pass for the wrong
		 * reason (a viewer that read nothing at all).
		 */
		await waitFor(() =>
			expect(thumbnailReads.length).toBeGreaterThan(readsBefore),
		);
		const opened = thumbnailReads.slice(readsBefore);
		const farTile = MANY_ROWS[MANY_ROWS.length - 1].id;
		expect(opened).not.toContain(farTile);
		expect(new Set(opened).size).toBeLessThan(MANY_ROWS.length);
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
		const previewOf = () =>
			document
				.querySelector("[data-library-preview]")
				?.getAttribute("data-library-preview") ?? null;
		const trigger = await waitFor(() => {
			const node = document.querySelector<HTMLElement>(
				'[data-library-media-trigger="image"]',
			);
			if (!node) throw new Error("the preview's picture is not mounted");
			return node;
		});
		const previewBefore = previewOf();
		await user.click(trigger);
		await waitFor(() =>
			expect(document.querySelector("[data-library-lightbox]")).toBeTruthy(),
		);
		await user.keyboard("{Escape}");
		await waitFor(() =>
			expect(document.querySelector("[data-library-lightbox]")).toBeNull(),
		);
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		/*
		 * The page did not navigate and the preview is still the same asset: the
		 * shared marker rather than `location.pathname`, which is `/iframe.html` in
		 * every Storybook state and therefore cannot fail (QA round 1, Q2).
		 *
		 * THE ID IS NAMED BEFORE IT IS COMPARED (QA round 2, Q6): the comparison
		 * alone was satisfied by `null === null`, so it caught a marker that MOVED
		 * and not one that was removed. The absolute assertion is what makes the
		 * pair evidence that the marker exists at all.
		 */
		expect(previewBefore).toBe(MEDIA_ROWS[0].id);
		expect(previewOf()).toBe(previewBefore);
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
 * clip and stops above the native control panel — the measured band, not just
 * the scrubber row (QA round 2, Q5). WHAT THIS PLAY PROVES, precisely: the
 * target's rendered inset (`video.bottom - target.bottom`) is
 * `VIDEO_CONTROL_BAND_PX`, so the whole native control band lies outside it,
 * and points in that band resolve to the player rather than the target.
 *
 * WHAT IT CANNOT PROVE, so a green run is not read as more than it is:
 * Chromium retargets every hit inside the `<video>`'s UA shadow tree to the
 * video host and does not expose that shadow root, so `elementFromPoint` cannot
 * tell the play glyph from bare picture. The assertions pin the target's INSET,
 * not the glyph's position (agent review round 3, R3-4). The trusted-press half
 * — a press on the glyph actually starts the clip — was measured in QA round
 * 2's comment: an untrusted click is ignored by the UA's controls, so a play
 * function cannot carry it.
 *
 * The corner expand control stays as the keyboard affordance and opens the same
 * lightbox. `data-lightbox-video` is the shared lightbox's own hook on the video
 * element, so the open assertion covers a decoded clip rather than the fallback.
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
			/*
			 * THE TARGET PUBLISHES NO GEOMETRY UNTIL THE CLIP HAS A BOX (UX round 1,
			 * U1): a zero-height target is not a target, and pressing its centre hit
			 * the player instead. Waiting for a real height is what makes the centre
			 * assertion below a claim about the loaded surface rather than about the
			 * loading one.
			 */
			if (!node.getBoundingClientRect().height)
				throw new Error("the clip's click target has no height yet");
			return node;
		});
		const expand = document.querySelector<HTMLElement>(
			'[data-library-media-trigger="video"]',
		);
		if (!expand) throw new Error("the preview's expand control is not mounted");
		/*
		 * The target covers the picture and NOT the native control panel: the
		 * panel's own presses must reach the player, or play/pause and the scrubber
		 * are dead. The target's bottom edge is pinned to the measured band, so
		 * every row the band contains is outside it. The POINTS below are the
		 * glyph row and the scrubber row QA measured (round 2, Q5, where a
		 * `bottom - 10` target had swallowed the play button); they prove those
		 * rows are uncovered, not which native control sits under them - the
		 * browser retargets shadow content to the `<video>` host (see the note
		 * above).
		 */
		const box = video.getBoundingClientRect();
		const surfaceBox = surface.getBoundingClientRect();
		const centreX = box.left + box.width / 2;
		expect(document.elementFromPoint(centreX, box.top + box.height / 2)).toBe(
			surface,
		);
		expect(Math.round(box.bottom - surfaceBox.bottom)).toBe(
			VIDEO_CONTROL_BAND_PX,
		);
		/* The two rows QA measured: the glyph row and the scrubber row. Both
		 * resolve to the player, i.e. the target stops above them. */
		expect(document.elementFromPoint(box.left + 24, box.bottom - 48)).toBe(
			video,
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
	play: async () => {
		await waitFor(() => {
			const outer = document.querySelector("[data-library-dock]");
			const inner = document.querySelector("[data-library-preview]");
			expect(outer).not.toBeNull();
			expect(inner).not.toBeNull();
			if (!outer || !inner) return;
			expect(getComputedStyle(outer).backgroundColor).not.toBe(
				"rgba(0, 0, 0, 0)",
			);
			/* Bare-page stories miss the main-scoped net-pane selector. This is
			 * the shipped ChatLayout composition, so its computed clear is the
			 * regression pin for the old specificity defect. */
			expect(getComputedStyle(inner).backgroundColor).toBe("rgba(0, 0, 0, 0)");
		});
	},
};
export const InShellEmptyGlass: Story = {
	parameters: { glass: true },
	render: () => page({ shell: true, route: "/library/assets/la_missing" }),
	play: DockedEmpty.play,
};
export const InShellImageGlass: Story = {
	parameters: { glass: true },
	render: () =>
		page({ shell: true, route: "/library/assets/la_0000000000000021" }),
	play: DockedImage.play,
};
export const InShellLongContentGlass: Story = {
	parameters: { glass: true },
	render: () =>
		page({
			shell: true,
			longContent: true,
			route: "/library/assets/la_0000000000000023",
		}),
	play: DockedLongContent.play,
};

export const InShellFullView: Story = {
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000023?full=1",
		}),
};
export const InShellFullViewGlass: Story = {
	parameters: { glass: true },
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000023?full=1",
		}),
};
/*
 * THE EXPANDED VIEW'S WIDTH, WITHOUT A CONVERSATION. The spreadsheet is the
 * operator's own complaint ("the viewer does not use the available width"):
 * content-sized columns with a horizontal scroller, in the full-view route.
 * `InShellFullView` above is the same route for a markdown file, where the
 * editor takes the `fill` measure instead of Canvas's 640px reading column.
 *
 * THE CONVERSATION-BEARING STATES ARE NOT HERE, DELIBERATELY. Populated,
 * streaming, long-scrolled and pending-question frames need the canonical
 * stream's first `snapshot` frame (the transcript holds hydration until it
 * arrives), and this Storybook desktop mock answers REQUESTS only. A story built
 * from the spinner would look like evidence of a painted transcript while being
 * none, so those four states are reported as blocked rather than shipped.
 */
export const InShellFullViewSpreadsheet: Story = {
	render: () =>
		page({
			shell: true,
			route: "/library/assets/la_0000000000000025?full=1",
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
			trajectory: "populated",
		}),
	play: async () => {
		await waitFor(() =>
			expect(document.body.textContent).toContain(
				"Which invoices are still open for March?",
			),
		);
	},
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

const installPreviewStub = (row: DesktopLibraryAsset) => {
	stub = {
		rows: [row, ...ROWS.filter((item) => item.id !== row.id)],
		detail: row,
		hang: false,
		building: false,
		failList: null,
		waveform: "stored",
		media: "text",
		linkedChat: false,
		trajectory: null,
		brightThumbnails: [],
	};
	extraTags = [];
	install();
};

const previewPane = (row: DesktopLibraryAsset) => {
	installPreviewStub(row);
	return <PreviewFromQuery row={row} />;
};

/*
 * THE COMPACT PANE. A fixed 620px leaves the preview root under the 700px
 * threshold the component measures, which is the state a resized dock or a
 * short window reaches; the page route cannot be driven into it by a press
 * because `RouteTo` re-pins the route on every navigation (see the
 * switch-harness note below), so the pane is mounted directly.
 */
const CompactPreviewFromQuery: FC<{ row: DesktopLibraryAsset }> = ({ row }) => {
	const detail = useLibraryAsset(row.id, true);
	return (
		<div className="flex h-[620px] justify-end bg-canvas">
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

const compactPreviewPane = (row: DesktopLibraryAsset) => {
	installPreviewStub(row);
	return <CompactPreviewFromQuery row={row} />;
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

/**
 * A name wider than the header. The reserved gutter is the point: the value
 * ends in an ellipsis BEFORE the pencil's slot, so nothing is painted over the
 * text at rest, on hover, or while the editor is open.
 */
export const PreviewInlineLongName: Story = {
	render: () =>
		previewPane({
			...ROWS[2],
			name: "March invoice reconciliation notes for the fourth quarter close",
		}),
};

/**
 * The long name WITH THE EDITOR OPEN, where the first visible character must be
 * the value's first (QA round 1, Q1). Chromium scrolls a focused, fully selected
 * input to the caret at the END: the frame showed the tail of the name and no
 * ellipsis, because `<input>` resolves `text-overflow: clip`. The primitive
 * scrolls back to the start after selecting, and this play is the assertion that
 * it stays there; the capture rig photographs the same state off
 * `PreviewInlineLongName` and `press`.
 */
export const PreviewInlineLongNameEditing: Story = {
	render: () =>
		previewPane({
			...ROWS[2],
			name: "March invoice reconciliation notes for the fourth quarter close",
		}),
	play: async () => {
		const user = userEvent.setup();
		await user.click(await waitFor(() => inlineControl("name")));
		const input = await waitFor(() => {
			const found = inlineInput("name");
			if (!found) throw new Error("the long-name editor did not open");
			return found;
		});
		expect(input.value).toBe(
			"March invoice reconciliation notes for the fourth quarter close",
		);
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);
		expect(input.scrollLeft).toBe(0);
	},
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

/*
 * A COMPACT PREVIEW'S FIRST TAG COMMAND OPENS THE ROW IT REVEALS (agent review
 * round 3, R3-1). Below 700px of preview height the tag row is mounted only
 * while Details is open, so "reveal Details" and "open the add input" must land
 * in different commits: a single batched update mounts the row with the counter
 * already bumped, and the primitive reads a value present at mount as its
 * baseline, so nothing opens.
 *
 * THE PRESS IS THE REAL MENU ITEM. `LibraryAssetMenu` is the same component a
 * card mounts, and its `onEditTags` is the handler the page hands a card's
 * command to; the page's own route cannot deliver the press here because
 * `RouteTo` re-pins it (see the switch-harness note below), so the command is
 * issued at the preview that owns the handler.
 *
 * THE COMPACT BRANCH IS ASSERTED, NOT ASSUMED: without it a taller pane would
 * pass by never entering the state, and the input's FOCUS is the assertion
 * because a row mounted closed was exactly the regression (its presence alone
 * would read green on the defect).
 */
export const PreviewCompactFirstTagCommand: Story = {
	render: () => compactPreviewPane(ROWS[2]),
	play: async () => {
		const user = userEvent.setup();
		const preview = await waitFor(() => {
			const node = document.querySelector<HTMLElement>(
				"[data-library-preview]",
			);
			if (!node) throw new Error("the preview is not mounted");
			return node;
		});
		await waitFor(() =>
			expect(preview.hasAttribute("data-library-compact")).toBe(true),
		);
		expect(document.querySelector("[data-inline-tags]")).toBeNull();

		await user.click(
			await waitFor(() => {
				const trigger = document.querySelector<HTMLElement>(
					"[data-library-asset-menu]",
				);
				if (!trigger)
					throw new Error("the preview's asset menu is not mounted");
				return trigger;
			}),
		);
		const editTags = await waitFor(() => {
			const item = Array.from(
				document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
			).find((node) => node.textContent?.trim() === "Edit tags");
			if (!item) throw new Error("the menu's Edit tags item is not mounted");
			return item;
		});
		await user.click(editTags);

		const input = await waitFor(() => {
			const node = document.querySelector<HTMLInputElement>(
				"[data-inline-tags] input",
			);
			if (!node) throw new Error("the tag row did not open its add input");
			return node;
		});
		await waitFor(() => expect(document.activeElement).toBe(input));
	},
};

/*
 * ---------------------------------------------------------------------------
 * THE SWITCH HARNESS.
 * ---------------------------------------------------------------------------
 * THE PAGE'S ROUTE CANNOT DRIVE THIS STATE. Its `RouteTo` effect re-pins the
 * selected asset on every navigation, so pressing another listing row while an
 * editor is open blurs the editor and saves rather than switching the preview
 * (measured, QA round 1's M2 row and QA round 2's Q7). The preview owns the
 * behaviour under test — an asset prop changes underneath live editors — so this
 * harness hands the REAL `LibraryPreview` a state-controlled `asset` and a
 * switch that changes it programmatically, exactly the prop change a route
 * can deliver without a pointer crossing the editor.
 */
const PreviewSwitchHarness: FC<{
	rows: readonly [DesktopLibraryAsset, DesktopLibraryAsset];
}> = ({ rows }) => {
	const [selected, setSelected] = useState(0);
	const [focusRequest, setFocusRequest] = useState<{
		field: LibraryPreviewFocus;
		signal: number;
	} | null>(null);
	return (
		<div className="flex h-screen flex-col gap-2 bg-canvas p-2">
			<div className="flex shrink-0 gap-2">
				<button
					type="button"
					data-preview-harness-command="metadata"
					className="rounded-xs bg-control px-2 py-1 text-body-sm text-ink"
					onClick={() =>
						setFocusRequest((request) => ({
							field: "metadata",
							signal: (request?.signal ?? 0) + 1,
						}))
					}
				>
					Edit metadata
				</button>
				<button
					type="button"
					data-preview-harness-switch=""
					className="rounded-xs bg-control px-2 py-1 text-body-sm text-ink"
					onClick={() => setSelected((current) => (current + 1) % rows.length)}
				>
					Select the next asset
				</button>
				{/*
				 * The card menu's `onEditMetadata` does BOTH in one commit: it navigates to
				 * that card and bumps the page's focus request. This button models that
				 * pair, which is the reset's hardest case — a reset that ran in an effect
				 * after the commit would swallow the command the switch carried.
				 */}
				<button
					type="button"
					data-preview-harness-command-next="metadata"
					className="rounded-xs bg-control px-2 py-1 text-body-sm text-ink"
					onClick={() => {
						setSelected((current) => (current + 1) % rows.length);
						setFocusRequest((request) => ({
							field: "metadata",
							signal: (request?.signal ?? 0) + 1,
						}));
					}}
				>
					Edit metadata on the next asset
				</button>
			</div>
			<div className="flex min-h-0 flex-1 justify-end">
				<div className="flex h-full w-[440px] min-w-0 flex-col">
					<LibraryPreview
						asset={rows[selected]}
						nowMs={NOW}
						onClose={() => undefined}
						onOpenConversation={() => undefined}
						onFilterSession={() => undefined}
						onAsk={() => undefined}
						onToggleFavorite={() => undefined}
						composerFocusSignal={0}
						focusRequest={focusRequest}
					/>
				</div>
			</div>
		</div>
	);
};

const switchRows = () => [ROWS[2], ROWS[3]] as const;

const previewSwitchPane = () => {
	stub = {
		rows: [
			...switchRows(),
			...ROWS.filter((row) => row.id !== ROWS[2].id && row.id !== ROWS[3].id),
		],
		detail: ROWS[2],
		hang: false,
		waveform: "stored",
		building: false,
		failList: null,
		media: "text",
		linkedChat: false,
		trajectory: null,
		brightThumbnails: [],
	};
	extraTags = [];
	install();
	return <PreviewSwitchHarness rows={switchRows()} />;
};

/**
 * AN EDIT COMMAND BELONGS TO THE ASSET IT WAS ISSUED ON.
 *
 * Two regressions meet here, and this play is the executable pin for both:
 * the per-asset editor keys (`${asset.id}:name`), which stop a typed draft
 * crossing a switch, and the start-signal reset, which stops a command's
 * counter from re-opening the editor on the next asset (agent review round 2,
 * M2 — reproduced by hand there, not driveable through the page route: QA
 * round 2, Q7).
 */
export const PreviewInlineSwitchAfterCommand: Story = {
	render: () => previewSwitchPane(),
	play: async () => {
		const user = userEvent.setup();
		const [first, second] = switchRows();
		const previewId = () =>
			document
				.querySelector("[data-library-preview]")
				?.getAttribute("data-library-preview") ?? null;
		const command = () => {
			const node = document.querySelector<HTMLButtonElement>(
				'[data-preview-harness-command="metadata"]',
			);
			if (!node) throw new Error("the harness command is not mounted");
			return node;
		};
		const switchTo = () => {
			const node = document.querySelector<HTMLButtonElement>(
				"[data-preview-harness-switch]",
			);
			if (!node) throw new Error("the harness switch is not mounted");
			return node;
		};
		const namesBefore = stub.rows.map((row) => `${row.id}:${row.name}`);

		/* A: the command still opens the editor, and a draft is typed into it. */
		await user.click(await waitFor(() => command()));
		await waitFor(() => expect(inlineInput("name")).toBeTruthy());
		const draft = await waitFor(() => {
			const input = inlineInput("name");
			if (!input) throw new Error("the name editor did not open");
			return input as HTMLInputElement;
		});
		/* Cleared first: typing appends at the caret, so the draft has to start
		 * from empty to be a value the switch could carry. */
		await user.clear(draft);
		await user.type(draft, "DRAFT FROM ASSET A");
		expect(inlineInput("name")?.value).toBe("DRAFT FROM ASSET A");

		/*
		 * THE SWITCH IS PROGRAMMATIC ON PURPOSE: a pointer press on the button
		 * would blur the editor first and blur SAVES (the documented gesture), so
		 * the draft would land on A before the prop ever changed. This models the
		 * route change the keys exist for.
		 */
		switchTo().click();
		await waitFor(() => expect(previewId()).toBe(second.id));
		expect(inlineInput("name")).toBeNull();
		expect(
			document.querySelector('[data-inline-edit="name"]')?.textContent,
		).toContain(assetDisplayName(second));
		/* The unmount wrote nothing: the draft stayed on the unmounted editor. */
		expect(stub.rows.map((row) => `${row.id}:${row.name}`)).toEqual(
			namesBefore,
		);

		/* B's own pencil still opens it, with B's value. */
		await user.click(await waitFor(() => inlineControl("name")));
		await waitFor(() => expect(inlineInput("name")).toBeTruthy());
		expect(inlineInput("name")?.value).toBe(assetDisplayName(second));
		await user.keyboard("{Escape}");
		await waitFor(() => expect(inlineInput("name")).toBeNull());

		/* And a fresh command aimed at B opens B, not A. */
		await user.click(command());
		await waitFor(() => expect(inlineInput("name")).toBeTruthy());
		expect(inlineInput("name")?.value).toBe(assetDisplayName(second));
		await user.keyboard("{Escape}");
		await waitFor(() => expect(inlineInput("name")).toBeNull());

		/* The reverse direction: B's command must not follow the switch to A. */
		switchTo().click();
		await waitFor(() => expect(previewId()).toBe(first.id));
		expect(inlineInput("name")).toBeNull();
		await user.click(await waitFor(() => inlineControl("name")));
		await waitFor(() => expect(inlineInput("name")).toBeTruthy());
		expect(inlineInput("name")?.value).toBe(assetDisplayName(first));
	},
};

/**
 * THE CARD MENU'S COMMAND SURVIVES THE SWITCH IT ARRIVES WITH. `onEditMetadata`
 * on a card navigates to that card and bumps the page's command in one commit;
 * this play pins that the editor opens for the asset the command named, which a
 * counter reset placed in an effect (rather than during the render) would
 * swallow.
 */
export const PreviewInlineCommandForAnotherAsset: Story = {
	render: () => previewSwitchPane(),
	play: async () => {
		const user = userEvent.setup();
		const [, second] = switchRows();
		const command = await waitFor(() => {
			const node = document.querySelector<HTMLButtonElement>(
				'[data-preview-harness-command-next="metadata"]',
			);
			if (!node) throw new Error("the harness's paired command is not mounted");
			return node;
		});
		await user.click(command);
		await waitFor(() =>
			expect(
				document
					.querySelector("[data-library-preview]")
					?.getAttribute("data-library-preview"),
			).toBe(second.id),
		);
		await waitFor(() => expect(inlineInput("name")).toBeTruthy());
		expect(inlineInput("name")?.value).toBe(assetDisplayName(second));
	},
};
