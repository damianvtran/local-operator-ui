import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { JobCancelPopover } from "../components/run-details/job-cancel-popover";
import { RunDetailJobs } from "../components/run-details/run-detail-jobs";
import { deriveRunDetails } from "../components/run-details/run-detail-model";
import { useJobCancel } from "../components/run-details/use-job-cancel";
import { CanonicalTranscript } from "./canonical-transcript";
import { EMPTY_TRANSCRIPT, applyHistoryPage } from "./transcript-reducer";
import "../../../styles/index.css";
import toneUrl from "../../../../../../scripts/fixtures/music-tone.mp3?url";
import { MusicJobMotif } from "./music-job-motif";
import { type MusicReceipt, musicReceiptOf } from "./music-receipt-model";
import { MusicResult } from "./music-result";

/** Rendered-state fixtures use a real synthetic MP3, never autoplay. The inline
 * fixture proves the shared player's layout/decoding input, NOT the production
 * digest relay or backend billing path; those require the independent live flow. */
const Completed = ({ partial = false }: { partial?: boolean }) => {
	const [receipt, setReceipt] = useState<MusicReceipt | null>(null);
	useEffect(() => {
		let live = true;
		void fetch(toneUrl)
			.then((response) => response.arrayBuffer())
			.then((buffer) => {
				const data = btoa(String.fromCharCode(...new Uint8Array(buffer)));
				const result = musicReceiptOf({
					material: "music",
					attribution: "Approved fixture attribution",
					tracks: [
						{
							id: "fixture-one",
							title: "Piano study",
							variant_index: 0,
							cost: { v: 1, amount_usd: 0.0075, basis: "billed" },
						},
						{
							id: "fixture-two",
							title: "Piano variation",
							variant_index: 1,
							...(partial ? { error_type: "audio_failed" } : {}),
							cost: { v: 1, amount_usd: partial ? 0 : 0.0075, basis: "billed" },
						},
					],
					artifacts: [
						{
							digest: "a".repeat(32),
							track_id: "fixture-one",
							artifact_id: "first",
							role: "full_mix",
							name: "piano-study.mp3",
							duration_s: 0.25,
						},
						...(!partial
							? [
									{
										digest: "a".repeat(32),
										track_id: "fixture-two",
										artifact_id: "second",
										role: "full_mix",
										name: "piano-variation.mp3",
										duration_s: 0.25,
									},
								]
							: []),
					],
				});
				if (result)
					for (const track of result.tracks)
						for (const image of track.images) {
							image.data = data;
							image.attachment = null;
						}
				if (live) setReceipt(result ?? null);
			});
		return () => {
			live = false;
		};
	}, [partial]);
	return receipt ? (
		<MusicResult receipt={receipt} scope={null} />
	) : (
		<MusicJobMotif active={false} />
	);
};
const meta: Meta = {
	title: "Chat/Canonical/Music",
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-[520px] max-w-full bg-surface p-4">
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj;
export const Queued: Story = {
	render: () => <MusicJobMotif active={false} completed={0} total={2} />,
};
export const Running: Story = {
	render: () => (
		<MusicJobMotif
			active={true}
			completed={0}
			total={2}
			attribution="Approved fixture attribution"
		/>
	),
};
export const Narrow: Story = {
	render: () => (
		<div className="w-[172px]">
			<MusicJobMotif active={true} completed={1} total={2} />
		</div>
	),
};
export const Populated: Story = { render: () => <Completed /> };
export const PartialFailure: Story = { render: () => <Completed partial /> };
export const Empty: Story = {
	render: () => (
		<MusicResult receipt={{ attribution: "", tracks: [] }} scope={null} />
	),
};

const fixtureQueries = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
const fixtureTitle =
	"A long piano composition title with retained ranges and independently billed variations";

/** Actual Jobs row, confirmation and hook; the synthetic control is explicitly
 * local and cannot cancel or purchase anything from a provider. */
const JobsFlow = ({ rtl = false }: { rtl?: boolean }) => {
	const [requested, setRequested] = useState(false);
	const cancel = useJobCancel({
		sessionId: "synthetic-music",
		controls: {
			cancel: async () => {
				setRequested(true);
				return { ok: true };
			},
		},
	});
	const details = deriveRunDetails({
		jobs: [
			{
				id: "fixture-music",
				type: "music",
				status: "running",
				label: fixtureTitle,
				latest_details: {
					music: {
						stage: requested ? "cancel_requested" : "polling",
						tracks: [
							{ id: "first", settled: true },
							{ id: "second", settled: false },
						],
						attribution: "Approved fixture attribution",
					},
				},
			},
		],
		todos: [],
	});
	return (
		<div
			dir={rtl ? "rtl" : "ltr"}
			className="w-[172px]"
			data-run-panel-pane
			tabIndex={-1}
		>
			<RunDetailJobs
				details={details}
				paneWidth={172}
				cancel={cancel.section}
			/>
			<JobCancelPopover {...cancel.popover} />
		</div>
	);
};
export const JobsCancel: Story = { render: () => <JobsFlow /> };
export const JobsCancelRtl: Story = { render: () => <JobsFlow rtl /> };

/** Durable-envelope fixture reaches the production reducer/NoticeRow/player.
 * Missing cached bytes and peaks are intentional; this does not claim relay QA. */
const CanonicalFlow = ({ rtl = false }: { rtl?: boolean }) => {
	// The production transcript owns this ref's scrolling element. Its flex
	// column needs an allocated viewport, not a fresh null ref on each render.
	const containerRef = useRef<HTMLDivElement>(null);
	const transcript = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "fixture-job-result",
				ts: 1760000000,
				type: "message",
				payload: {
					kind: "custom",
					custom_type: "job_result",
					details: {
						text: "Music settled",
						material: "music",
						attribution: "Approved fixture attribution",
						tracks: [
							{
								id: "first",
								title: fixtureTitle,
								variant_index: 0,
								cost: { v: 1, amount_usd: 0.0075, basis: "billed" },
							},
							{
								id: "second",
								title: fixtureTitle,
								variant_index: 1,
								error_type: "fixture_failure",
								cost: { v: 1, amount_usd: 0, basis: "billed" },
							},
						],
						artifacts: [
							{
								digest: "a".repeat(32),
								track_id: "first",
								artifact_id: "first",
								role: "full_mix",
								name: "piano.mp3",
							},
						],
					},
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	return (
		<QueryClientProvider client={fixtureQueries}>
			<div
				dir={rtl ? "rtl" : "ltr"}
				className="flex h-[600px] w-[172px] min-h-0 flex-col"
			>
				<CanonicalTranscript
					transcript={transcript}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={true}
					status="live"
					failure={null}
					awaitingHydration={false}
					hydrationProven={true}
					onReconnect={() => {}}
				/>
			</div>
		</QueryClientProvider>
	);
};
export const CanonicalMissingBytes: Story = { render: () => <CanonicalFlow /> };
export const CanonicalRtl: Story = { render: () => <CanonicalFlow rtl /> };
