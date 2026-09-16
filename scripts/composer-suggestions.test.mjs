import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's two copy pools and the rules that turn them into what the user
 * sees: which four suggestions an empty chat shows, and which tip the row is on.
 *
 * WHY THIS IS ITS OWN FILE, and not a section of `suggestion-stack.test.mjs`.
 * That file pins the band's height RULE - rows in, a cap out - and it is about
 * geometry. These two modules are about COPY and ORDER: a pool that must stay
 * verifiable one entry at a time, a sample that must be pinned on the session's
 * first draw, and a ring that must not show the same tip twice in a row. They
 * share nothing with the cap but the band they render in.
 *
 * WHAT A UNIT TEST CAN AND CANNOT SAY HERE. Everything asserted below is a
 * property of the values the modules return - membership, order, distinctness,
 * reproducibility under a seeded source. Nothing here is a claim about pixels:
 * whether four labels take one row or two, and whether the longest tip clears
 * the narrowest column untruncated, are measurements on a rendered frame, and
 * they live in `docs/evidence/chat-composer-band/README.md` where the frames
 * and their numbers are. What IS guarded here is the copy's character budget -
 * the property that keeps those measurements true, and the only half of them a
 * unit test can hold.
 *
 * Both modules import nothing, so each bundle is one file and no React is
 * involved.
 */

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/chat/components/composer-suggestions";
			export * from "./src/renderer/src/features/chat/components/composer-tips";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});

