import { ChatHeader as GeometryChatHeader } from "../../chat/components/chat-header";
import { ChatDeviceSlot as GeometryDeviceSlot } from "../../chat/device/chat-device-slot";
/**
 * The agent profile picture, in every state the surfaces and the editor show.
 *
 * WHAT IS REAL AND WHAT IS MOCKED. These stories render the shipped components -
 * `AgentMark`, `AgentAvatarEditLink`, `AgentAvatarField`, `AgentAvatarCropper`,
 * `ChatSessionAvatar` - and mock only the two things a story cannot have: the
 * backend's picture bytes (the preload media relay answers `agent.avatar` with a
 * synthetic PNG, no user data) and the agent records themselves. The picture's
 * record is seeded straight into the query key the seam reads, which is the same
 * path a real agents read fills, so what is exercised is the seam and the
 * rendering rather than a fixture-shaped prop.
 *
 * THE PENCIL'S HOVER IS THE RIG'S JOB. A story cannot hold a pointer over an
 * element, so `EditLinkOwned` shows the link at rest and the captured frames in
 * the PR hover it; `EditLinkUnowned` is the same picture with no link at all,
 * which is the state that must never grow a pencil.
 */

import {
	agentAvatarPath,
	agentAvatarsQueryKey,
	useAgentAvatarMap,
} from "@shared/agent-avatar/agent-avatar";
import { AgentAvatarEditLink } from "@shared/agent-avatar/agent-avatar-edit-link";
import { AgentMark } from "@shared/agent-avatar/agent-mark";
import type { AgentAvatarMeta } from "@shared/api/local-operator/types";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { queryClient } from "@shared/api/query-client";
import { TooltipProvider } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { peek as peekBlobUrl } from "@shared/lib/blob-url-cache";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import {
	type FC,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ChatSessionAvatar,
	ChatSessionAvatarEdit,
} from "../../chat/components/chat-session-avatar";
import { AgentAvatarCropper } from "./agent-avatar-cropper";
import { AgentAvatarField } from "./agent-avatar-field";
import { makeProfile } from "./agent-class.stories";
import { AgentDetail } from "./agent-detail";
import { AgentsSidebarItem } from "./agents-sidebar";

/* ------------------------------------------------------------------ *
 * THE SYNTHETIC PICTURE
 * ------------------------------------------------------------------ */

/**
 * A 512x512 gradient with a disc in it, encoded once as a PNG.
 *
 * Drawn rather than shipped as a base64 blob so the story carries no binary
 * asset and the image is obviously synthetic in the frames.
 */
const syntheticPng = (): Uint8Array => {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 512;
	const context = canvas.getContext("2d");
	if (context) {
		const gradient = context.createLinearGradient(0, 0, 512, 512);
		gradient.addColorStop(0, "#3b82f6");
		gradient.addColorStop(1, "#8b5cf6");
		context.fillStyle = gradient;
		context.fillRect(0, 0, 512, 512);
		context.fillStyle = "#e5e7eb";
		context.beginPath();
		context.arc(256, 220, 110, 0, Math.PI * 2);
		context.fill();
		context.beginPath();
		context.arc(256, 470, 170, Math.PI, 0);
		context.fill();
	}
	const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
	return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

const PNG = syntheticPng();
const SHA = "a".repeat(64);

/** The one media stub these stories need: the bytes behind an agent's picture. */
const installMedia = () => {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: async (request: { op?: string }) =>
			request.op === "agent.avatar"
				? { status: 200, kind: "bytes", mimeType: "image/png", data: PNG }
				: { status: 404, kind: "error", detail: "Not in this story." },
	};
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};
installMedia();

/** Seed the agents' picture records the way a real agents read would. */
const useSeedPictures = (ids: readonly string[]) => {
	useEffect(() => {
		const map: Record<string, AgentAvatarMeta> = {};
		for (const id of ids)
			map[id] = {
				sha256: SHA,
				mime: "image/png",
				bytes: PNG.byteLength,
				updated_at: "2026-10-30T00:00:00.000Z",
			};
		queryClient.setQueryData(agentAvatarsQueryKey, map);
	}, [ids]);
	// Read the map so the story repaints when the query is filled.
	useAgentAvatarMap();
};

