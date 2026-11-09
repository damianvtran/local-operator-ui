#!/usr/bin/env node
/**
 * Derive the two marketing sites' WebP layout from honest browser PNG masters.
 *
 *   node scripts/derive-marketing-webp.mjs --input=<png-dir> --out=<dir>
 *
 * Invariant: no output is wider OR taller than the pixels it samples. PNG IHDR
 * dimensions, not a nominal viewport/dpr, decide what can be emitted. A 2560x1440
 * browser capture therefore stays 16:9 and cannot produce the historical
 * 2880x1800 Team Bridge @2x file. Missing oversized variants are reported,
 * never upscaled or relabelled. Consumers must update intrinsic aspect metadata.
 *
 * Naming/widths follow committed site assets at the time this script landed:
 * local-operator-site/src/assets/{scenarios,team-bridge}, and Radient's
 * public/teams/screens. q88/-m6 is the documented docs-library conversion in
 * capture-docs-library.mjs, not a claim to know the absent original Bridge
 * encoder settings (WebP does not retain its encoder's quality argument).
 *
 * Crops are normalized rectangles of the CURRENT Northwind story's 80%-zoom
 * composition at 2560x1440 actual pixels. Their true dimensions are in the JSON
 * report, so a page cannot silently keep the old crop's aspect ratio.
 *
 * Team Bridge masters MUST be 16:9 (`capture-docs-library.mjs`'s 1280x720
 * default at 2x). The sidebar and thread pane are fixed-width in layout pixels,
 * so the fractions below only land on their columns at the calibrated aspect: a
 * 16:10 master used to derive wrong-region crops (and the historical 2880x1800
 * `@2x` name from a different layout) with a green exit. Such a source is now
 * refused before anything is written.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const QUALITY = 88;
export const SCENARIOS = [
	"hero",
	"conversation-tools",
	"subagents",
	"media-in-conversation",
	"teams",
	"projects",
	"agent-hub",
	"mesh",
	"schedules",
	"notifications",
	"asks",
	"review-pane",
];
const BRIDGE = ["channel", "thread", "approval", "mention", "launch"];
// Coordinates measured against the current real-component story; no retouching.
const CROPS = {
	channel: { scene: "channel", rect: [0.17, 0.37, 0.56, 0.33], width: 1200 },
	thread: { scene: "thread", rect: [0.74, 0, 0.26, 1], width: 832 },
	// Top at 0.34: the unfiltered "@" picker opens to ~0.36 of the frame's
	// height, and its "People in this conversation" heading is the subject.
	mention: { scene: "mention", rect: [0.17, 0.34, 0.7, 0.66], width: 1100 },
	rail: { scene: "channel", rect: [0, 0.18, 0.163, 0.64], width: 540 },
	approval: { scene: "approval", rect: [0.17, 0.24, 0.82, 0.64], width: 2320 },
};

export function pngDimensions(buffer) {
	if (
		buffer.length < 24 ||
		buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
	)
		throw new Error("Input must be a PNG with an IHDR header");
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Pure plan, exercised without an encoder or browser. */
export function planDerivatives(name, dimensions) {
	const { width, height } = dimensions;
	if (!(width > 0 && height > 0))
		throw new Error("Positive source dimensions required");
	const match = name.match(/^(.*)-(light|dark)\.png$/);
	if (!match) throw new Error(`Expected <scene>-<light|dark>.png: ${name}`);
	const [, scene, theme] = match;
	// Within one pixel rather than exact: an odd-width master (1275x717) cannot
	// be an exact 16:9 integer pair, yet is the same composition.
	if (scene.startsWith("bridge-") && Math.abs(height - (width * 9) / 16) >= 1)
		throw new Error(
			`Team Bridge crops are calibrated to 16:9 masters; ${name} is ${width}x${height}. Re-capture with --viewport=1280x720.`,
		);
	const outputs = [];
	const skipped = [];
	const add = (file, targetWidth, rect = null, shrinkCrop = true) => {
		let crop = null;
		if (rect) {
			// Origin and extent round independently, so an edge-touching rect can
			// overrun an odd-sized source by one pixel (0.74 + 0.26 of 1275 is
			// 944 + 332): clamp the extent to the source edge, where cwebp would
			// otherwise refuse the crop.
			const x = Math.min(Math.round(rect[0] * width), width - 1);
			const y = Math.min(Math.round(rect[1] * height), height - 1);
			crop = [
				x,
				y,
				Math.max(1, Math.min(Math.round(rect[2] * width), width - x)),
				Math.max(1, Math.min(Math.round(rect[3] * height), height - y)),
			];
		}
		const sampledWidth = crop?.[2] ?? width;
		const sampledHeight = crop?.[3] ?? height;
		// Crop widths may shrink to their real source width; full responsive
		// variants keep their named widths or are absent, never misleading.
		const outputWidth =
			crop && shrinkCrop ? Math.min(targetWidth, sampledWidth) : targetWidth;
		const outputHeight = Math.round(
			(outputWidth * sampledHeight) / sampledWidth,
		);
		if (outputWidth > sampledWidth || outputHeight > sampledHeight) {
			skipped.push({
				file,
				reason: `would upscale ${sampledWidth}x${sampledHeight} to ${outputWidth}x${outputHeight}`,
			});
			return;
		}
		outputs.push({ file, width: outputWidth, height: outputHeight, crop });
	};
	if (SCENARIOS.includes(scene)) {
		for (const w of scene === "hero" ? [768, 1536, 2560] : [768, 1536])
			add(
				`local-operator-site/src/assets/scenarios/${scene}-${theme}-${w}.webp`,
				w,
			);
	} else if (scene.startsWith("bridge-") && BRIDGE.includes(scene.slice(7))) {
		const bridge = scene.slice(7);
		for (const w of ["channel", "thread"].includes(bridge)
			? [768, 1536, 2560]
			: [768, 1536])
			add(
				`local-operator-site/src/assets/team-bridge/${bridge}-${theme}-${w}.webp`,
				w,
			);
		for (const [label, crop] of Object.entries(CROPS)) {
			if (crop.scene === bridge)
				add(
					`local-operator-site/src/assets/team-bridge/crop-${label}-${theme}.webp`,
					crop.width,
					crop.rect,
				);
		}
		if (
			theme === "dark" &&
			["channel", "thread", "approval"].includes(bridge)
		) {
			add(`radient-site/public/teams/screens/${bridge}-dark@1x.webp`, 1440);
			add(`radient-site/public/teams/screens/${bridge}-dark@2x.webp`, 2880);
		}
		if (theme === "dark" && bridge === "mention") {
			// The historical 1180x460 / 2360x920 composer crop is not synthesized:
			// name the current crop's actual dimensions in the report instead.
			const rect = CROPS.mention.rect;
			add(
				"radient-site/public/teams/screens/composer-mention-dark@1x.webp",
				1180,
				rect,
				false,
			);
			add(
				"radient-site/public/teams/screens/composer-mention-dark@2x.webp",
				2360,
				rect,
				false,
			);
		}
	} else {
		throw new Error(`Unknown marketing scene: ${scene}`);
	}
	return { name, source: dimensions, outputs, skipped };
}

