import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The release notes the server offer shows, contract-checked against the shipped
 * TypeScript.
 *
 * WHY THIS FILE EXISTS. The "Server update available" panel named two versions
 * and a benefit sentence and nothing about what changed - the one update card in
 * the app with no notes on it - and the fix has three parts that can each fail
 * quietly: a summary rule over GitHub's markdown (it can drop the wrong block,
 * eat an identifier's underscores, or cut a word in half), a cache whose whole
 * purpose is that a machine spends ONE request per version on an endpoint
 * bounded at 60 an hour (a cache that never hits is a rate-limit bug, and a cache
 * that never expires is an entry that outlives the release it describes), and a
 * lookup that runs inside the check a reader is waiting on, so every failure has
 * to come back as "no notes" rather than as a thrown error that costs them the
 * offer itself.
 *
 * The transport is a REAL loopback server this process owns - not a stubbed
 * `get` - because the arms worth pinning (a 404, a body that is not JSON, a
 * connection that never answers, one that refuses) are properties of the request
 * path, and a fake transport would assert only that the fake was called. The
 * module is bundled in memory from `src/main/server-release-notes.ts`, the way
 * `update-global-install.test.mjs` bundles its own, so this stays a test of the
 * code that ships.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/server-release-notes";',
			/*
			 * The renderer's half of the same feature, bundled here because it is a
			 * pure function precisely so it can be: the comparison used to live
			 * inline in the panel's JSX, where deleting it left every suite green
			 * (review round 3 measured exactly that) and where no test here can
			 * reach it - the component needs a DOM this suite does not build.
			 */
			'export * from "./src/renderer/src/shared/utils/server-release-notes";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const notes = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);
const {
	CACHE_LIMIT,
	RELEASE_NOTES_CACHE_FILE,
	SUMMARY_LIMIT,
	cachedReleaseNotes,
	fetchServerReleaseNotes,
	notesForOffer,
	parseReleaseResponse,
	readReleaseNotesCache,
	releaseNotesCachePath,
	releasePageUrl,
	releaseTag,
	rememberReleaseNotes,
	summariseReleaseBody,
	writeReleaseNotesCache,
} = notes;

const roots = [];
const servers = [];

/** A temp userData root, realpath-free on purpose: nothing here compares paths. */
function tempRoot(name) {
	const dir = mkdtempSync(join(tmpdir(), `lo-notes-${name}-`));
	roots.push(dir);
	return dir;
}

/**
 * A loopback endpoint that counts what reached it.
 *
 * The count is the point of half these cases: "the second lookup made no
 * request" is the rate-limit property, and it cannot be seen from the answer
 * alone - a cache that hit and a cache that missed produce the same notes.
 */
async function api(handler) {
	const state = { requests: 0 };
	const server = createServer((request, response) => {
		state.requests += 1;
		handler(request, response);
	});
	servers.push(server);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { origin: `http://127.0.0.1:${server.address().port}`, state };
}

/** The GitHub release payload, as the endpoint actually spells it. */
const releasePayload = (overrides = {}) =>
	JSON.stringify({
		tag_name: "v0.62.34",
		name: "0.62.34: the stall watchdog can no longer wedge the session it watches",
		/*
		 * DELIBERATELY NOT the URL `releasePageUrl` builds for this version. The
		 * module prefers the release's own `html_url` because that address survives
		 * a repository rename, and a fixture whose two URLs are the same string
		 * cannot tell "preferred GitHub's" from "always built one" - the test that
		 * names the preference passed under a mutation that deleted it.
		 */
		html_url:
			"https://github.com/damianvtran/local-operator-renamed/releases/tag/v0.62.34",
		body: "0.62.34 fixes the stall watchdog wedging the very session it existed to watch.",
		...overrides,
	});