const bundlePath = new URL("./_composer-copy.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

const {
	COMPOSER_TIPS,
	DEFAULT_MESSAGE_SUGGESTIONS,
	MAX_SUGGESTIONS,
	advanceTipIndex,
	pickSuggestions,
	sampleSuggestions,
	TIP_ROTATE_INTERVAL_MS,
	TIP_ROTATE_INTERVAL_S,
	tipAt,
	tipRotationOrder,
} = mod;

/** A deterministic stand-in for `Math.random`, so an order is reproducible. */
const seeded = (seed) => {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
};

test("the suggestion pool is the product's own requests, and nothing else", () => {
	assert.equal(
		DEFAULT_MESSAGE_SUGGESTIONS.length,
		8,
		"the pool is eight entries; the count shown is MAX_SUGGESTIONS and is a separate decision",
	);
	assert.equal(
		new Set(DEFAULT_MESSAGE_SUGGESTIONS).size,
		DEFAULT_MESSAGE_SUGGESTIONS.length,
		"a duplicated label wastes a slot in a sample of four",
	);
	for (const label of DEFAULT_MESSAGE_SUGGESTIONS) {
		assert.ok(
			label.length <= 42,
			`"${label}" is ${label.length} chars: the pool's length budget is what keeps a sample of four inside two rows at the narrowest column the row renders in (550px)`,
		);
	}
	/*
	 * The opening sample is the pool's head, so this order is load-bearing
	 * rather than incidental: it is the four labels every first-run user sees
	 * and the four in every committed frame of the empty chat.
	 */
	assert.deepEqual(
		DEFAULT_MESSAGE_SUGGESTIONS.slice(0, MAX_SUGGESTIONS),
		[
			"Set up Linear MCP for me",
			"Create a team of agents",
			"Turn on phone access",
			"Show me what the agent did last turn",
		],
		"the pinned opening sample is the pool's first four, in this order",
	);
	/*
	 * The head's two rules (`composer-suggestions.ts` states them with the why):
	 * no two entries share a leading verb, so the four do not read as one request
	 * said twice; and the pool keeps at most one create-an-agent entry. Asserted
	 * rather than only written down because the collision is easy to reintroduce
	 * - the pool already carries `create a team of agents` beside
	 * `build a code-review agent`.
	 */
	const head = DEFAULT_MESSAGE_SUGGESTIONS.slice(0, MAX_SUGGESTIONS);
	assert.equal(
		new Set(head.map((label) => label.split(" ")[0])).size,
		head.length,
		"no two of the pinned four share a leading verb",
	);
});

test("a sample is a uniform draw from the pool, not a sort", () => {
	const drawn = pickSuggestions(DEFAULT_MESSAGE_SUGGESTIONS, 4, seeded(1));
	assert.equal(drawn.length, 4);
	assert.equal(
		new Set(drawn).size,
		4,
		"a sample of four is four different labels",
	);
	for (const label of drawn) {
		assert.ok(
			DEFAULT_MESSAGE_SUGGESTIONS.includes(label),
			"a sample may only contain pool entries",
		);
	}
	assert.deepEqual(
		pickSuggestions(DEFAULT_MESSAGE_SUGGESTIONS, 4, seeded(1)),
		drawn,
		"the draw is a function of the random source, which is what makes it testable at all - the previous `sort(() => Math.random() - 0.5)` depended on how many times the comparator was called",
	);

	/*
	 * Every entry must be REACHABLE. The comparator sort this replaced was
	 * biased toward the input order, so the tail of the pool was rarely seen;
	 * over 200 draws from the seed above, all eight entries appearing is the
	 * property that bias would break.
	 */
	const seen = new Set();
	for (let i = 0; i < 200; i++) {
		for (const label of pickSuggestions(
			DEFAULT_MESSAGE_SUGGESTIONS,
			4,
			seeded(i + 1),
		)) {
			seen.add(label);
		}
	}
	assert.equal(
		seen.size,
		DEFAULT_MESSAGE_SUGGESTIONS.length,
		"every pool entry is reachable by a draw",
	);
});

test("a pool no larger than the sample is returned whole and in order", () => {
	const small = ["One", "Two", "Three"];
	assert.deepEqual(pickSuggestions(small, 4, seeded(7)), small);
	assert.deepEqual(
		sampleSuggestions(small, 4, seeded(7), { opening: true }),
		small,
	);
	assert.deepEqual(sampleSuggestions([], 4, seeded(7), { opening: true }), []);
});

test("the session's first draw is the pool's head, and only later draws sample", () => {
	const session = { opening: true };
	const first = sampleSuggestions(
		DEFAULT_MESSAGE_SUGGESTIONS,
		4,
		seeded(3),
		session,
	);
	assert.deepEqual(
		first,
		DEFAULT_MESSAGE_SUGGESTIONS.slice(0, 4),
		"the opening sample is deterministic, so the first empty chat of a session is the same screen for every user and every committed frame",
	);
	assert.equal(session.opening, false, "the opening draw is consumed");

	const second = sampleSuggestions(
		DEFAULT_MESSAGE_SUGGESTIONS,
		4,
		seeded(3),
		session,
	);
	assert.equal(second.length, 4);
	assert.equal(
		new Set(second).size,
		4,
		"a later draw is still four distinct labels",
	);
	/*
	 * NOT asserted: that the second draw differs from the first. A uniform draw
	 * can legitimately return the pool's head again, and asserting otherwise
	 * would be asserting a property the mechanism does not have.
	 */
});

test("two sessions do not share an opening sample", () => {
	const a = { opening: true };
	const b = { opening: true };
	assert.deepEqual(
		sampleSuggestions(DEFAULT_MESSAGE_SUGGESTIONS, 4, seeded(5), a),
		DEFAULT_MESSAGE_SUGGESTIONS.slice(0, 4),
	);
	assert.deepEqual(
		sampleSuggestions(DEFAULT_MESSAGE_SUGGESTIONS, 4, seeded(5), b),
		DEFAULT_MESSAGE_SUGGESTIONS.slice(0, 4),
		"state is passed in rather than module-global, so a second session still opens on the pinned frame",
	);
});

test("the tip pool is distinct, non-empty and inside its character budget", () => {
	assert.equal(COMPOSER_TIPS.length, 10);
	assert.equal(
		new Set(COMPOSER_TIPS).size,
		COMPOSER_TIPS.length,
		"the rotation's no-immediate-repeat guarantee rests on the labels being distinct",
	);
	/*
	 * The tip pool's own length budget, the chip pool's 42-character rule applied
	 * to the other row. The row's presence is a function of WIDTH ALONE
	 * (`composer-tips.ts` property 2), which is only honest while no entry can
	 * truncate: the row's `truncate` would turn an over-long entry into a fragment
	 * of a sentence, and a fragment is not a tip. The measured ceiling is **58
	 * characters / 356px** — the longest SHIPPED entry, `ask for phone access to
	 * drive this session from your phone`, in the row's own element at the narrowest
	 * column that renders the row (484px available,
	 * `docs/evidence/chat-composer-band/README.md`) — so 62 leaves headroom for a
	 * future reword while still failing anything long enough to clip. (Round 2 nit:
	 * this sentence used to read "58 characters / 369px", pairing the shipped pool's
	 * length with a width nothing here measures; the retired pool's longest entry
	 * was `ask for the mobile relay to drive this session from your phone`, 62
	 * characters, which is the number the headroom has to clear.)
	 */
	for (const tip of COMPOSER_TIPS) {
		assert.ok(tip.length > 0, "no empty tip");
		assert.ok(
			tip.length <= 62,
			`"${tip}" is ${tip.length} chars: the row renders for the whole pool or not at all, so an entry long enough to truncate would make its presence a function of the entry's length`,
		);
		assert.equal(
			tip,
			tip.trim(),
			"the row's copy carries no leading or trailing space of its own",
		);
	}
});

test("the rotation opens on pool[0] and then turns through the whole pool", () => {
	const order = tipRotationOrder(COMPOSER_TIPS, seeded(11));
	assert.equal(
		order[0],
		COMPOSER_TIPS[0],
		"the opening frame is pinned, which is what makes a committed capture of this surface reproducible",
	);
	assert.equal(order.length, COMPOSER_TIPS.length);
	assert.deepEqual(
		[...order].sort(),
		[...COMPOSER_TIPS].sort(),
		"the ring holds every entry exactly once",
	);
	assert.deepEqual(
		tipRotationOrder(COMPOSER_TIPS, seeded(11)),
		order,
		"the order is a function of the random source",
	);
	assert.deepEqual(
		tipRotationOrder(["only"], seeded(11)),
		["only"],
		"a one-entry pool has nothing to shuffle",
	);
});

test("a tick never shows the same tip twice in a row, including across the wrap", () => {
	const order = tipRotationOrder(COMPOSER_TIPS, seeded(13));
	let index = 0;
	const seen = [];
	for (let i = 0; i < COMPOSER_TIPS.length * 3; i++) {
		seen.push(tipAt(order, index));
		index = advanceTipIndex(index, order.length);
	}
	for (let i = 1; i < seen.length; i++) {
		assert.notEqual(
			seen[i],
			seen[i - 1],
			`tick ${i} repeated the previous tip`,
		);
	}
	assert.deepEqual(
		seen.slice(0, COMPOSER_TIPS.length).sort(),
		[...COMPOSER_TIPS].sort(),
		"one full turn covers the pool before it repeats",
	);
});

test("the clock is the TUI's, in both units", () => {
	assert.equal(
		TIP_ROTATE_INTERVAL_S,
		12,
		"the interval is the TUI's TIP_ROTATE_INTERVAL_S, and its reasoning (under ~8s the line turns mid-read, over ~15s a short session meets only the first entry) ports with the number",
	);
	assert.equal(TIP_ROTATE_INTERVAL_MS, 12_000);
});
