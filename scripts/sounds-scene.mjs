import {
	SOUNDS_COUNT,
	SOUNDS_EMPTY_SESSION,
	SOUNDS_SESSION,
	SOUNDS_SINGLE_SESSION,
} from "./sounds-fixture.mjs";

/** Integrated seats, not a gallery. A synthetic journal is the input; the app's
 * reducer, attachment relay, shared element, decoder and graph are production. */
export async function sceneSounds({
	cdp,
	verb,
	capture,
	check,
	waitForCondition,
	factsOf,
}) {
	const facts = await factsOf(cdp);
	if (facts.windowMode !== "headless" || facts.visible || facts.focused)
		throw new Error("sounds requires an invisible headless app");
	/*
	 * THE SCENE READS ITS OWN `--backend`, the way `library-asset-scene.mjs`
	 * does: the Library seat probes the waveform route directly so a flat
	 * scrubber can be reported as the status/body it actually got, rather than
	 * silently accepted. The dev-driver passes only helpers to scene modules.
	 */
	const flag = (name) => {
		const at = process.argv.indexOf(name);
		if (at === -1) return null;
		const value = process.argv[at + 1];
		return value === undefined || value.startsWith("--") ? null : value;
	};
	const backend = flag("--backend");
	const token = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN ?? null;
	const hello = await verb(cdp, "hello");
	/*
	 * Opening another seeded session: the sidebar row is the app's own entry
	 * point (the same press the sounds seat uses), so the transcript swap is the
	 * production one.
	 */
	const openSession = async (sessionId) => {
		await verb(cdp, "navigate", "/chat");
		await waitFor(
			`Boolean(document.querySelector('[data-session-row="${sessionId}"]'))`,
		);
		await verb(cdp, "press", {
			selector: `[data-session-row="${sessionId}"] [data-chat-row]`,
		});
	};
	const demand = (label, value) => {
		if (!check(label, Boolean(value), JSON.stringify(value)))
			throw new Error(label);
	};
	const waitFor = async (expression, timeoutMs = 30000) => {
		const result = await waitForCondition(cdp, expression, timeoutMs);
		if (!result.ok) {
			console.log(
				"sounds DOM on failure",
				await cdp.evaluate("document.body.innerText.slice(-6000)"),
			);
			await capture(cdp, "sounds-failed-preflight");
		}
		demand(expression, result.ok);
	};
	await verb(cdp, "soundsArm");
	let refused = false;
	try {
		await verb(cdp, "soundsArm");
	} catch {
		refused = true;
	}
	demand("graph re-arm negative control refuses", refused);
	await verb(cdp, "navigate", "/chat");
	await waitFor(
		`Boolean(document.querySelector('[data-session-row="${SOUNDS_SESSION}"]'))`,
	);
	await verb(cdp, "press", {
		selector: `[data-session-row="${SOUNDS_SESSION}"] [data-chat-row]`,
	});
	await waitFor('Boolean(document.querySelector("[data-turn-summary]"))');
	/*
	 * THE REPORTED STATE, MEASURED BEFORE ANY PRESS: the run is condensed (its
	 * bar is the only visible row of the run) and the tool group under it is
	 * closed. The block must still paint ALL fourteen sounds there - the row's
	 * rule is that collapsing changes frame mounting, never media - and the
	 * collage is the fix for the wall the operator saw in exactly this shape.
	 */
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound]").length === ${SOUNDS_COUNT}`,
	);
	/*
	 * A player exists only once its digest resolves to bytes (the reserved
	 * placeholder is what a static render draws), so the collage's readiness is
	 * fourteen PLAYERS, not fourteen item boxes.
	 */
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound] [data-sound-player]").length === ${SOUNDS_COUNT}`,
	);
	const collage = await cdp.evaluate(`(() => {
		const items = [...document.querySelectorAll("[data-supplement-sound]")];
		const strip = document.querySelector("[data-supplement-sounds]");
		const lefts = new Set(items.map((item) => Math.round(item.getBoundingClientRect().left)));
		return {
			count: items.length,
			columns: lefts.size,
			players: items.filter((item) => item.querySelector("[data-sound-player]")).length,
			gridTemplateColumns: strip ? getComputedStyle(strip).gridTemplateColumns : null,
			scrollWidth: strip ? strip.scrollWidth : 0,
			clientWidth: strip ? strip.clientWidth : 0,
			// THE COLLAPSE ANCESTRY, as the DOM actually is: the tool call's
			// card (the artifact's generating/done surface) lives inside the
			// collapsed group, so it is not mounted; the durable highlights
			// strip is its sibling OUTSIDE the group and keeps the audio.
			cardMounted: Boolean(document.querySelector('[data-record-id="tool:sounds-call-1"]')),
			cardInsideSummary: Boolean(
				document
					.querySelector('[data-record-id="tool:sounds-call-1"]')
					?.closest("[data-turn-summary]"),
			),
			cardVisibleHeight:
				document
					.querySelector('[data-record-id="tool:sounds-call-1"]')
					?.getBoundingClientRect().height ?? 0,
			stripOutsideGroup: strip ? !strip.closest("[data-turn-summary]") : false,
		};
	})()`);
	console.log("sounds collage collapsed", JSON.stringify(collage));
	demand(
		"all fourteen sounds render, each with its own player, in the condensed run",
		collage.count === SOUNDS_COUNT && collage.players === SOUNDS_COUNT,
	);
	demand(
		"the collage is a multi-column grid that fits the block's width",
		collage.columns >= 2 && collage.scrollWidth <= collage.clientWidth + 1,
	);
	await capture(cdp, "sounds-collage-condensed-idle");
	/*
	 * THE FOURTEENTH, not the first: the retired three-sound cap made everything
	 * past the third unreachable, so a press on the last cell is the proof that
	 * the uncapped list is actionable rather than merely present in the DOM.
	 */
	await verb(cdp, "press", {
		selector:
			"[data-supplement-sounds] > [data-supplement-sound]:last-child [data-sound-player] button",
	});
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound]")[${SOUNDS_COUNT - 1}]?.querySelector('[data-sound-status="playing"]') !== null`,
	);
	await new Promise((resolve) => setTimeout(resolve, 800));
	console.log(
		"sounds collage playing facts",
		JSON.stringify(await verb(cdp, "soundsFacts")),
	);
	await capture(cdp, "sounds-collage-condensed-playing");
	await verb(cdp, "press", {
		selector:
			'[data-turn-summary][data-run-ids~="tool:sounds-call-1"] button[aria-expanded]',
	});
	await waitFor(
		"Boolean(document.querySelector('[data-record-id=\"tool:sounds-call-1\"] [data-sound-player] button'))",
	);
	await capture(cdp, "sounds-transcript-idle");
	/*
	 * SCOPED TO THE TRANSCRIPT'S OWN CARD. The highlights collage renders
	 * fourteen players BELOW it once the run's bar is expanded, so an unscoped
	 * `[data-sound-player]` is ambiguous - and the scrub verbs address the first
	 * match, which must be the playing row.
	 */
	/*
	 * OUTSIDE THE TURN SUMMARY. While the run is condensed the fold keeps a
	 * compact media slot inside the bar whose record id is the SAME record;
	 * after the bar is expanded both exist, and the slot's slider has no box
	 * (a 0px drag cannot cross the player's 4px click slop). The card's own
	 * player is the one not inside the summary, so every press and scrub below
	 * addresses that one.
	 */
	const cardPlayer =
		'[data-record-id="tool:sounds-call-1"]:not([data-turn-summary] *) [data-sound-player]';
	await verb(cdp, "press", { selector: `${cardPlayer} > button` });
	await waitFor(
		`document.querySelector('${cardPlayer}[data-sound-status="playing"]') !== null`,
	);
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const playing = await verb(cdp, "soundsFacts");
	console.log("sounds playing facts", JSON.stringify(playing));
	demand(
		"real decoder advances; zero-gain analyser stays silent",
		playing.time > 0.2 &&
			!playing.paused &&
			playing.gain === 0 &&
			playing.rms === 0 &&
			playing.inputRms > 0,
	);
	demand(
		"generated bytes use a digest blob, not the dead signed URL",
		playing.src.startsWith("blob:"),
	);
	await capture(cdp, "sounds-transcript-playing");
	console.log(
		"sounds scrub targets",
		JSON.stringify(
			await cdp.evaluate(`(() => {
				const sliders = [...document.querySelectorAll('${cardPlayer} [data-sound-slider]')];
				return sliders.map((slider) => {
					const rect = slider.getBoundingClientRect();
					return {
						width: rect.width,
						height: rect.height,
						status: slider.closest("[data-sound-player]")?.getAttribute("data-sound-status"),
					};
				});
			})()`),
		),
	);
	const scrub = await verb(cdp, "soundsScrub", {
		selector: `${cardPlayer} [data-sound-slider]`,
		fraction: 0.65,
	});
	console.log("sounds scrub result", JSON.stringify(scrub));
	demand(
		"pointer handlers enter scrubbing and commit position",
		scrub.during === "scrubbing",
	);
	await capture(cdp, "sounds-transcript-scrubbing");
	await verb(cdp, "soundsScrubFinish");
	await capture(cdp, "sounds-transcript-scrubbed");
	await verb(cdp, "soundsEnd");
	await waitFor(
		`document.querySelector('${cardPlayer}[data-sound-status="ended"]') !== null`,
	);
	await capture(cdp, "sounds-transcript-ended");

	await verb(cdp, "press", { selector: '[data-panel-rail-item="canvas"]' });
	await verb(cdp, "press", {
		selector: '[data-tour-tag="canvas-files-view-button"]',
	});
	await waitFor(
		"Boolean(document.querySelector('[data-tour-tag=\"file-row\"] [data-sound-player]'))",
	);
	await capture(cdp, "sounds-canvas-files");
	// Filename opens the indexed document; no path is injected by the rig.
	await verb(cdp, "press", {
		selector: '[data-tour-tag="file-row"] button.flex-1',
	});
	await waitFor(
		'Boolean(document.querySelector(".bg-sunken [data-sound-player]"))',
	);
	await capture(cdp, "sounds-canvas-preview");
	console.log(
		"sounds preview facts",
		JSON.stringify(await verb(cdp, "soundsFacts")),
	);
	await verb(cdp, "press", {
		selector: ".bg-sunken [data-sound-player] button",
	});
	const speech = await verb(cdp, "soundsSpeech");
	demand(
		"speech store supersedes preview/row on the same element",
		speech.ownerId === "speech:sounds-driver",
	);
	demand(
		"preview mounts no independent native audio",
		(await verb(cdp, "soundsFacts")).nativeElements === 0,
	);
	await capture(cdp, "sounds-speech-exclusive");
	await verb(cdp, "press", { selector: '[aria-label="Close canvas"]' });
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound]").length === ${SOUNDS_COUNT}`,
	);
	/*
	 * THE EXPANDED FORM OF THE SAME BLOCK, after the run's bar was expanded and
	 * the canvas pane closed: the same fourteen cells, in the same grid. The
	 * pair of frames is the brief's before/after - both forms identical media.
	 */
	const expanded = await cdp.evaluate(`(() => {
		const items = [...document.querySelectorAll("[data-supplement-sound]")];
		const lefts = new Set(items.map((item) => Math.round(item.getBoundingClientRect().left)));
		return { count: items.length, columns: lefts.size, players: items.filter((item) => item.querySelector("[data-sound-player]")).length };
	})()`);
	console.log("sounds collage expanded", JSON.stringify(expanded));
	demand(
		"the expanded run paints the same fourteen sounds and cells",
		expanded.count === SOUNDS_COUNT &&
			expanded.players === SOUNDS_COUNT &&
			expanded.columns === collage.columns,
	);
	demand(
		"expanding the run mounts the tool call's own card again",
		Boolean(
			await cdp.evaluate(
				"document.querySelector('[data-record-id=\"tool:sounds-call-1\"]') !== null",
			),
		),
	);
	await cdp.evaluate(
		'document.querySelector("[data-supplement-sound-title]").scrollIntoView({block:"center"})',
	);
	await capture(cdp, "sounds-highlights-collage");
	await verb(cdp, "press", {
		selector:
			"[data-supplement-sound-title] + div button, [data-supplement-sound-title] ~ [data-sound-player] button",
	});

	/* --------------------------------------------------------------------- *
	 * THE LIBRARY SEAT (operator follow-up, 2026-10-23).
	 *
	 * The Library grid is a second surface for the same sound: an audio card
	 * must carry the waveform player in place, a transport press must NOT
	 * select/navigate, an image card must mount no player, and the drawer must
	 * reuse the same player. The asset is the SAME 12 s PCM the session already
	 * produced - the fixture adds one picture to the turn for the negative
	 * control - registered by the daemon's own library scan, never by a route
	 * this rig invented.
	 * --------------------------------------------------------------------- */
	await verb(cdp, "navigate", "/library");
	await waitFor(
		'Boolean(document.querySelector("[data-library-card-id]"))',
		90000,
	);
	await waitFor(
		'Boolean(document.querySelector("[data-library-card-id] [data-library-audio-well] [data-sound-player]"))',
		90000,
	);
	const library = await cdp.evaluate(`(() => {
		const cards = [...document.querySelectorAll("[data-library-card-id]")];
		const audio = cards.find((card) => card.querySelector("[data-library-audio-well]")) ?? null;
		const others = cards.filter((card) => card !== audio);
		return {
			cards: cards.length,
			audioId: audio?.getAttribute("data-library-card-id") ?? null,
			audioPeaks: audio?.querySelector("[data-sound-player]")?.getAttribute("data-sound-peaks") ?? null,
			audioLabel: audio?.querySelector("[data-sound-player] button")?.getAttribute("aria-label") ?? null,
			audioHoriz: audio ? Math.round(audio.getBoundingClientRect().width) : 0,
			imageCards: others.length,
			imageSoundPlayers: others.reduce((total, card) => total + card.querySelectorAll("[data-sound-player]").length, 0),
			href: location.href,
			preview: Boolean(document.querySelector("[data-library-preview]")),
		};
	})()`);
	console.log("sounds library grid", JSON.stringify(library));
	demand(
		"the Library grid carries the audio card with the shared player",
		Boolean(library.audioId),
	);
	demand(
		"the audio card's player is the compact variant",
		String(library.audioLabel).startsWith("Play "),
	);
	demand(
		"an image card in the same grid mounts no sound player",
		library.imageCards >= 1 && library.imageSoundPlayers === 0,
	);
	if (backend && token) {
		const response = await fetch(
			`${backend}/v1/desktop/library/assets/${library.audioId}/waveform`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		const text = await response.text();
		let bars = null;
		let peaks = null;
		try {
			const body = JSON.parse(text);
			bars = typeof body?.bars === "number" ? body.bars : null;
			peaks = Array.isArray(body?.peaks) ? body.peaks.length : null;
		} catch {
			/* a non-JSON refusal is reported below, never interpreted */
		}
		console.log(
			`sounds library waveform HTTP ${response.status} bars=${bars} peaks=${peaks} body=${text.slice(0, 120)}`,
		);
		demand(
			"the seeded asset's library.waveform route serves the sidecar",
			response.status === 200 && (peaks ?? 0) > 0,
		);
		demand(
			"the card draws the stored peaks the route served",
			library.audioPeaks === "stored",
		);
	} else {
		console.log("sounds library waveform probe skipped: no --backend/token");
	}
	await capture(cdp, "sounds-library-idle");
	/*
	 * THE PRESS THAT MUST NOT SELECT. `onSelect` navigates to
	 * `/library/assets/:id` and mounts `[data-library-preview]`; both are read
	 * before/after the transport press, so "it started playing" cannot pass for
	 * "it did not open".
	 */
	const before = await cdp.evaluate(
		'({ href: location.href, preview: Boolean(document.querySelector("[data-library-preview]")) })',
	);
	await verb(cdp, "press", {
		selector: `[data-library-card-id="${library.audioId}"] [data-sound-player] > button`,
	});
	await waitFor(
		`document.querySelector('[data-library-card-id="${library.audioId}"] [data-sound-player][data-sound-status="playing"]') !== null`,
	);
	await new Promise((resolve) => setTimeout(resolve, 900));
	const playingCard = await cdp.evaluate(`(() => {
		const card = document.querySelector('[data-library-card-id="${library.audioId}"]');
		const player = card?.querySelector("[data-sound-player]");
		const slider = card?.querySelector("[data-sound-slider]");
		const box = slider?.firstElementChild;
		return {
			status: player?.getAttribute("data-sound-status") ?? null,
			progress: box ? getComputedStyle(box).getPropertyValue("--sound-progress").trim() : null,
			time: card?.querySelector("[data-sound-time]")?.textContent ?? null,
			href: location.href,
			preview: Boolean(document.querySelector("[data-library-preview]")),
		};
	})()`);
	console.log("sounds library playing", JSON.stringify(playingCard));
	demand(
		"the Library card plays in place with waveform progress",
		playingCard.status === "playing" &&
			Number.parseFloat(playingCard.progress ?? "0") > 0,
	);
	demand(
		"the waveform well does not navigate: no selection, no preview",
		playingCard.href === before.href && !before.preview && !playingCard.preview,
	);
	await capture(cdp, "sounds-library-playing");
	/* The title area is the select control, and the drawer reuses the player. */
	await verb(cdp, "press", {
		selector: `[data-library-card-id="${library.audioId}"] > button`,
	});
	await waitFor(
		`Boolean(document.querySelector('[data-library-preview="${library.audioId}"] [data-sound-player="full"]'))`,
	);
	const drawer = await cdp.evaluate(
		`({ native: document.querySelectorAll('[data-library-preview] audio').length, players: document.querySelectorAll('[data-library-preview] [data-sound-player="full"]').length })`,
	);
	console.log("sounds library drawer", JSON.stringify(drawer));
	demand(
		"the drawer mounts the shared full player and no native audio",
		drawer.players === 1 && drawer.native === 0,
	);
	await capture(cdp, "sounds-library-drawer");

	/* --------------------------------------------------------------------- *
	 * THE SINGLE-SOUND, LONG-TITLE, NARROW AND EMPTY ARMS.
	 * --------------------------------------------------------------------- */
	await openSession(SOUNDS_SINGLE_SESSION);
	await waitFor(
		'document.querySelectorAll("[data-supplement-sound]").length === 1',
	);
	await waitFor(
		'document.querySelectorAll("[data-supplement-sound] [data-sound-player]").length === 1',
	);
	const single = await cdp.evaluate(`(() => {
		const section = document.querySelector("[data-supplement-sounds]");
		const item = document.querySelector("[data-supplement-sound]");
		return {
			count: document.querySelectorAll("[data-supplement-sound]").length,
			players: document.querySelectorAll("[data-supplement-sound] [data-sound-player]").length,
			display: section ? getComputedStyle(section).display : null,
			columns: section ? getComputedStyle(section).gridTemplateColumns : null,
			title: item?.querySelector("[data-supplement-sound-title]")?.textContent ?? null,
			cardMounted: Boolean(document.querySelector('[data-record-id="tool:single-call-1"]')),
		};
	})()`);
	console.log("sounds single collage", JSON.stringify(single));
	demand(
		"a single sound keeps the full-width row, one cell and one player",
		single.count === 1 &&
			single.players === 1 &&
			single.display === "flex" &&
			single.columns === "none",
	);
	await cdp.evaluate(
		'document.querySelector("[data-supplement-sound-title]")?.scrollIntoView({block:"center"})',
	);
	await capture(cdp, "sounds-collage-single");

	await openSession(SOUNDS_EMPTY_SESSION);
	await waitFor('document.body.innerText.includes("No artifacts came out.")');
	await new Promise((resolve) => setTimeout(resolve, 600));
	const empty = await cdp.evaluate(
		`({ supplements: document.querySelectorAll("[data-supplement-record]").length, sections: document.querySelectorAll("[data-supplement-sounds]").length, sounds: document.querySelectorAll("[data-supplement-sound]").length, players: document.querySelectorAll("[data-sound-player]").length })`,
	);
	console.log("sounds empty collage", JSON.stringify(empty));
	demand(
		"a soundless supplement row paints nothing at all",
		empty.supplements === 0 && empty.sections === 0 && empty.sounds === 0,
	);
	await capture(cdp, "sounds-collage-empty");

	/* The long title, then the narrow viewport, both on the fourteen-sound row. */
	await openSession(SOUNDS_SESSION);
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound]").length === ${SOUNDS_COUNT}`,
	);
	/*
	 * PLAYERS, NOT JUST CELLS. A re-mounted session paints the cells before
	 * their digests resolve (the reserved line), and the first attempt at this
	 * frame caught exactly that: fourteen titles with no waveform. The frame is
	 * the design gate's, so it waits for the resolved state.
	 */
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound] [data-sound-player]").length === ${SOUNDS_COUNT}`,
	);
	const longTitle = await cdp.evaluate(`(() => {
		const item = [...document.querySelectorAll("[data-supplement-sound]")].find(
			(node) => node.querySelector("[data-supplement-sound-title]")?.getAttribute("title")?.includes("deliberately long"),
		);
		const title = item?.querySelector("[data-supplement-sound-title]");
		title?.scrollIntoView({ block: "center" });
		const rect = item?.getBoundingClientRect();
		return {
			found: Boolean(item),
			clientWidth: title?.clientWidth ?? 0,
			scrollWidth: title?.scrollWidth ?? 0,
			cellWidth: rect ? Math.round(rect.width) : 0,
		};
	})()`);
	console.log("sounds long title", JSON.stringify(longTitle));
	demand(
		"one cell carries a long title and truncates it",
		longTitle.found &&
			longTitle.scrollWidth > longTitle.clientWidth &&
			longTitle.cellWidth > 0,
	);
	await capture(cdp, "sounds-collage-long-title");

	/*
	 * THE NARROW VIEWPORT, through CDP's own emulation (the rig's documented
	 * resize path): the grid must answer the BLOCK's width with ONE column,
	 * not the viewport's with three.
	 */
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 620,
		height: 900,
		deviceScaleFactor: hello.viewport.devicePixelRatio ?? 1,
		mobile: false,
	});
	await new Promise((resolve) => setTimeout(resolve, 700));
	const narrow = await cdp.evaluate(`(() => {
		const items = [...document.querySelectorAll("[data-supplement-sound]")];
		const lefts = new Set(items.map((item) => Math.round(item.getBoundingClientRect().left)));
		const section = document.querySelector("[data-supplement-sounds]");
		return {
			count: items.length,
			columns: lefts.size,
			width: section ? Math.round(section.getBoundingClientRect().width) : 0,
			scrollWidth: section ? section.scrollWidth : 0,
			clientWidth: section ? section.clientWidth : 0,
		};
	})()`);
	console.log("sounds collage narrow", JSON.stringify(narrow));
	demand(
		"at a narrow width the collage falls to one column with no overflow",
		narrow.count === SOUNDS_COUNT &&
			narrow.columns === 1 &&
			narrow.scrollWidth <= narrow.clientWidth + 1,
	);
	await cdp.evaluate(
		'document.querySelector("[data-supplement-sounds]")?.scrollIntoView({block:"center"})',
	);
	await capture(cdp, "sounds-collage-narrow");
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: hello.viewport.width,
		height: hello.viewport.height,
		deviceScaleFactor: hello.viewport.devicePixelRatio ?? 1,
		mobile: false,
	});
}
