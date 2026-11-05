/** Fixture host only. All product interaction stays in the real child document.
 * Sampling is armed before navigation; it reads layout without changing focus,
 * scroll, styles or application state. A rAF observation is NOT a pixel frame. */
const SCROLLABLE = /auto|scroll/;
export const MAX_SAMPLES = 180;
export const MAX_SAMPLE_MS = 5000;
export const SIZES = { narrow: [800, 600], wide: [1280, 900] };
export const SCENES = [
	"long",
	"short",
	"only",
	"echo",
	"code",
	"links",
	"reopen",
	"cold-long",
	"cold-short",
	"fr-long",
	"ur-long",
	"quote",
	"seal",
	"image",
];

export function sceneUrl(scene) {
	if (!SCENES.includes(scene)) throw new Error("Unknown preview scenario");
	const query = new URLSearchParams({
		sessions: "3",
		steps: "1",
		outgoingSteps: "1",
		theme: "dark",
	});
	if (scene === "only") query.set("attachment", "only");
	else if (scene === "echo") query.set("attachment", "echo");
	else query.set("attachment", "prose");
	if (["long", "echo", "links"].includes(scene)) query.set("userLines", "24");
	if (["code", "links", "quote", "seal", "image"].includes(scene))
		query.set("userExample", scene);
	if (
		[
			"reopen",
			"cold-long",
			"fr-long",
			"ur-long",
			"quote",
			"seal",
			"image",
		].includes(scene)
	)
		query.set("userLines", "24");
	if (scene.startsWith("cold-")) query.set("boot", "sidebar");
	if (scene === "fr-long") query.set("locale", "fr");
	if (scene === "ur-long") query.set("locale", "ur");
	// The nested trigger must start in view, not above a long synthetic request.
	// Payload parsing and the real Disclosure remain unchanged.
	if (scene === "seal") query.set("userLines", "0");
	if (scene === "reopen") {
		query.set("domWindow", "on");
		query.set("steps", "90");
		query.set("outgoingSteps", "90");
	}
	return `session-switch.html?${query}`;
}

function rect(element) {
	if (!element) return null;
	const { x, y, width, height } = element.getBoundingClientRect();
	return { x, y, width, height };
}

export function readFrame(frame, expected, targetRecord = null) {
	const win = frame.contentWindow;
	const doc = frame.contentDocument;
	if (!win || !doc || !win.location.pathname.endsWith("/session-switch.html"))
		return { state: "navigating" };
	const row = doc.querySelector(
		targetRecord
			? `[data-record-kind="user"][data-record-id="${targetRecord}"]`
			: '[data-record-kind="user"]',
	);
	const intrinsic = row?.querySelector("[data-lo-user-turn-intrinsic]");
	const cap = intrinsic?.parentElement;
	const control = cap?.nextElementSibling?.matches("button[aria-expanded]")
		? cap.nextElementSibling
		: null;
	const focus = doc.activeElement;
	const scrolls = [];
	for (let node = row?.parentElement; node; node = node.parentElement) {
		if (
			node.scrollHeight > node.clientHeight &&
			SCROLLABLE.test(win.getComputedStyle(node).overflowY)
		) {
			scrolls.push({
				top: node.scrollTop,
				height: node.clientHeight,
				scrollHeight: node.scrollHeight,
			});
		}
	}
	return {
		state: row
			? "content-observed"
			: targetRecord
				? "target-not-mounted"
				: "no-user-row",
		targetRecord,
		domWindowSetting:
			win.localStorage?.getItem("canonicalTranscriptDomWindow") ?? null,
		domWindow: (() => {
			const region = doc.querySelector("[data-lo-dom-window]");
			return region
				? {
						enabled: region.getAttribute("data-lo-dom-window"),
						pinned: region.getAttribute("data-lo-dom-pinned"),
						reason: region.getAttribute("data-lo-dom-window-reason"),
					}
				: null;
		})(),
		language: doc.documentElement?.lang,
		direction: doc.documentElement?.dir,
		viewport: {
			width: win.innerWidth,
			height: win.innerHeight,
			matches:
				win.innerWidth === expected[0] && win.innerHeight === expected[1],
		},
		url: win.location.href,
		session: win.location.hash,
		recordId: row?.getAttribute("data-record-id") ?? null,
		ready: win.__lopSwitch?.ready === true,
		row: rect(row),
		bubble: rect(cap?.parentElement),
		cap: rect(cap),
		intrinsic: rect(intrinsic),
		control: rect(control),
		maxHeight: cap ? win.getComputedStyle(cap).maxHeight : null,
		expanded: control?.getAttribute("aria-expanded") ?? null,
		focused: {
			tag: focus?.tagName,
			text: focus?.textContent?.slice(0, 100),
			rect: rect(focus),
			disclosure: focus === control,
		},
		selectionLength: win.getSelection()?.toString().length ?? 0,
		scrolls,
	};
}