export function derive(
	input,
	out,
	{ encoder = "/opt/homebrew/bin/cwebp", only = null } = {},
) {
	// A misspelt --only used to select nothing and exit 0 with `sources: 0`,
	// which reads as a successful run that simply had nothing to do.
	const known = [...SCENARIOS, ...BRIDGE.map((scene) => `bridge-${scene}`)];
	const unknown = (only ?? []).filter((scene) => !known.includes(scene));
	if (unknown.length > 0)
		throw new Error(
			`--only names ${unknown.join(", ")}, which is not a marketing scene (${known.join(", ")})`,
		);
	const reports = [];
	for (const name of readdirSync(input)
		.filter(
			(name) =>
				name.endsWith(".png") &&
				(!only || only.includes(name.replace(/-(light|dark)\.png$/, ""))),
		)
		.sort()) {
		const source = join(input, name);
		const report = planDerivatives(name, pngDimensions(readFileSync(source)));
		for (const item of report.outputs) {
			const destination = join(out, item.file);
			mkdirSync(dirname(destination), { recursive: true });
			const args = ["-quiet", "-q", String(QUALITY), "-m", "6"];
			if (item.crop) args.push("-crop", ...item.crop.map(String));
			args.push(
				"-resize",
				String(item.width),
				String(item.height),
				source,
				"-o",
				destination,
			);
			const result = spawnSync(encoder, args, { encoding: "utf8" });
			if (result.error || result.status !== 0)
				throw new Error(
					`${basename(encoder)} failed for ${name}: ${result.error?.message ?? result.stderr}`,
				);
			item.path = destination;
			item.command = [encoder, ...args];
		}
		reports.push(report);
	}
	if (reports.length === 0)
		throw new Error(
			`No <scene>-<light|dark>.png sources matched in ${input}${only ? ` for --only=${only.join(",")}` : ""}`,
		);
	mkdirSync(out, { recursive: true });
	writeFileSync(
		join(out, "DERIVATIVES.json"),
		`${JSON.stringify(reports, null, 2)}\n`,
	);
	return reports;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const flag = (name) =>
		process.argv
			.slice(2)
			.find((arg) => arg.startsWith(`--${name}=`))
			?.slice(name.length + 3);
	const input = flag("input");
	const out = flag("out");
	if (!input || !out)
		throw new Error("Required: --input=<png-dir> --out=<dir>");
	const reports = derive(resolve(input), resolve(out), {
		only: flag("only")?.split(",").filter(Boolean) ?? null,
	});
	console.log(
		JSON.stringify(
			{
				sources: reports.length,
				outputs: reports.reduce((sum, r) => sum + r.outputs.length, 0),
				skipped: reports.flatMap((r) => r.skipped),
			},
			null,
			2,
		),
	);
}