after(() => {
	for (const server of servers) server.close();
	for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The tag and the page
// ---------------------------------------------------------------------------

test("a version becomes the tag it is published under, either spelling", () => {
	assert.equal(releaseTag("0.62.34"), "v0.62.34");
	assert.equal(releaseTag("v0.62.34"), "v0.62.34");
	assert.equal(releaseTag("  0.62.34  "), "v0.62.34");
	assert.equal(releaseTag(""), "");
	assert.equal(releaseTag(null), "");
});

test("the fallback page URL is the release tag's own", () => {
	assert.equal(
		releasePageUrl("0.62.34"),
		"https://github.com/damianvtran/local-operator/releases/tag/v0.62.34",
	);
});

// ---------------------------------------------------------------------------
// The summary rule
// ---------------------------------------------------------------------------

test("the house style that opens with a version heading leads with the paragraph under it", () => {
	const body = [
		"## v0.62.33",
		"",
		"Seven PRs in this window, and the theme is things that were quietly going wrong.",
		"",
		"## Minor",
		"",
		"- **A dropped message is dropped no more** (#1500)",
	].join("\n");
	assert.equal(
		summariseReleaseBody(body),
		"Seven PRs in this window, and the theme is things that were quietly going wrong.",
	);
});

test("the house style that opens with the sentence leads with that sentence", () => {
	assert.equal(
		summariseReleaseBody(
			"0.62.34 fixes the stall watchdog wedging the very session it existed to watch.\n\n## Fixes\n\n- something",
		),
		"0.62.34 fixes the stall watchdog wedging the very session it existed to watch.",
	);
});

/**
 * The same rule, over the REAL release the story's frame is built from.
 *
 * `BackendUpdateWithReleaseNotes` in `update-notification.stories.tsx` carries
 * this sentence as its `releaseNotes.summary`, and it cannot import a
 * main-process module to derive it - so the literal there and the rule here are
 * two files that have to agree, and this is the case that makes a disagreement
 * fail a suite rather than reach a committed frame. What is quoted is the
 * published v0.62.34 body verbatim through its first section heading, which is
 * every block the summary rule reads: its opening paragraph, the blank line, and
 * the `## Fixes` heading the lead has to step over.
 */
test("the operator's own release summarises to the sentence the frame carries", () => {
	const published = [
		"0.62.34 fixes the stall watchdog wedging the very session it existed to watch.",
		"",
		"## Fixes",
		"",
		"- **The stall watchdog can no longer park the event loop holding the GIL** (#1517) - the bound's fire now runs in Python.",
	].join("\n");
	assert.equal(
		summariseReleaseBody(published),
		"0.62.34 fixes the stall watchdog wedging the very session it existed to watch.",
	);
});

/**
 * And the TRUNCATED state's fixture, over the real body it was taken from.
 *
 * `BackendUpdateWithLongReleaseNotes` carries this string, and it exists so the
 * cut, the height it occupies and the card's behaviour at the app's 572px floor
 * are photographed rather than argued. The paragraph quoted is the published
 * v0.62.33 body's opening one, verbatim through the first section heading.
 */
test("the release the long-summary frame uses summarises to the string it carries", () => {
	const published = [
		"## v0.62.33",
		"",
		'Seven PRs in this window, and the theme is things that were quietly going wrong. A message sent while a job-result delivery turn holds the session lock is no longer silently dropped — the loss class where the sender got a `503` and a same-id retry was answered "already admitted" with nothing written. A bash or eval call that would print a registered secret value is refused before it runs. A foreground `bash` call dominated by a long `sleep` is refused with the advice to background it.',
		"",
		"## Minor",
	].join("\n");
	const summary = summariseReleaseBody(published);
	assert.equal(summary.length, 391);
	assert.ok(summary.endsWith("..."));
	/*
	 * THE SEAM IS PART OF THE FIXTURE. The word boundary used to land on the
	 * article that opens the next sentence, so the card read "...before it runs.
	 * A..." - a quote that looked like a sentence which stopped, with the link on
	 * the same line. The dangling word goes, and the stop it left behind goes with
	 * it so the marker is not doubled.
	 */
	assert.ok(!summary.includes(" A..."), "a dangling article survived the cut");
	assert.ok(!summary.includes("...."), "the cut doubled a sentence stop");
	assert.equal(
		summary,
		'Seven PRs in this window, and the theme is things that were quietly going wrong. A message sent while a job-result delivery turn holds the session lock is no longer silently dropped — the loss class where the sender got a 503 and a same-id retry was answered "already admitted" with nothing written. A bash or eval call that would print a registered secret value is refused before it runs...',
	);
});

test("a soft-wrapped paragraph is put back into one run of text", () => {
	assert.equal(
		summariseReleaseBody(
			"One sentence that GitHub\nwraps across two lines\nin the stored body.",
		),
		"One sentence that GitHub wraps across two lines in the stored body.",
	);
});

test("markup unwraps to the words, and identifiers keep their underscores", () => {
	const body =
		"A shell variable like `LOP_RUNTIME_ADOPT_SESSION` and a **bold** claim, an [issue link](https://example.test/1) and an ![image](https://example.test/2.png), all in one paragraph.";
	assert.equal(
		summariseReleaseBody(body),
		"A shell variable like LOP_RUNTIME_ADOPT_SESSION and a bold claim, an issue link and an image, all in one paragraph.",
	);
});

/*
 * THE ONE THAT GOT THROUGH, and the reason emphasis is a single tolerant pass.
 *
 * A bold run containing an italic one cannot be matched by `\*\*([^*]+)\*\*`,
 * because the inner stars are not allowed inside the group - so the italic pass
 * that followed paired the WRONG stars and the card rendered the sentence with
 * stray `*` in it. This is the shape from the published v0.62.4 body, and the
 * sentence is quoted from it.
 */
test("emphasis nested inside emphasis unwraps without leaving stray stars", () => {
	const body =
		"- **A runtime whose event loop is *executing* is no longer ended by its own stall bound.** The bound's liveness leg gains a second observation.";
	assert.equal(
		summariseReleaseBody(body),
		"A runtime whose event loop is executing is no longer ended by its own stall bound. The bound's liveness leg gains a second observation.",
	);
	assert.ok(!summariseReleaseBody(body).includes("*"));
});

test("a bold run with a nested italic and a tail keeps both sets of words", () => {
	assert.equal(
		summariseReleaseBody("**bold with *inner* emphasis** tail"),
		"bold with inner emphasis tail",
	);
});

/*
 * A LONE STAR IS NOT HALF OF A BOLD RUN. Without the lookarounds on the
 * emphasis pattern, the single-star arm paired this text's literal `*` with the
 * first star of `**bold**`, and the summary came out `a stray star and bold*` -
 * a character MOVED rather than removed, which is worse than the noise it was
 * trying to clear.
 */
test("a literal star beside a bold run keeps its place", () => {
	assert.equal(
		summariseReleaseBody("a stray * star and **bold**"),
		"a stray * star and bold",
	);
});

/*
 * AND A STAR INSIDE A CODE SPAN IS TEXT, not markup. Both directions were wrong
 * once: unwrapping the span before the emphasis pass let it eat the globs, and
 * splitting the text on spans instead left `**` stranded around a run that spans
 * one. The mask is what satisfies both.
 */
test("stars inside code spans survive, and a bold run may span one", () => {
	assert.equal(
		summariseReleaseBody("the glob `*.ts` matches, as does `*.md` here"),
		"the glob *.ts matches, as does *.md here",
	);
	assert.equal(
		summariseReleaseBody("**The `foo` flag is gone** today"),
		"The foo flag is gone today",
	);
	assert.equal(
		summariseReleaseBody("values.classification.* is a wildcard"),
		"values.classification.* is a wildcard",
	);
});

/*
 * A CUT INSIDE A MARKUP RUN LEAVES ITS DELIMITERS BEHIND, which ten of the 300
 * published releases would have shown: a lead that is one long bold run has no
 * closing `**` inside the budget, so the card read `**A shell command that
 * wr...`. An unpaired run at either edge of the cut goes with the cut.
 */
test("a cut that lands inside a bold run does not leave the delimiters", () => {
	const body = `**${"A shell command that writes files ".repeat(20)}**`;
	const summary = summariseReleaseBody(body);
	assert.ok(!summary.includes("*"), summary.slice(0, 60));
	assert.ok(summary.endsWith("..."));
});

/*
 * The house style that opens a window with its PR headlines, from the published
 * v0.62.36 body: the machine row comes first and the prose that describes the
 * release is the block under it. A reader offered an update is owed the prose.
 */
test("a PR headline block is stepped over for the prose that follows it", () => {
	const body = [
		"## v0.62.36",
		"",
		"### What's in this window",
		"",
		"**#1477 — fix(mobile): rank the phone's session list on the shared catalog key, with shared pins (merge 3195481f6)**",
		"",
		"The phone's session list now ranks on the shared catalogue key, so a pinned conversation sorts where the desktop puts it.",
	].join("\n");
	assert.equal(
		summariseReleaseBody(body),
		"The phone's session list now ranks on the shared catalogue key, so a pinned conversation sorts where the desktop puts it.",
	);
});

test("a merge citation alone is a machine row too", () => {
	/*
	 * THE CITATION CARRIES THE CASE, and the body is spelled so the headline arm
	 * cannot claim it: a test whose two arms are both satisfied by the first one
	 * cannot tell the second from deleted, which is what a mutation run found
	 * here.
	 */
	assert.equal(
		summariseReleaseBody(
			"fix(mobile): rank the session list (merge 3195481f6)\n\nWhat the release actually does.",
		),
		"What the release actually does.",
	);
	assert.equal(
		summariseReleaseBody("**#1477 — a bare headline (merge 3195481f6)**"),
		null,
	);
});

/*
 * THE NEGATIVE CASE THE RULE NEEDS, from the release that taught it: a lead may
 * OPEN with a bare `#N` reference and still be prose about the change. The first
 * spelling of the machine-row rule was `/^#\d+\b/`, and it stepped over v0.49.9's
 * own bullet lead - so the card showed the release-record paragraph instead of
 * what changed, one block LATER than the failure the rule exists to prevent. A
 * number, a dash and a title is the shape; a number followed by a sentence is
 * not.
 */
test("a lead that opens with a bare issue reference is prose, not a machine row", () => {
	const body = [
		"- **#687** `de06da6c` — viewing a session in a focused TUI now marks its completion read across the mobile relay.",
		"",
		"## Release record",
		"",
		"Both entries are corrections or readability reworks of existing surfaces.",
	].join("\n");
	assert.equal(
		summariseReleaseBody(body),
		"#687 de06da6c — viewing a session in a focused TUI now marks its completion read across the mobile relay.",
	);
});

test("a bullet list is readable when the release has no prose lead at all", () => {
	assert.equal(
		summariseReleaseBody(
			"## Fixes\n\n- **The watchdog is dump-only** (#1517)\n- A second bullet",
		),
		"The watchdog is dump-only (#1517) A second bullet",
	);
});

test("structure alone is not a summary", () => {
	assert.equal(summariseReleaseBody("## v0.62.33"), null);
	assert.equal(summariseReleaseBody("\n\n   \n"), null);
	assert.equal(summariseReleaseBody(""), null);
	assert.equal(summariseReleaseBody(undefined), null);
	assert.equal(summariseReleaseBody({ body: "not a string" }), null);
});

test("a long lead is cut at a word boundary, within the budget", () => {
	const body = Array.from({ length: 200 }, (_, index) => `word${index}`).join(
		" ",
	);
	const summary = summariseReleaseBody(body);
	assert.ok(summary.length <= SUMMARY_LIMIT, `summary was ${summary.length}`);
	assert.ok(summary.endsWith("..."), summary.slice(-20));
	assert.ok(!summary.includes("wor..."), "a word was cut in half");
	// And the word it stopped before is the whole word, not a prefix of it.
	const lastWord = summary.slice(0, -3).split(" ").at(-1);
	assert.ok(/^word\d+$/.test(lastWord), `last word was ${lastWord}`);
});

test("a wall of text with no space near the cut is cut at the budget, not thrown away", () => {
	const summary = summariseReleaseBody("x".repeat(900));
	assert.equal(summary.length, SUMMARY_LIMIT);
	assert.equal(summary, `${"x".repeat(SUMMARY_LIMIT - 3)}...`);
});

test("a lead shorter than the budget is not touched at all", () => {
	const body = "A short release note.";
	assert.equal(summariseReleaseBody(body), body);
});

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

test("the release's own html_url is used, and the built one is the fallback", () => {
	const named = parseReleaseResponse(JSON.parse(releasePayload()), "0.62.34");
	assert.equal(
		named.url,
		"https://github.com/damianvtran/local-operator-renamed/releases/tag/v0.62.34",
		"the payload's own html_url must win, or a renamed repository's link goes stale",
	);
	assert.notEqual(named.url, releasePageUrl("0.62.34"));
	assert.equal(named.version, "0.62.34");

	const unnamed = parseReleaseResponse(
		JSON.parse(releasePayload({ html_url: undefined })),
		"0.62.34",
	);
	assert.equal(unnamed.url, releasePageUrl("0.62.34"));
});

test("a payload that carries no prose is no notes", () => {
	for (const payload of [
		JSON.parse(releasePayload({ body: "" })),
		JSON.parse(releasePayload({ body: null })),
		JSON.parse(releasePayload({ body: "## 0.62.34" })),
		null,
		"not an object",
		[],
	]) {
		assert.equal(parseReleaseResponse(payload, "0.62.34"), null);
	}
});

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

test("a cache that is missing, truncated or misshapen answers with nothing rather than throwing", () => {
	const root = tempRoot("cache-broken");
	assert.deepEqual(readReleaseNotesCache(root), {});

	writeFileSync(releaseNotesCachePath(root), "{not json", "utf8");
	assert.deepEqual(readReleaseNotesCache(root), {});

	writeFileSync(
		releaseNotesCachePath(root),
		JSON.stringify({
			"0.1.0": { version: "0.1.0", summary: "kept", url: "https://x.test/1" },
			"0.2.0": { version: "0.2.0", summary: "", url: "https://x.test/2" },
			"0.3.0": { version: "0.3.0", summary: "no url" },
			"0.4.0": "not an object",
		}),
		"utf8",
	);
	assert.deepEqual(Object.keys(readReleaseNotesCache(root)), ["0.1.0"]);
});

test("the cache round-trips through userData, keyed by the version the offer names", () => {
	const root = tempRoot("cache-round-trip");
	const entry = {
		version: "0.62.34",
		summary: "What changed.",
		url: releasePageUrl("0.62.34"),
	};
	writeReleaseNotesCache(root, rememberReleaseNotes({}, entry));
	assert.deepEqual(readReleaseNotesCache(root), { "0.62.34": entry });
	assert.deepEqual(
		cachedReleaseNotes(readReleaseNotesCache(root), "0.62.34"),
		entry,
	);
	assert.equal(
		cachedReleaseNotes(readReleaseNotesCache(root), "0.62.35"),
		null,
	);
	assert.equal(
		releaseNotesCachePath(root),
		join(root, RELEASE_NOTES_CACHE_FILE),
	);
});

test("the cache is bounded, and the version just written is the one that survives", () => {
	let cache = {};
	for (let index = 0; index <= CACHE_LIMIT; index += 1) {
		cache = rememberReleaseNotes(cache, {
			version: `0.${index}.0`,
			summary: `note ${index}`,
			url: `https://x.test/${index}`,
		});
	}
	const versions = Object.keys(cache);
	assert.equal(versions.length, CACHE_LIMIT);
	assert.equal(versions.at(-1), `0.${CACHE_LIMIT}.0`);
	assert.ok(!("0.0.0" in cache), "the oldest entry was not dropped");
});

// ---------------------------------------------------------------------------
// The lookup, over a real loopback endpoint
// ---------------------------------------------------------------------------

test("a published release answers with its notes and writes them to the cache", async () => {
	const root = tempRoot("lookup-found");
	const { origin, state } = await api((_request, response) => {
		response.writeHead(200, { "content-type": "application/json" });
		response.end(releasePayload());
	});

	const first = await fetchServerReleaseNotes("0.62.34", {
		userDataDir: root,
		apiOrigin: origin,
	});
	assert.equal(first.status, "found");
	assert.equal(first.cached, false);
	assert.equal(
		first.notes.summary,
		"0.62.34 fixes the stall watchdog wedging the very session it existed to watch.",
	);
	assert.equal(
		first.notes.url,
		"https://github.com/damianvtran/local-operator-renamed/releases/tag/v0.62.34",
	);
	assert.equal(state.requests, 1);
	assert.deepEqual(readReleaseNotesCache(root), { "0.62.34": first.notes });

	/*
	 * THE RATE-LIMIT PROPERTY, and the reason the count is asserted rather than
	 * the answer: a second lookup for the same version must be answered from disk
	 * without touching the endpoint. A cache that missed here would still return
	 * the right notes - it would just spend the machine's hourly budget on them.
	 */
	const second = await fetchServerReleaseNotes("0.62.34", {
		userDataDir: root,
		apiOrigin: origin,
	});
	assert.equal(second.status, "found");
	assert.equal(second.cached, true);
	assert.deepEqual(second.notes, first.notes);
	assert.equal(state.requests, 1, "the cached lookup made a request anyway");
});

test("a tag with no release, a body that is not JSON and a release with no prose are each 'no notes'", async () => {
	const root = tempRoot("lookup-absent");

	const missing = await api((_request, response) => {
		response.writeHead(404, { "content-type": "application/json" });
		response.end('{"message":"Not Found"}');
	});
	const absent = await fetchServerReleaseNotes("9.9.9", {
		userDataDir: root,
		apiOrigin: missing.origin,
	});
	assert.equal(absent.status, "absent");
	assert.match(absent.reason, /404/);

	const notJson = await api((_request, response) => {
		response.writeHead(200, { "content-type": "text/html" });
		response.end("<html>a proxy's error page</html>");
	});
	const unparsed = await fetchServerReleaseNotes("9.9.8", {
		userDataDir: root,
		apiOrigin: notJson.origin,
	});
	assert.equal(unparsed.status, "absent");
	assert.match(unparsed.reason, /not JSON/);

	const empty = await api((_request, response) => {
		response.writeHead(200, { "content-type": "application/json" });
		response.end(releasePayload({ body: "## v9.9.7" }));
	});
	const prose = await fetchServerReleaseNotes("9.9.7", {
		userDataDir: root,
		apiOrigin: empty.origin,
	});
	assert.equal(prose.status, "absent");
	assert.match(prose.reason, /carries no notes/);

	// None of the three wrote a cache entry, so none of them poisons the next
	// check with an answer it would otherwise never revisit.
	assert.deepEqual(readReleaseNotesCache(root), {});
});

test("a lookup that names no version never reaches the network", async () => {
	const root = tempRoot("lookup-unnamed");
	const { origin, state } = await api((_request, response) => {
		response.writeHead(200, { "content-type": "application/json" });
		response.end(releasePayload());
	});
	const lookup = await fetchServerReleaseNotes("   ", {
		userDataDir: root,
		apiOrigin: origin,
	});
	assert.equal(lookup.status, "absent");
	assert.match(lookup.reason, /named no version/);
	assert.equal(state.requests, 0);
});

test("an endpoint that accepts and then stalls is bounded by the idle timeout", async () => {
	const root = tempRoot("lookup-timeout");
	const { origin } = await api(() => {
		// A connection that is ACCEPTED and then left open: the shape a wedged
		// proxy produces. This is the half `request.setTimeout` covers, because
		// the socket exists and is idle.
	});
	const started = Date.now();
	const lookup = await fetchServerReleaseNotes("0.62.34", {
		userDataDir: root,
		apiOrigin: origin,
		timeoutMs: 300,
	});
	const elapsed = Date.now() - started;
	assert.equal(lookup.status, "absent");
	assert.match(lookup.reason, /no answer within 300ms/);
	assert.ok(elapsed < 3000, `the lookup took ${elapsed}ms`);
});

/*
 * THE OTHER HALF OF THE BOUND, and the one this suite was missing: a CONNECT
 * that never completes. Node arms `request.setTimeout` only once a socket is
 * assigned and defers the timer to the `connect` event for a socket still
 * connecting, so before the request options carried `timeout`, a blackholed
 * route waited out the agent's own 5 s default and the reason string named a
 * bound 1 s shorter than the real one.
 *
 * TEST-NET-1 (RFC 5737) is reserved for documentation and is not routed, so the
 * connect hangs; a network that refuses it immediately still passes, because the
 * property under test is that this settles QUICKLY and as `absent`, not which
 * error it settles with.
 */
test("a connect that never completes is bounded by the timeout, not by the agent", async () => {
	const root = tempRoot("lookup-connect-hang");
	const started = Date.now();
	const lookup = await fetchServerReleaseNotes("0.62.34", {
		userDataDir: root,
		apiOrigin: "http://192.0.2.1:81",
		timeoutMs: 700,
	});
	const elapsed = Date.now() - started;
	assert.equal(lookup.status, "absent");
	assert.ok(elapsed < 3000, `the lookup took ${elapsed}ms`);
});

/*
 * The streaming bound, which nothing exercised: the module refuses an answer
 * larger than it will read, and the arm is reachable from any endpoint that can
 * stream. 600 KiB is past the 512 KiB ceiling.
 */
test("an answer larger than the lookup accepts is refused rather than buffered", async () => {
	const root = tempRoot("lookup-oversize");
	const { origin } = await api((_request, response) => {
		response.writeHead(200, { "content-type": "application/json" });
		const chunk = "a".repeat(64 * 1024);
		for (let sent = 0; sent < 10; sent += 1) response.write(chunk);
		response.end();
	});
	const lookup = await fetchServerReleaseNotes("0.62.34", {
		userDataDir: root,
		apiOrigin: origin,
	});
	assert.equal(lookup.status, "absent");
	assert.match(lookup.reason, /larger than this lookup accepts/);
	assert.deepEqual(readReleaseNotesCache(root), {});
});

test("an endpoint nothing is listening on is a reason, not a crash", async () => {
	const root = tempRoot("lookup-refused");
	const reserved = createServer(() => {});
	await new Promise((resolve) => reserved.listen(0, "127.0.0.1", resolve));
	const dead = `http://127.0.0.1:${reserved.address().port}`;
	await new Promise((resolve) => reserved.close(resolve));

	const lookup = await fetchServerReleaseNotes("0.62.34", {
		userDataDir: root,
		apiOrigin: dead,
	});
	assert.equal(lookup.status, "absent");
	assert.match(lookup.reason, /failed/);
});

test("a cache write that cannot land still answers with the notes", async () => {
	// A userData path that is a FILE, so mkdir/write both fail: the read side then
	// also fails, which is what makes this the arm where the panel keeps its notes
	// while the next launch re-fetches them.
	const root = tempRoot("lookup-unwritable");
	const blocked = join(root, "not-a-directory");
	writeFileSync(blocked, "a file, not the directory the cache wants", "utf8");

	const { origin, state } = await api((_request, response) => {
		response.writeHead(200, { "content-type": "application/json" });
		response.end(releasePayload());
	});
	const first = await fetchServerReleaseNotes("0.62.34", {
		userDataDir: blocked,
		apiOrigin: origin,
	});
	assert.equal(first.status, "found");
	assert.equal(first.cached, false);

	const second = await fetchServerReleaseNotes("0.62.34", {
		userDataDir: blocked,
		apiOrigin: origin,
	});
	assert.equal(second.status, "found");
	assert.equal(second.cached, false, "an unwritable cache reported a hit");
	assert.equal(state.requests, 2);
});

// ---------------------------------------------------------------------------
// The renderer's own question: are these notes this offer's?
// ---------------------------------------------------------------------------

/*
 * WHY THIS IS TESTED HERE AND NOT THROUGH THE PANEL. Round 3 mutated the
 * comparison out of the JSX and the whole focused desktop suite stayed green,
 * because nothing under `scripts/` mounts a React component. The comparison is
 * therefore a function, and this is where it is pinned: a mismatched version
 * must render nothing, a matching one must render, and an absent payload must
 * stay absent (an older main process sends no field at all).
 */
test("notes are offered only when they belong to the version the offer names", () => {
	const notes = {
		version: "0.62.34",
		summary: "What changed.",
		url: "https://github.com/damianvtran/local-operator/releases/tag/v0.62.34",
	};

	assert.deepEqual(notesForOffer(notes, "0.62.34"), notes);
	/*
	 * The cache is a plain JSON file the app writes and anything can edit, so an
	 * entry whose stored version disagrees with the key it was filed under is the
	 * case this exists for: another release's lead must not appear under this
	 * card's heading. Exact comparison, because both sides come from the same
	 * reading of PyPI's `info.version`.
	 */
	assert.equal(notesForOffer(notes, "0.62.35"), null);
	assert.equal(notesForOffer(notes, "v0.62.34"), null);
	assert.equal(notesForOffer(null, "0.62.34"), null);
	assert.equal(notesForOffer(undefined, "0.62.34"), null);
});

/*
 * And the truncation's two edges the corpus does not reach: a unit or an
 * identifier at the seam is content, so it stays even when it is one or two
 * characters, while an article goes.
 */
test("the cut keeps a short unit and drops a short article", () => {
	const unit =
		"The bound is measured and the value it reports is 500 ms and then the sentence keeps going for a while after that";
	assert.equal(
		summariseReleaseBody(unit, 60),
		"The bound is measured and the value it reports is 500 ms...",
	);
	const article =
		"A message sent while a job-result delivery turn holds the session lock is no longer silently dropped and then more words follow";
	assert.equal(
		summariseReleaseBody(article, 46),
		"A message sent while a job-result delivery...",
	);
});

/*
 * THE UNBALANCED LEAD, which is what `stripUnpairedEmphasis` is for: the body's
 * own branch is corpus-free (removing the strip changes none of the 300
 * summaries), so the case is the only thing that pins it - and the balanced body
 * the old case used never reached the function at all, which a mutation proved.
 */
test("a cut inside an unclosed bold run leaves no delimiters", () => {
	const summary = summariseReleaseBody(`**${"word ".repeat(120)}`);
	assert.ok(!summary.includes("*"), summary.slice(0, 40));
	assert.ok(summary.endsWith("..."));
});

/*
 * AND THE MASK'S ALPHABET: a body containing U+E000/U+E001 (none of the 300
 * published does) must not be able to impersonate a slot. Removing the alphabet
 * from the input is what makes that true; without it a probe measured text
 * deleted and, worse, a real code span's contents duplicated.
 */
test("a body containing the mask's own sentinels cannot impersonate a slot", () => {
	assert.equal(
		summariseReleaseBody("before \uE0000\uE001 after"),
		"before 0 after",
	);
	assert.equal(summariseReleaseBody("\uE0000\uE001 and `real`"), "0 and real");
	assert.equal(summariseReleaseBody("\uE00099\uE001 then `x`"), "99 then x");
});
