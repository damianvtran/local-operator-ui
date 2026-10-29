/* ------------------------------------------------------------------------- *
 * `library-asset`: the Library details panel's conversation line, against a
 * live daemon.
 *
 * WHY A SCENE. The Stories set photographs the panel from a stubbed bridge, so
 * `occurrences[0].session_title` arrives as whatever the story typed. The
 * reported defect lived in the HARNESS: the index published the transcript's
 * opening user message in that field, so every real backend put a long first
 * message where the conversation's generated name belonged. Only a payload from
 * a daemon over a seeded store can show which string wins, and only the real app
 * can show that the panel renders it.
 *
 * WHY THIS MODULE. `scripts/renderer-driver.mjs` sits 131 bytes under Biome's
 * 2 MiB single-file ceiling, so this scene joins the agent-messages and sounds
 * scenes in its own module rather than pushing the driver over. The driver
 * passes its helpers in, so the scene runs on the same checks, waits and
 * captures as every inline scene.
 *
 * THE THREE SURFACES ARE READ INDEPENDENTLY, which is what makes the scene
 * reusable rather than a photograph of one seed: the title SIDECAR on disk
 * (`title.json`, written by `resume.write_session_title`, the naming process's
 * own writer), the daemon's own payloads (`library.list`, `library.get`), and
 * the DOM. The scene knows no fixture strings - it derives the opening message
 * from the transcript under the config root `--backend-records` names - so the
 * same bytes assert BOTH arms: on the fixed backend the line must read
 * `From <stored title>`; on the base backend the stored-title and
 * opening-absence checks fail with the opening line in the message.
 *
 * WHAT IT CANNOT PROVE: that the naming process RAN. The sidecar is seeded by
 * the harness's own writer with `user_set=False`, which proves the stored-title
 * path and nothing about the model call that would have produced the name.
 *
 * Needs `--backend` and `--backend-records` for a daemon this run owns, and
 * `--asset <id>` when the listing holds more than one asset:
 *
 *   node scripts/renderer-driver.mjs --scene library-asset \
 *     --backend http://127.0.0.1:18234 --backend-records <config>/run/serve \
 *     --seed-onboarding-complete --out <dir>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export async function sceneLibraryAsset({
	cdp,
	verb,
	capture,
	check,
	note,
	waitForCondition,
	factsOf,
}) {
	/*
	 * THE SCENE READS ITS OWN FLAGS. `scripts/renderer-driver.mjs` sits under
	 * Biome's 2 MiB single-file ceiling, so its dispatch passes only the helpers
	 * and every flag is read here, from the same argv the driver parsed. That is
	 * also why this scene is a module at all.
	 */
	const flag = (name) => {
		const at = process.argv.indexOf(name);
		if (at === -1) return null;
		const value = process.argv[at + 1];
		return value === undefined || value.startsWith("--") ? null : value;
	};
	const backend = flag("--backend");
	const backendRecords = flag("--backend-records");
	const assetId = flag("--asset");
	if (backend === null) {
		throw new Error(
			"--scene library-asset needs --backend: the conversation line it photographs is the daemon's own answer (library.list/library.get), and with no backend the Library route is not even mounted",
		);
	}
	if (backendRecords === null) {
		throw new Error(
			"--scene library-asset needs --backend-records <dir>: it reads the seeded title sidecar and transcript under that daemon's config root (the dir's ../..) and checks the payload against them",
		);
	}
	const hello = await verb(cdp, "hello");
	const framesDir = hello.outDir;
	const size = `${hello.viewport.width}x${hello.viewport.height}`;
	const facts = await factsOf(cdp);
	check(
		"window mode is headless and the window is never shown or focused",
		facts.windowMode === "headless" &&
			facts.visible === false &&
			facts.focused === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const token = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
	const request = async (path) => {
		const response = await fetch(`${backend}${path}`, {
			headers: { authorization: `Bearer ${token}` },
		});
		const body = await response.json().catch(() => null);
		return { status: response.status, body };
	};

	/*
	 * THE THREE SURFACES ARE READ INDEPENDENTLY, which is what makes this scene
	 * reusable rather than a photograph of one seed: the title SIDECAR on disk
	 * (what the naming process wrote), the daemon's own payload (what the API
	 * publishes), and the DOM (what the panel shows). The scene knows no fixture
	 * strings - it derives the opening message from the transcript it finds under
	 * the config root `--backend-records` names, so it needs no `--opening` flag
	 * and cannot pass by agreeing with a constant somebody typed twice.
	 */
	const listing = await request("/v1/desktop/library/assets");
	const rows = listing.body?.result?.rows;
	check(
		"the run's own daemon answers the Library listing",
		listing.status === 200 && Array.isArray(rows),
		`status=${listing.status} body=${JSON.stringify(listing.body).slice(0, 300)}`,
		`status=200 total=${listing.body?.result?.total} rows=${rows?.length}`,
	);
	if (!Array.isArray(rows)) {
		throw new Error(
			"--scene library-asset needs --backend pointing at an isolated daemon this run owns; the Library listing did not answer with rows, so there is nothing to open",
		);
	}
	const candidates =
		assetId === null ? rows : rows.filter((row) => row.id === assetId);
	check(
		assetId === null
			? "the listing holds exactly one seeded asset (so the subject is not guessed)"
			: `the listing holds the asset --asset named (${assetId})`,
		candidates.length === 1,
		`${rows.length} rows (${rows.map((row) => row.id).join(", ")}); pass --asset <id> when the rig seeds more than one`,
		`subject=${candidates[0]?.id} of ${rows.length}`,
	);
	if (candidates.length !== 1) {
		throw new Error(
			`--scene library-asset could not choose its subject: ${rows.length} assets in the listing. Seed one, or name it with --asset <id>.`,
		);
	}
	const asset = candidates[0];
	const occurrence = asset.occurrences?.[0] ?? {};
	const sessionId = occurrence.session_id;
	if (typeof sessionId !== "string" || sessionId.length === 0) {
		throw new Error(
			`the asset ${asset.id} carries no occurrence, so it has no conversation for this scene to read`,
		);
	}

	const configRoot = resolve(backendRecords, "..", "..");
	const sessionDir = join(configRoot, "sessions", sessionId);
	const sidecar = JSON.parse(
		readFileSync(join(sessionDir, "title.json"), "utf8"),
	);
	check(
		"the session's title sidecar is a GENERATED name (user_set false), not an opening line",
		typeof sidecar.text === "string" &&
			sidecar.text.length > 0 &&
			sidecar.user_set === false,
		`title.json in ${sessionDir} did not hold a generated title: ${JSON.stringify(sidecar)}`,
		`${JSON.stringify(sidecar.text)} user_set=${sidecar.user_set}`,
	);

	const opening = (() => {
		for (const line of readFileSync(
			join(sessionDir, "transcript.jsonl"),
			"utf8",
		).split("\n")) {
			if (line.trim() === "") continue;
			const row = JSON.parse(line);
			if (row?.payload?.role !== "user") continue;
			const text = (row.payload.content ?? []).find(
				(block) => typeof block?.text === "string",
			)?.text;
			if (typeof text === "string" && text.trim() !== "") {
				return text.replace(/\s+/g, " ").trim();
			}
		}
		return "";
	})();
	/*
	 * The probe is a slice of the OPENING MESSAGE, not a fixture constant: any
	 * occurrence the panel renders from the transcript's first user row repeats
	 * it, and the panel's line is clamped to two lines, so the head is the part a
	 * reader would see.
	 */
	const openingProbe = opening.slice(0, 60);
	check(
		"the transcript's opening message and the stored title are different strings",
		opening.length > 20 &&
			!opening.includes(sidecar.text) &&
			openingProbe !== sidecar.text.slice(0, 60),
		`opening=${JSON.stringify(opening.slice(0, 80))} title=${JSON.stringify(sidecar.text)}`,
		`opening ${opening.length} chars, title ${sidecar.text.length} chars`,
	);

	/*
	 * THE API HALF: the payload the panel renders. Checked against the SIDECAR
	 * because that is the stored name the fix is about - an assertion against a
	 * fixture string would pass on a backend that happened to return it.
	 */
	check(
		"library.list's occurrence carries the STORED title, not the opening message",
		occurrence.session_title === sidecar.text,
		`occurrences[0].session_title=${JSON.stringify(occurrence.session_title)}; title.json=${JSON.stringify(sidecar.text)}`,
		`occurrences[0].session_title=${JSON.stringify(occurrence.session_title)}`,
	);
	const detail = await request(
		`/v1/desktop/library/assets/${encodeURIComponent(asset.id)}`,
	);
	const detailOccurrence = detail.body?.result?.occurrences?.[0] ?? {};
	check(
		"library.get agrees with the listing on the same stored title",
		detail.status === 200 && detailOccurrence.session_title === sidecar.text,
		`status=${detail.status} occurrences[0].session_title=${JSON.stringify(detailOccurrence.session_title)}; title.json=${JSON.stringify(sidecar.text)}`,
		`status=200 occurrences[0].session_title=${JSON.stringify(detailOccurrence.session_title)}`,
	);

	await verb(cdp, "navigate", `/library/assets/${asset.id}`);
	const mounted = await waitForCondition(
		cdp,
		`Boolean(document.querySelector('[data-library-preview="${asset.id}"]'))`,
		30_000,
	);
	check(
		"the asset's own route mounts its preview in the real app",
		mounted.ok,
		`no [data-library-preview="${asset.id}"] after ${mounted.waitedMs}ms; check the backend is up and the renderer was built with this run's URL`,
		`mounted after ${mounted.waitedMs}ms`,
	);
	const readings = [];
	for (const theme of ["localOperatorDark", "localOperatorLight"]) {
		await verb(cdp, "setTheme", theme);
		const themeId = theme
			.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
			.replace(/^-/, "");
		const line = await cdp.evaluate(`(() => {
			const preview = document.querySelector('[data-library-preview="${asset.id}"]');
			if (!preview) return null;
			const button = [...preview.querySelectorAll("button[title]")].find((candidate) =>
				(candidate.getAttribute("title") ?? "").startsWith("From "),
			);
			return {
				text: button ? button.textContent.replace(/\\s+/g, " ").trim() : null,
				title: button ? button.getAttribute("title") : null,
				preview: preview.textContent.replace(/\\s+/g, " ").trim().slice(0, 500),
			};
		})()`);
		readings.push({ theme, ...(line ?? {}) });
		check(
			`the conversation line reads "From ${sidecar.text}" (${theme})`,
			line?.text === `From ${sidecar.text}`,
			`the line read ${JSON.stringify(line?.text)}; the stored title is ${JSON.stringify(sidecar.text)}`,
			JSON.stringify(line?.text),
		);
		check(
			`the conversation line does NOT repeat the opening message (${theme})`,
			typeof line?.text === "string" &&
				!line.text.includes(openingProbe) &&
				!String(line?.preview).includes(openingProbe),
			`the preview carried the opening message's first ${openingProbe.length} chars: ${JSON.stringify(openingProbe)}`,
			`no ${JSON.stringify(openingProbe.slice(0, 24))}… in the line or the preview`,
		);
		await capture(cdp, `library-asset-${size}-${themeId}-panel`);
	}

	/*
	 * THE RUN WRITES ITS OWN RESPONSE EXCERPT next to the frames, so a reader can
	 * check the assertion against the payload rather than against this comment.
	 * No bearer: the token is in this process's environment and never in argv or
	 * in a committed file.
	 */
	const evidence = {
		backend: backend,
		request: "/v1/desktop/library/assets",
		status: listing.status,
		asset_id: asset.id,
		session_id: sessionId,
		listing_occurrence: occurrence,
		detail_occurrence: detailOccurrence,
		title_sidecar: sidecar,
		opening_message: opening,
		opening_probe: openingProbe,
		dom: readings,
	};
	writeFileSync(
		join(framesDir, "library-panel.json"),
		`${JSON.stringify(evidence, null, 1)}\n`,
	);
	note("response excerpt", JSON.stringify(evidence.listing_occurrence));
	note(
		"frames dir",
		`${framesDir} (library-panel.json is this run's payload excerpt)`,
	);
}