const agent = (
	id: string,
	name: string,
	description: string,
): AgentDetails => ({
	id,
	name,
	description,
	created_date: "2026-10-30T00:00:00.000Z",
	version: "1",
	security_prompt: "",
	hosting: "openrouter",
	model: "openai/gpt-4o-mini",
});

const CODER = agent(
	"agent-coder",
	"coder",
	"Implements one bounded slice and reports what changed.",
);
const REVIEWER = agent(
	"agent-reviewer",
	"reviewer",
	"Reviews every pull request before it merges.",
);
const MANAGER = agent(
	"agent-manager",
	"manager",
	"Coordinates the team and keeps the record current.",
);
const LONG_NAME = agent(
	"agent-long",
	"research-and-reconciliation-analyst",
	"Reads the whole corpus before answering one question about it.",
);

const noop = () => {};

const ROWS = [CODER.id, MANAGER.id, LONG_NAME.id] as const;

/* ------------------------------------------------------------------ *
 * THE ROSTER ROWS
 * ------------------------------------------------------------------ */

const Rows: FC<{
	rows: ReadonlyArray<{ record: AgentDetails; selected: boolean }>;
	pictured: readonly string[];
}> = ({ rows, pictured }) => {
	useSeedPictures(pictured);
	return (
		<TooltipProvider>
			<div className="w-80 bg-surface p-2">
				<ul className="flex flex-col gap-1">
					{rows.map(({ record, selected }) => (
						<AgentsSidebarItem
							key={record.id}
							agent={record}
							isSelected={selected}
							onSelectAgent={noop}
							onChatWithAgent={noop}
							onExportAgent={noop}
							onAgentDeleted={noop}
							onUploadAgentToHub={noop}
						/>
					))}
				</ul>
			</div>
		</TooltipProvider>
	);
};

const meta: Meta<typeof Rows> = {
	title: "Features/Agents/Agent avatar",
	component: Rows,
};
export default meta;

type Story = StoryObj<typeof Rows>;

/** Every row state the picture meets, side by side at the same row height. */
export const RosterStates: Story = {
	render: () => (
		<Rows
			pictured={ROWS}
			rows={[
				{ record: CODER, selected: false },
				/* No picture: the row must be exactly the row it was before. */
				{ record: REVIEWER, selected: false },
				{ record: MANAGER, selected: true },
				{ record: LONG_NAME, selected: false },
			]}
		/>
	),
};

/** The same roster with no pictures at all - the pre-feature baseline. */
export const RosterNoPictures: Story = {
	render: () => (
		<Rows
			pictured={[]}
			rows={[
				{ record: CODER, selected: false },
				{ record: REVIEWER, selected: true },
			]}
		/>
	),
};

/* ------------------------------------------------------------------ *
 * THE EDITOR
 * ------------------------------------------------------------------ */

const pictureSource = (): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("the synthetic picture failed"));
		image.src = URL.createObjectURL(
			new Blob([PNG as BlobPart], { type: "image/png" }),
		);
	});

/** The cropper needs a decoded source; a story decodes its own picture. */
const usePictureSource = () => {
	const [source, setSource] = useState<HTMLImageElement | null>(null);
	useEffect(() => {
		let live = true;
		void pictureSource().then((image) => {
			if (live) setSource(image);
		});
		return () => {
			live = false;
		};
	}, []);
	return source;
};

const Cropper: FC<{ zoom?: number }> = ({ zoom = 1 }) => {
	const source = usePictureSource();
	if (!source) return <p className="text-ink-dim text-meta">Decoding…</p>;
	return (
		<div className="w-[46rem] bg-surface p-6">
			<AgentAvatarCropper
				source={source}
				initialZoom={zoom}
				onSave={noop}
				onCancel={noop}
			/>
		</div>
	);
};