export function startSamples(read, publish, clock) {
	const samples = [];
	const start = clock.now();
	let cancelled = false;
	let pending;
	let previousGeometry;
	let stableFrames = 0;
	function tick() {
		if (cancelled) return;
		const observation = read();
		const geometry = JSON.stringify([
			observation.recordId,
			observation.viewport,
			observation.row,
			observation.cap,
			observation.control,
		]);
		stableFrames =
			observation.state === "content-observed"
				? geometry === previousGeometry
					? stableFrames + 1
					: 1
				: 0;
		previousGeometry = geometry;
		samples.push({ elapsedMs: clock.now() - start, ...observation });
		const done =
			samples.length >= MAX_SAMPLES || clock.now() - start >= MAX_SAMPLE_MS;
		// Retain EVERY observed frame, but do not stringify a growing panel on
		// every frame: the observer must not dominate the layout it measures.
		if (samples.length === 1 || samples.length % 12 === 0 || done) {
			publish({
				samples,
				done,
				stableFrames,
				firstContentIndex: samples.findIndex(
					(sample) => sample.state === "content-observed",
				),
			});
		}
		if (!done) pending = clock.request(tick);
	}
	pending = clock.request(tick);
	return () => {
		cancelled = true;
		clock.cancel(pending);
	};
}

/** Keep observations in memory, not AX: a full run can contain 1080 samples.
 * Publishing those as visible text stalls browser snapshots and hides controls.
 * The summary has fixed line/sequence bounds; download remains lossless. */
export function evidenceSummary(source, runs) {
	const firstRun =
		runs.find((run) =>
			run.samples?.some((sample) => sample.state === "content-observed"),
		) ?? runs[0];
	const initial = firstRun?.samples ?? [];
	const firstIndex = initial.findIndex(
		(sample) => sample.state === "content-observed",
	);
	const first = initial[firstIndex];
	const latest = runs.at(-1);
	const last = latest?.samples?.at(-1);
	const heights = [];
	for (const sample of initial) {
		if (sample.state !== "content-observed") continue;
		const value = `${Math.round(sample.elapsedMs)}ms:${sample.cap?.height ?? "none"}/${sample.maxHeight ?? "none"}`;
		const signature = `${sample.cap?.height}/${sample.maxHeight}`;
		if (signature !== heights.at(-1)?.signature && heights.length < 6)
			heights.push({ signature, value });
	}
	const lines = [
		`Source: ${source}`,
		`Runs: ${runs.length} (initial/first-content protected; six-run bound); latest scenario: ${latest?.scenario ?? "none"}`,
		`Viewport expected: ${JSON.stringify(latest?.expectedViewport ?? null)}; actual: ${JSON.stringify(last?.viewport ?? null)}; DOM window: ${JSON.stringify(last?.domWindow ?? null)}; setting=${last?.domWindowSetting ?? "default"}`,
		`First content: index=${firstIndex}, elapsed=${first?.elapsedMs ?? "none"}ms; cap height/max=${first?.cap?.height ?? "none"}/${first?.maxHeight ?? "none"}`,
		`Initial cap sequence (first six changes): ${heights.map((height) => height.value).join(", ") || "none observed"}`,
		`Latest: state=${last?.state ?? "pending"}; done=${latest?.done ?? false}; observed stable frames=${latest?.stableFrames ?? 0}`,
		`Last cap: ${JSON.stringify(last?.cap ?? null)}; max=${last?.maxHeight ?? "none"}; expanded=${last?.expanded ?? "none"}`,
		`Focus: ${JSON.stringify(last?.focused ?? null)}; selection length=${last?.selectionLength ?? 0}`,
		`Row: ${last?.recordId ?? "none"}; target: ${last?.targetRecord ?? "first user"}; session: ${last?.session ?? "none"}; locale/dir: ${last?.language ?? "?"}/${last?.direction ?? "?"}`,
		`Scroll (first three ancestors): ${JSON.stringify(last?.scrolls?.slice(0, 3) ?? [])}`,
		"Geometry observations only; full samples are available via Download full sample JSON.",
	];
	return lines.join("\n").slice(0, 2200);
}

