import { BrandMark } from "@shared/components/common/brand-mark";
import { useEffect, useRef } from "react";
import { trackNewChatHorizon } from "./new-chat-horizon-motion";
import "./new-chat-horizon.css";

const WIDTH = 640;
const HEIGHT = 172;
const MARK_Y = 139;
const INKS = [
	{ width: 0.85, opacity: 0.3 },
	{ width: 1.2, opacity: 0.57 },
	{ width: 1.55, opacity: 0.73 },
	{ width: 2.05, opacity: 0.49 },
];
const unit = (value: number) => Math.max(0, Math.min(1, value));
const feather = (value: number) => {
	const t = unit(value);
	return t * t * (3 - 2 * t);
};

function engrave() {
	// A stable seed gives lithographic irregularity without a different image on
	// each mount. Ink weight is batched into a few paths; no point is a DOM node.
	let seed = 0x93b1;
	const sample = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 0x100000000;
	};
	const ink = INKS.map(() => [] as string[]);
	const flecks: string[] = [];
	const rake: string[] = [];
	const crest = (x: number) => {
		// The long left shoulder rises late. The right face drops sooner, so
		// the peak is offset instead of mirroring the centred figure below it.
		return (
			(x < 405
				? 119 - 98 * feather(unit((x - 14) / 391) ** 1.85)
				: 21 + 109 * feather((x - 405) / 182)) +
			3.5 * Math.sin(x / 31)
		);
	};
	const put = (x: number, y: number, weight: number) => {
		// Round, but not an outline: progressively thin the surrounding ink so
		// the same circular silhouette reads as unprinted paper around the glyph.
		const radius = Math.hypot(x - WIDTH / 2, y - MARK_Y);
		const edge = feather(Math.min(x, WIDTH - x) / 100);
		const foot = feather((162 - y) / 13);
		if (sample() > edge * foot * feather((radius - 20) / 12)) return;
		const point = `M${x.toFixed(1)} ${y.toFixed(1)}h.01`;
		if (sample() < 0.05) flecks.push(point);
		else ink[weight].push(point);
	};

	const grain = () => sample() + sample() + sample() - 1.5;
	// Two distinct, broken impressions. Keep open paper between them so the
	// second sweep can be seen, even in a small crop around the figure.
	for (const [band, count] of [554, 428].entries()) {
		for (let index = 0; index < count; index += 1) {
			const x = 9 + (622 * (index + sample())) / count;
			const middle = feather(1 - Math.abs(x - 367) / 290);
			const fracture = Math.sin(x / (13 + band * 4) + band * 2.7);
			if (sample() > 0.59 + 0.2 * fracture + 0.23 * middle) continue;
			const line = band ? crest(x + 14) + 29 + 9 * Math.cos(x / 79) : crest(x);
			put(x, line + grain() * (8 + 5 * (1 - middle)), sample() < 0.59 ? 1 : 2);
		}
	}

	// The foreground plate bends around the logo's shoulder, not into a closed
	// ring. Leave a trail of sparer, heavier grains as the sweep turns away.
	const sweep = [
		{ count: 134, xs: [38, 141, 214, 274], ys: [143, 134, 103, 105] },
		{ count: 99, xs: [274, 328, 348, 353], ys: [105, 94, 101, 135] },
		{ count: 83, xs: [353, 362, 414, 469], ys: [135, 169, 151, 145] },
		{ count: 65, xs: [469, 523, 568, 614], ys: [145, 138, 136, 148] },
	];
	const cubic = ([a, b, c, d]: number[], t: number) => {
		const u = 1 - t;
		return u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d;
	};
	for (const { count, xs, ys } of sweep) {
		for (let index = 0; index < count; index += 1) {
			const t = (index + sample()) / count;
			const x = cubic(xs, t) + 3 * grain();
			const y = cubic(ys, t) + 8 * grain();
			if (sample() < 0.68 + 0.2 * Math.sin(x / 17))
				put(x, y, sample() < 0.42 ? 3 : 1);
		}
	}

	// Softly break the linework with loose paper grain, without filling the
	// openings that let the engraved bands and the logo read as one image.
	for (let index = 0; index < 360; index += 1) {
		const x = 320 + (sample() + sample() - 1) * 337;
		const ridge = crest(x);
		const y = ridge + 4 + (156 - ridge) * sample();
		put(x, y, 0);
	}

	// Only this sparse second impression moves. It sits well above the mark
	// so neither the clearing nor the engraved silhouette swims with the mouse.
	for (let index = 0; index < 156; index += 1) {
		const x = 383 + (sample() + sample() - 1) * 126;
		const y = crest(x) + 3 + 32 * sample() ** 1.8;
		const strength = feather(1 - Math.abs(x - 383) / 126);
		if (sample() < strength) rake.push(`M${x.toFixed(1)} ${y.toFixed(1)}h.01`);
	}
	return {
		ink: ink.map((points) => points.join("")),
		flecks: flecks.join(""),
		rake: rake.join(""),
	};
}
const STIPPLE = engrave();

export function NewChatHorizon({
	splash,
	quiet,
}: {
	splash: HTMLElement | null;
	quiet: boolean;
}) {
	const rake = useRef<SVGSVGElement>(null);
	useEffect(() => {
		if (!splash || !rake.current || quiet) return;
		// The growing wrapper owns the blank paper above and below the content
		// strip. Listening there makes the ink respond before reaching the text.
		const paper = splash.closest<HTMLElement>("[data-lo-composer-splash]");
		return trackNewChatHorizon(paper ?? splash, rake.current);
	}, [quiet, splash]);

	return (
		<div className="new-chat-horizon">
			<span
				aria-hidden="true"
				className="new-chat-horizon__scene"
				data-quiet={quiet ? "" : undefined}
			>
				<span className="new-chat-horizon__engraving">
					<svg
						aria-hidden="true"
						className="new-chat-horizon__paint"
						viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
					>
						{STIPPLE.ink.map((path, index) => (
							<path
								key={INKS[index].width}
								d={path}
								strokeOpacity={INKS[index].opacity}
								strokeWidth={INKS[index].width}
							/>
						))}
						<path
							className="new-chat-horizon__flecks"
							d={STIPPLE.flecks}
							strokeWidth={1.45}
						/>
					</svg>
					<svg
						aria-hidden="true"
						ref={rake}
						className="new-chat-horizon__rake"
						viewBox="196 8 340 118"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
					>
						<path d={STIPPLE.rake} strokeWidth={1.3} />
					</svg>
				</span>
			</span>
			{/* Also the first-send driver's splash selector. The fixed canonical
			    figure sits inside the unprinted circular recess in the engraving. */}
			<span
				data-lo-empty-mark=""
				className="new-chat-horizon__mark relative flex"
			>
				<BrandMark className="size-10" tone="ink-muted" treatment="engraved" />
			</span>
		</div>
	);
}