/** The crop step as it opens: 1x, centred, previews at the real sizes. */
export const EditorCropFresh: Story = {
	render: () => <Cropper />,
};

/** The same crop panned and zoomed - what the saved square will keep. */
export const EditorCropZoomed: Story = {
	render: () => <Cropper zoom={2.5} />,
};

/** The crop step mid-upload: Save is busy and locked for the whole request. */
export const EditorCropSaving: Story = {
	render: () => {
		const source = usePictureSource();
		if (!source) return <p className="text-ink-dim text-meta">Decoding…</p>;
		return (
			<div className="w-[46rem] bg-surface p-6">
				<AgentAvatarCropper
					source={source}
					saving={true}
					onSave={noop}
					onCancel={noop}
				/>
			</div>
		);
	},
};

/** The crop step after a refused upload: the framing is kept, the reason shown. */
export const EditorCropSaveFailed: Story = {
	render: () => {
		const source = usePictureSource();
		if (!source) return <p className="text-ink-dim text-meta">Decoding…</p>;
		return (
			<div className="w-[46rem] bg-surface p-6">
				<AgentAvatarCropper
					source={source}
					error="The picture could not be saved. Try again."
					onSave={noop}
					onCancel={noop}
				/>
			</div>
		);
	},
};

/**
 * The field with a picture: the picture itself, Replace and Remove beside it.
 *
 * THE STORY WAS THE BROKEN PART, NOT THE FIELD (design review round 1, D2). It
 * mounted `AgentAvatarField` for an agent that HAS a picture but never called
 * `useSeedPictures`, so `useAgentAvatar` - which reads the agents map - answered
 * `null` and the field drew its EMPTY arm: the frame was pixel-identical to
 * `EditorEmpty`, and the "uploaded" state the brief asks for had no evidence at
 * all. The component was right; opening this agent in the app renders the
 * picture, because the map carries its digest and the media stub below answers
 * the bytes. Seeding the map is therefore what makes the state real - and this
 * story now exercises the shipped fetch rather than the `pictureSrc` story seam.
 */
const FieldWithPicture: FC = () => {
	useSeedPictures([CODER.id]);
	return (
		<div className="w-96 bg-surface p-6">
			<AgentAvatarField agentId={CODER.id} />
		</div>
	);
};

export const EditorWithPicture: Story = {
	render: () => <FieldWithPicture />,
};

/** The field before anything is picked - the state a new agent is in. */
export const EditorEmpty: Story = {
	render: () => (
		<div className="w-96 bg-surface p-6">
			<AgentAvatarField agentId="agent-no-picture" />
		</div>
	),
};

/* ------------------------------------------------------------------ *
 * THE PENCIL
 * ------------------------------------------------------------------ */

const Pencil: FC<{ owned: boolean }> = ({ owned }) => {
	useSeedPictures([CODER.id]);
	return (
		<div className="flex items-center gap-4 bg-surface p-6">
			<AgentAvatarEditLink
				agentName={CODER.name}
				agentId={CODER.id}
				owned={owned}
				className="size-10"
				pencilClassName="size-4"
			>
				{/*
				 * `AgentMark` is unseeded here on purpose: the story needs the picture
				 * WITHOUT the seam's async fetch, so a fixed URL is passed.
				 */}
				<AgentMark
					agentId={CODER.id}
					src={URL.createObjectURL(
						new Blob([PNG as BlobPart], { type: "image/png" }),
					)}
					className="size-10"
					fallback={null}
				/>
			</AgentAvatarEditLink>
			<span className="text-body text-ink-dim">
				{owned ? "Owned: the picture is a link" : "Not owned: no link"}
			</span>
		</div>
	);
};

/** An agent the viewer owns: hovering or focusing the picture reveals the pencil. */
export const EditLinkOwned: Story = {
	render: () => <Pencil owned={true} />,
};

/** Someone else's agent: no link, no pencil, no tab stop. */
export const EditLinkUnowned: Story = {
	render: () => <Pencil owned={false} />,
};