export function evidenceBlob(source, runs) {
	return new Blob([JSON.stringify({ source, runs }, null, 2)], {
		type: "application/json",
	});
}

if (typeof document !== "undefined") {
	const frame = document.createElement("iframe");
	frame.title = "Real ChatPage fixture";
	frame.id = "chat-fixture";
	const scene = document.querySelector("#scene");
	const requested = new URLSearchParams(location.search).get("scene") ?? "long";
	scene.value = SCENES.includes(requested) ? requested : "long";
	let size = SIZES.narrow;
	let cancel = () => {};
	let retiredDocument = null;
	const source =
		typeof __SWITCH_PREVIEW_SOURCE__ === "string"
			? __SWITCH_PREVIEW_SOURCE__
			: "UNVERIFIED";
	const runs = [];
	function sample(reason = "manual") {
		cancel();
		const expected = [...size];
		const entry = { reason, scenario: scene.value, expectedViewport: expected };
		runs.push(entry);
		// Keep the initial navigation's early samples plus the latest five runs.
		// Resizing or focusing must not overwrite the first-content evidence.
		if (runs.length > 6) {
			const firstContentRun = runs.find((run) =>
				run.samples?.some((sample) => sample.state === "content-observed"),
			);
			const removable = runs.findIndex(
				(run, index) => index > 0 && run !== firstContentRun,
			);
			runs.splice(removable, 1);
		}
		cancel = startSamples(
			() =>
				frame.contentDocument === retiredDocument
					? { state: "navigating" }
					: readFrame(
							frame,
							expected,
							scene.value === "reopen" ? "abcdef000001-e87" : null,
						),
			(run) => {
				Object.assign(entry, run);
				document.querySelector("#evidence").textContent = evidenceSummary(
					source,
					runs,
				);
			},
			{
				now: () => performance.now(),
				request: (fn) => requestAnimationFrame(fn),
				cancel: (id) => cancelAnimationFrame(id),
			},
		);
	}
	function resize(next) {
		size = next;
		frame.width = String(size[0]);
		frame.height = String(size[1]);
		sample("viewport resize");
	}
	function remount() {
		// A slow navigation can keep the previous page alive for several frames.
		// Never mislabel its settled row as the new document's first content.
		retiredDocument = frame.contentDocument;
		sample("fixture navigation");
		frame.src = sceneUrl(scene.value);
	}
	document.querySelector("#surface").append(frame);
	document.querySelector("#narrow").onclick = () => resize(SIZES.narrow);
	document.querySelector("#wide").onclick = () => resize(SIZES.wide);
	document.querySelector("#sample").onclick = () => sample();
	document.querySelector("#reload").onclick = remount;
	scene.onchange = remount;
	let downloadUrl;
	const download = document.querySelector("#download-evidence");
	download.addEventListener("click", () => {
		// Build bytes only on an actual user/tool click, not every animation frame.
		if (downloadUrl) URL.revokeObjectURL(downloadUrl);
		downloadUrl = URL.createObjectURL(evidenceBlob(source, runs));
		download.href = downloadUrl;
		download.download = `session-switch-preview-${source.slice(0, 12)}-${Date.now()}.json`;
	});
	window.addEventListener(
		"pagehide",
		() => {
			cancel();
			if (downloadUrl) URL.revokeObjectURL(downloadUrl);
		},
		{ once: true },
	);
	// Observing actual input is not forwarding or synthesising it. Start before
	// the real handler runs so its next rendered geometry can be retained.
	frame.addEventListener("load", () => {
		const doc = frame.contentDocument;
		doc.addEventListener(
			"pointerdown",
			() => sample("real pointer input"),
			true,
		);
		doc.addEventListener("keydown", () => sample("real keyboard input"), true);
		doc.addEventListener("scroll", () => sample("real scroll"), {
			capture: true,
			passive: true,
		});
	});
	frame.width = String(size[0]);
	frame.height = String(size[1]);
	remount();
}
