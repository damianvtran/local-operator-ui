import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import "../../../styles/index.css";
import toneUrl from "../../../../../../scripts/fixtures/music-tone.mp3?url";
import { MusicJobMotif } from "./music-job-motif";
import { MusicResult } from "./music-result";
import { musicReceiptOf, type MusicReceipt } from "./music-receipt-model";

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
		<div className="w-[200px]">
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