/* ------------------------------------------------------------------ *
 * THE CHAT ROWS
 * ------------------------------------------------------------------ */

const row = (
	id: string,
	statusCode: string,
	label: string,
	pictured: boolean,
): CanonicalSessionRow =>
	({
		session_id: id,
		title: `${label} conversation`,
		updated_at: 0,
		agent_id: pictured ? CODER.id : null,
		avatar_sha256: pictured ? SHA : null,
		binding: { agent: CODER.name, team: null },
		status: { code: statusCode, label },
	}) as CanonicalSessionRow;

const ChatRows: FC = () => {
	useSeedPictures([CODER.id]);
	const rows = useMemo(
		() => [
			row("s-busy-a", "busy", "Running", true),
			row("s-waiting-a", "waiting", "Waiting for you", true),
			row("s-done-a", "complete", "Done", true),
			row("s-error-a", "error", "Failed", true),
			row("s-busy-b", "busy", "Running", false),
			row("s-waiting-b", "waiting", "Waiting for you", false),
			row("s-done-b", "complete", "Done", false),
			row("s-error-b", "error", "Failed", false),
		],
		[],
	);
	return (
		<div className="w-72 bg-surface p-2">
			<div className="flex flex-col gap-1">
				{rows.map((entry) => (
					<div
						key={entry.session_id}
						className="flex h-8 items-center gap-1 rounded-md px-1 text-body-sm"
					>
						<ChatSessionAvatar row={entry} nowSeconds={0} />
						<span className="min-w-0 truncate text-ink">
							{entry.binding?.agent ?? "agent"} · {entry.status?.label ?? ""}
						</span>
					</div>
				))}
			</div>
		</div>
	);
};

/**
 * The four states the row must keep legible, with a picture and without: the
 * picture beside the untouched status cell (see `AVATAR_STATUS_VARIANT`).
 */
export const ChatRowStatuses: Story = {
	render: () => <ChatRows />,
};

/**
 * THE ROW AND ITS PENCIL, in the real wrapper the sidebar uses.
 *
 * WHY THIS EXISTS (design review round 1, D3). `ChatRowStatuses` builds a
 * stand-in row from the marks alone and mounts no `ChatSessionAvatarEdit`, so
 * nothing on this branch framed the editor's door at hover or at keyboard focus -
 * the state the whole feature adds, unphotographed. This mounts the shipped
 * components inside the sidebar's own wrapper class string (`group/row relative`,
 * which is what the overlay's hover reveal keys off), and the capture plans for
 * it take the resting, hover and focus frames.
 */
const RowPencil: FC = () => {
	useSeedPictures([CODER.id]);
	const entry = useMemo(() => row("s-pencil", "complete", "Done", true), []);
	return (
		<div className="w-72 bg-surface p-2">
			<div
				data-avatar-row-pencil=""
				className="group/row relative flex h-8 items-center gap-1 rounded-md px-1 text-body-sm"
			>
				<ChatSessionAvatar row={entry} nowSeconds={0} />
				<span className="min-w-0 truncate text-ink">{CODER.name} · Done</span>
				<ChatSessionAvatarEdit row={entry} />
			</div>
		</div>
	);
};

export const ChatRowPencil: Story = {
	render: () => <RowPencil />,
};

/** Geometry matrix: shipped header/controls, synthetic agent and loopback-free reads. */
const HeaderGeometryFixture: FC = () => {
	const rootRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = rootRef.current;
		if (!element) return;
		let cancelled = false;
		void assertHeaderGeometry(element)
			.then((spread) => {
				if (!cancelled)
					element.setAttribute("data-centre-spread", String(spread));
			})
			.catch((error) => {
				if (!cancelled)
					element.setAttribute("data-geometry-error", String(error));
			});
		return () => {
			cancelled = true;
		};
	}, []);
	const params = new URLSearchParams(window.location.search);
	const width = Number(params.get("band") || 1000);
	const scale = Number(params.get("scale") || 1);
	const missing = params.get("missing") === "1";
	const wrap = params.get("wrap") === "1";
	useSeedPictures([CODER.id]);
	useLayoutEffect(() => {
		document.documentElement.style.fontSize = `${16 * scale}px`;
		const api = window as unknown as {
			api: {
				desktop: { request: (request: { op: string }) => Promise<unknown> };
			};
		};
		api.api.desktop.request = async ({ op }) => {
			const result =
				op === "capabilities"
					? {
							desktop_available: true,
							features: { peers: 1, session_transfer: 1 },
						}
					: op === "peers.list"
						? { self_device_id: "d_fixture", peers: [] }
						: op === "networks.list"
							? { self_device_id: "d_fixture", networks: [] }
							: op === "teams.list"
								? { teams: [] }
								: op === "commands.entities"
									? { command: "", entities: [], current: null }
									: { sessions: [] };
			return { status: 200, body: { result } };
		};
		return () => {
			document.documentElement.style.fontSize = "";
		};
	}, [scale]);
	return (
		<div
			data-geometry-fixture=""
			data-expected-elements={missing ? 4 : 5}
			ref={rootRef}
			style={{ width, marginTop: 40 }}
			className="bg-surface"
		>
			{wrap ? (
				<style>
					{
						"[data-geometry-fixture] [data-header-title] { white-space: normal; overflow: visible; max-width: 10ch; }"
					}
				</style>
			) : null}
			<GeometryChatHeader
				agentName={
					params.get("long")
						? "A long agent conversation title that must yield gracefully"
						: "Aida"
				}
				agentAvatar={{
					agentId: CODER.id,
					agentName: CODER.name,
					sha256: SHA,
					owned: true,
				}}
				identity={{
					sessionId: "9f3ac1e0b7d2",
					activeAgent: "aida",
					activeTeam: null,
				}}
				deviceSlot={
					missing ? undefined : <GeometryDeviceSlot sessionId="9f3ac1e0b7d2" />
				}
			/>
		</div>
	);
};
export const HeaderGeometry: Story = {
	render: () => <HeaderGeometryFixture />,
	// Assert real DOM boxes, not a mocked flex calculation. The synthetic wrap
	// arm stress-tests multiline layout; shipped titles still truncate normally.
	play: async ({ canvasElement }) => {
		const element = canvasElement.querySelector<HTMLElement>(
			"[data-geometry-fixture]",
		);
		if (!element) throw new Error("Missing header geometry fixture");
		await assertHeaderGeometry(element);
	},
};

/** Also run outside the interactions addon so a plain iframe cannot skip the regression. */
async function assertHeaderGeometry(element: HTMLElement): Promise<number> {
	const expected = Number(element.dataset.expectedElements || 5);
	await document.fonts.ready;
	const selectors = [
		"[data-agent-mark]",
		"[data-header-title]",
		"[data-header-identity]",
		"[data-device-chip]",
	];
	let elements: Element[] = [];
	for (let attempt = 0; attempt < 100; attempt++) {
		elements = selectors.flatMap((selector) =>
			Array.from(element.querySelectorAll(selector)),
		);
		if (
			element.querySelector("[data-agent-mark] img") &&
			elements.length >= expected
		)
			break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	await new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(resolve)),
	);
	if (elements.length < expected)
		throw new Error(
			"Header geometry fixture did not load its picture and controls",
		);
	const centres = elements.map((element) => {
		const box = element.getBoundingClientRect();
		return box.y + box.height / 2;
	});
	const spread = Math.max(...centres) - Math.min(...centres);
	if (spread > 0.05)
		throw new Error(
			`Header centres differ by ${spread}px: ${centres.join(", ")}`,
		);
	return spread;
}

/**
 * Summary portraits use the shipped detail pane and local media seam, never an
 * account/Bridge photo. Distinct ids per state keep a prior successful cache
 * entry from making the loading/error stories accidentally show a picture.
 * These fixtures are authored under D2 NO START: no capture or pass is claimed.
 */
type SummaryPictureState = "populated" | "no-image" | "loading" | "error";
type SummaryPictureEvidence = {
	requests: number;
	inFlight: number;
	bytesDelivered: boolean;
	decodeErrorSource: string | null;
};
const summaryPictureEvidence = new WeakMap<
	HTMLElement,
	SummaryPictureEvidence
>();

const SummaryPortraitScene: FC<{
	state: SummaryPictureState;
	width?: number;
	longName?: boolean;
}> = ({ state, width = 960, longName = false }) => {
	const client = useQueryClient();
	const rootRef = useRef<HTMLDivElement>(null);
	const [ready, setReady] = useState(false);
	// Per-mount local ids prevent an earlier story's immutable blob cache from
	// satisfying this story without its own discriminating media request.
	const id = useMemo(
		() => `summary-portrait-${state}-${crypto.randomUUID()}`,
		[state],
	);
	useLayoutEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const evidence: SummaryPictureEvidence = {
			requests: 0,
			inFlight: 0,
			bytesDelivered: false,
			decodeErrorSource: null,
		};
		summaryPictureEvidence.set(root, evidence);
		const avatar: AgentAvatarMeta = {
			sha256: SHA,
			mime: "image/png",
			bytes: PNG.byteLength,
			updated_at: "2026-10-30T00:00:00.000Z",
		};
		const map = state === "no-image" ? {} : { [id]: avatar };
		// Preview owns a client per story. Seed that provider, not the app's
		// imported singleton, BEFORE mounting a reader that can start a query.
		client.setQueryData(agentAvatarsQueryKey, map);
		const api = window as unknown as {
			api: {
				desktop: {
					media: (request: {
						op?: string;
						agentId?: string;
					}) => Promise<unknown>;
					request: (request: { op?: string }) => Promise<unknown>;
				};
			};
		};
		const previousMedia = api.api.desktop.media;
		const previousRequest = api.api.desktop.request;
		const request: typeof previousRequest = async (input) => {
			// A later stale/refetch read must reproduce this same local catalogue,
			// never replace the seed through preview's unconfigured transport.
			if (input.op !== "legacy.agents.list") return previousRequest(input);
			return {
				status: 200,
				body: {
					result: {
						agents: [
							{
								id,
								name: `summary-${state}`,
								...(state === "no-image" ? {} : { avatar }),
							},
						],
					},
				},
			};
		};
		const media: typeof previousMedia = async (input) => {
			if (input.op !== "agent.avatar") return previousMedia(input);
			if (input.agentId !== id)
				throw new Error("Summary requested another identity's image");
			evidence.requests++;
			evidence.inFlight++;
			root.dataset.summaryMediaPhase = "in-flight";
			if (state === "loading") {
				// Keep a REAL requested read pending; an early empty glyph alone is
				// not evidence that the loading arm was reached.
				return new Promise<never>(() => {
					/* Deliberately held transport. */
				});
			}
			evidence.inFlight--;
			evidence.bytesDelivered = true;
			root.dataset.summaryMediaPhase = "bytes-delivered";
			return {
				status: 200,
				kind: "bytes",
				mimeType: "image/png",
				data: state === "error" ? new Uint8Array([0, 1, 2]) : PNG,
			};
		};
		// Radix loads a detached native Image before mounting its <img>. A DOM
		// error listener cannot see that event. Observe the REAL native decoder,
		// without synthesising an error, replacing a result or touching production.
		const NativeImage = window.Image;
		const observedImages = new Map<HTMLImageElement, () => void>();
		const ObservedImage = new Proxy(NativeImage, {
			construct(target, args) {
				const image = Reflect.construct(target, args) as HTMLImageElement;
				const onError = () => {
					if (
						state === "error" &&
						evidence.bytesDelivered &&
						image.src === peekBlobUrl(agentAvatarPath(id, SHA))
					) {
						evidence.decodeErrorSource = image.src;
						root.dataset.summaryMediaPhase = "decode-error";
					}
				};
				observedImages.set(image, onError);
				image.addEventListener("error", onError, { once: true });
				return image;
			},
		});
		api.api.desktop.request = request;
		api.api.desktop.media = media;
		if (state === "error") window.Image = ObservedImage;
		setReady(true);
		return () => {
			summaryPictureEvidence.delete(root);
			for (const [image, onError] of observedImages)
				image.removeEventListener("error", onError);
			if (api.api.desktop.media === media)
				api.api.desktop.media = previousMedia;
			if (api.api.desktop.request === request)
				api.api.desktop.request = previousRequest;
			if (window.Image === ObservedImage) window.Image = NativeImage;
		};
	}, [client, state, id]);
	const profile = useMemo(
		() =>
			makeProfile({
				name: `summary-${state}`,
				agent_id: id,
				source: "custom",
				description: "A local agent whose summary shows its own picture.",
			}),
		[state, id],
	);
	return (
		<div
			ref={rootRef}
			className="bg-surface p-6"
			style={{ width, maxWidth: "100%" }}
			data-summary-picture-state={state}
		>
			{ready ? (
				<AgentDetail
					key={id}
					profile={profile}
					displayedName={
						longName
							? "An unusually long selected agent name that must not crowd its actions"
							: "Local summary agent"
					}
					classNotice={null}
					onClassNotice={noop}
					teams={[]}
					effortTiers={[]}
					askEnabled={false}
					onSaved={noop}
					onDuplicate={noop}
					onOpenTeam={noop}
					onAskAgent={noop}
				/>
			) : null}
		</div>
	);
};

export const SummaryPortraitPopulated: Story = {
	render: () => <SummaryPortraitScene state="populated" />,
	play: async ({ canvasElement }) => {
		await assertSummaryPortrait(canvasElement);
	},
};
export const SummaryPortraitNoImage: Story = {
	render: () => <SummaryPortraitScene state="no-image" />,
	play: async ({ canvasElement }) => {
		await assertSummaryPortrait(canvasElement);
	},
};
export const SummaryPortraitLoading: Story = {
	render: () => <SummaryPortraitScene state="loading" />,
	play: async ({ canvasElement }) => {
		await assertSummaryPortrait(canvasElement);
	},
};
export const SummaryPortraitError: Story = {
	render: () => <SummaryPortraitScene state="error" />,
	play: async ({ canvasElement }) => {
		await assertSummaryPortrait(canvasElement);
	},
};
export const SummaryPortraitPopulatedNarrow: Story = {
	render: () => <SummaryPortraitScene state="populated" width={360} longName />,
	play: async ({ canvasElement }) => {
		await assertSummaryPortrait(canvasElement);
	},
};
export const SummaryPortraitNoImageNarrow: Story = {
	render: () => <SummaryPortraitScene state="no-image" width={360} longName />,
	play: async ({ canvasElement }) => {
		await assertSummaryPortrait(canvasElement);
	},
};
export const SummaryPortraitLoadingNarrow: Story = {
	render: () => <SummaryPortraitScene state="loading" width={360} longName />,
	play: async ({ canvasElement }) => {
		await assertSummaryPortrait(canvasElement);
	},
};
export const SummaryPortraitErrorNarrow: Story = {
	render: () => <SummaryPortraitScene state="error" width={360} longName />,
	play: async ({ canvasElement }) => {
		await assertSummaryPortrait(canvasElement);
	},
};

/** Authored but unexecuted during D2: these checks need a real admitted renderer. */
async function assertSummaryPortrait(canvas: HTMLElement): Promise<void> {
	await document.fonts.ready;
	const root = canvas.querySelector<HTMLElement>(
		"[data-summary-picture-state]",
	);
	if (!root) throw new Error("Summary fixture is missing");
	const state = root.dataset.summaryPictureState;
	let settled = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		const portrait = root.querySelector("[data-agent-summary-portrait]");
		const image = portrait?.querySelector("img");
		const glyph = Boolean(portrait?.querySelector("svg"));
		const evidence = summaryPictureEvidence.get(root);
		settled = Boolean(
			evidence &&
				(state === "populated"
					? evidence.requests > 0 &&
						evidence.bytesDelivered &&
						image?.complete &&
						image.naturalWidth > 0
					: state === "loading"
						? evidence.requests > 0 &&
							evidence.inFlight > 0 &&
							!evidence.bytesDelivered &&
							glyph
						: state === "error"
							? evidence.requests > 0 &&
								evidence.bytesDelivered &&
								evidence.decodeErrorSource &&
								glyph
							: state === "no-image" && evidence.requests === 0 && glyph),
		);
		if (settled) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	if (!settled)
		throw new Error(`Summary never reached its discriminating ${state} state`);
	// These frames follow the observed request/decoder event, rather than being
	// used as a substitute for proving the event happened.
	await new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(resolve)),
	);
	const portrait = root.querySelector<HTMLElement>(
		"[data-agent-summary-portrait]",
	);
	const header = root.querySelector<HTMLElement>("[data-agent-summary-header]");
	if (!portrait || !header)
		throw new Error("Summary did not render its identity");
	if (state !== "populated" && !portrait.querySelector("svg"))
		throw new Error(
			"Missing/loading/failed picture lost the local agent glyph",
		);
	const box = portrait.getBoundingClientRect();
	const edge =
		Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 5;
	if (Math.abs(box.width - edge) > 0.1 || Math.abs(box.height - edge) > 0.1)
		throw new Error(
			"Summary portrait no longer reserves its comfortable square",
		);
	const titleBlock = portrait.nextElementSibling?.getBoundingClientRect();
	if (
		!titleBlock ||
		Math.abs(box.y + box.height / 2 - titleBlock.y - titleBlock.height / 2) >
			0.1
	)
		throw new Error(
			"Summary portrait and name/status lost shared centre alignment",
		);
	/*
	 * The trailing ghost button deliberately bleeds its hover box into the gutter
	 * by its own negative right margin, so its GLYPH sits on the column edge
	 * (design D1, `-mr-2` in agent-detail). Allow exactly that measured margin -
	 * read from computed style, not a fixed slack - so any other overflow fails.
	 */
	const bounds = header.getBoundingClientRect();
	const buttons = Array.from(
		header.querySelectorAll<HTMLElement>("[data-agent-summary-actions] button"),
	);
	const trailing = buttons.at(-1);
	const bleed = trailing
		? Math.max(0, -Number.parseFloat(getComputedStyle(trailing).marginRight))
		: 0;
	if (header.scrollWidth > header.clientWidth + bleed + 1)
		throw new Error("Summary header overflows the narrow pane");
	for (const button of buttons) {
		const action = button.getBoundingClientRect();
		const allowed = button === trailing ? bleed : 0;
		if (
			action.left < bounds.left - 1 ||
			action.right > bounds.right + allowed + 1
		)
			throw new Error("Summary action escaped its responsive header");
	}
}

/** The existing Edit button, not a new portrait-specific settings route. */
export const SummaryPortraitExistingEdit: Story = {
	render: () => <SummaryPortraitScene state="populated" width={360} longName />,
	play: async ({ canvasElement }) => {
		await assertSummaryPortrait(canvasElement);
		const url = window.location.href;
		const edit = Array.from(
			canvasElement.querySelectorAll<HTMLButtonElement>(
				"[data-agent-summary-actions] button",
			),
		).find(
			(button) =>
				button.textContent?.trim() === t("ui.agents.detail.action.edit"),
		);
		if (!edit) throw new Error("Existing Edit button is missing");
		edit.click();
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
		if (
			!canvasElement.querySelector("#agent-picture") ||
			canvasElement.querySelector("[data-agent-summary-portrait]")
		)
			throw new Error("Edit did not open the existing agent picture field");
		if (window.location.href !== url)
			throw new Error("Edit navigated to a redundant settings route");
	},
};
