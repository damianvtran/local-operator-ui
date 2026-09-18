import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's inline credential capture, asserted against the TUI semantics
 * it ports and the contract in `docs/design/composer-credential-capture.md`.
 *
 * `credential-capture.ts` is a port of `local_operator/tui/widgets/editor.py`
 * (`CREDENTIAL_ARM`, `CREDENTIAL_TOKEN`, `CREDENTIAL_ARGUMENT`,
 * `_sync_credential_arm`, `_open_credential_typing`, `_credential_edit_mirror`,
 * `_type_credential_char`, `_mint_typed_credential`, `_cancel_credential_typing`,
 * `_capture_credential`, `Editor._on_paste`, `generate_credential_key`,
 * `cite`, `credential_payloads`, `substitute_credentials`, `describe_unstored`)
 * and `local_operator/tui/app.py` (`_capture_inline_credentials`,
 * `_store_inline_credentials`, `session_credential_names`, the notice strings).
 *
 * WHY EVERY RULE HERE IS PINNED BY A TEST. The feature's whole safety argument
 * is a set of statements about a STRING and an OFFSET — "the secret is never in
 * the document", "one cell per character", "the citation is only the app's own
 * when the index AND the marker text match". The TUI lost review rounds to
 * exactly this class of rule stated in prose and enforced nowhere (the
 * positional mirror of UX round 1's U1, the Esc re-arm of R1/U2, the
 * whole-message refusal of review round 1's R1). A green browser pass does not
 * falsify any of them; these do.
 *
 * Bundled rather than imported because the module is TypeScript in the
 * renderer tree; esbuild into a data: URL is the pattern `slash-token.test.mjs`
 * established. The module under test is the REAL one — nothing is
 * re-implemented here.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/credential-capture";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	CREDENTIAL_ARMED_NOTICE,
	CREDENTIAL_TOKEN,
	CREDENTIAL_KEY_ALPHABET,
	CREDENTIAL_KEY_PATTERN,
	CREDENTIAL_CLEAR_UNDO_LABEL,
	CREDENTIAL_KEY_PREFIX,
	CREDENTIAL_MARKER,
	CREDENTIAL_TYPING_NOTICE,
	IDLE_CAPTURE,
	MASK_CELL,
	abandonTyping,
	applyDomEdit,
	armSpan,
	cancelTypedCredential,
	capturePasted,
	charsOf,
	citationSegments,
	citationSpan,
	citedPayloads,
	clearCitedCredential,
	clearedNotice,
	clearedNoticeLine,
	clearedStaleNotice,
	clearedToastLine,
	noticeLineFor,
	clearControlLabel,
	credentialCitation,
	credentialMarker,
	credentialNamesFrom,
	describeUnstored,
	generateCredentialKey,
	holdsCancelledToken,
	isArmed,
	isStorableCredentialKey,
	isTyping,
	markerChip,
	markerChipTitle,
	maskEdit,
	maskSpan,
	mintTypedCredential,
	paintPlan,
	restoreClearedCredential,
	relocateArm,
	storedNotice,
	substituteCredentials,
	syncCapture,
	tokenSpans,
	typeIntoCapture,
	unredactedNotice,
	unredactedOverBuffer,
	unstoredNotice,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The render-only transform, bundled and imported the same way and for the same
 * reason: the plugin is DRIVEN over real mdast trees rather than described. It is
 * a second bundle because it is a second module — `credential-citation-remark.ts`
 * reads no React and no DOM, which is exactly what makes it testable here.
 */
const remarkBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/credential-citation-remark";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	citationFromHref,
	citationFromLink,
	citationHref,
	remarkCredentialCitations,
} = await import(
	`data:text/javascript;base64,${Buffer.from(remarkBundle.outputFiles[0].text).toString("base64")}`
);

/*
 * THE MATH DECISION, bundled beside the plugin that has to survive it (code review
 * round 1, R1-1). A third bundle because it is a third module - `markdown-math.ts`
 * reads no React either, and the defect it fixes is a property of the CONTENT and
 * the plugin LIST rather than of any component.
 *
 * The pipeline below is the renderer's own: `remark-parse` + `remark-gfm`, then
 * `remark-math` when the decision says the content is worth it, then the citation
 * plugin. It is driven over source the app's own citation builder produced, which
 * is the only kind of source that can exhibit the defect - a citation carries
 * exactly one `$`, so two of them are what makes `containsLatex` see math.
 */
const mathBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/credential-capture";' +
			'export * from "./src/renderer/src/features/chat/components/credential-citation-remark";' +
			'export * from "./src/renderer/src/features/chat/components/markdown-math";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { containsRenderableMath, maskCitations } = await import(
	`data:text/javascript;base64,${Buffer.from(mathBundle.outputFiles[0].text).toString("base64")}`
);

/**
 * The renderer's pipeline over one document, with the math plugin forced either
 * way: `false` is what the decision produces for a citation-bearing document,
 * `true` is the pipeline the defect shipped (and the negative control below, so a
 * test that passes by never enabling math cannot pass).
 */
const drivePipeline = async (source, withMath) => {
	const { unified } = await import("unified");
	const { default: remarkParse } = await import("remark-parse");
	const { default: remarkGfm } = await import("remark-gfm");
	const { default: remarkMath } = await import("remark-math");
	let processor = unified().use(remarkParse).use(remarkGfm);
	if (withMath) processor = processor.use(remarkMath);
	processor = processor.use(remarkCredentialCitations);
	const tree = processor.runSync(processor.parse(source));
	const counts = { link: 0, inlineMath: 0 };
	const walk = (node) => {
		if (counts[node.type] !== undefined) counts[node.type] += 1;
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	return counts;
};

/*
 * ---------------------------------------------------------------------------
 * A tiny harness that drives the module the way the composer does.
 * ---------------------------------------------------------------------------
 *
 * Every sequence below is expressed as what the operator DOES — type, move the
 * caret, paste, press Enter — and the harness applies it through the module's
 * own entry points, in the order `message-input.tsx` calls them:
 *
 *   - a printable keystroke is intercepted BEFORE the DOM (the character never
 *     reaches the textarea) and applied as a masked edit;
 *   - a structural edit (Backspace, Delete, a selection, a newline) is applied
 *     by the DOM and mirrored from the edit it reported;
 *   - a paste is the credential gate first, then the ordinary paste;
 *   - a caret move re-syncs the capture (the TUI does this on
 *     `watch_selection`, because a mouse click and an app-set selection move
 *     the caret with no caret key pressed).
 *
 * `state.buffer` is the document, which is the thing the operator can see;
 * `state.capture.value` is the thing they cannot.
 */
const harness = () => {
	const state = {
		buffer: "",
		caret: 0,
		capture: IDLE_CAPTURE,
		/** The payload map: index -> minted credential, as the composer holds it. */
		payloads: new Map(),
		nextIndex: 1,
		/** What the composer's `onSendMessage` was handed, if anything. */
		sent: null,
		/** Every buffer the persisted draft was written with. */
		drafted: [],
		/** Names the session store already holds, as `list` reported them. */
		sessionNames: [],
	};
	/** The session's names UNION this composer's in-flight keys (§8). */
	const taken = () => [
		...state.sessionNames,
		...[...state.payloads.values()].map((p) => p.key),
	];
	const mint = (payload) => {
		state.payloads.set(payload.index, payload);
		state.nextIndex = Math.max(state.nextIndex, payload.index + 1);
	};
	/* The draft rule (§6): while a masked span is open nothing is persisted. */
	const draft = () => {
		if (!isTyping(state.capture)) state.drafted.push(state.buffer);
	};
	const apply = ({ buffer, caret }) => {
		state.buffer = buffer;
		state.caret = caret;
	};

	return {
		state,
		/** The buffer the DOM would produce for an edit, before masking. */
		edit(top, bottom, inserted, caretAfter) {
			const domBuffer =
				state.buffer.slice(0, top) + inserted + state.buffer.slice(bottom);
			const caret = caretAfter ?? top + inserted.length;
			const masked = maskEdit(state.capture, domBuffer, caret, {
				top,
				bottom,
				inserted,
			});
			if (masked) {
				apply(masked);
				state.capture = masked.capture;
			} else {
				apply({ buffer: domBuffer, caret });
			}
			state.capture = syncCapture(
				state.capture,
				state.buffer,
				state.caret,
				"typing",
			);
			draft();
			return this;
		},
		/**
		 * One edit through the PRODUCTION DOM seam: `applyDomEdit`, which is what the
		 * textarea's own `onChange` calls. The verbs above drive `maskEdit` directly,
		 * which is the mirror the seam delegates to; a rule that lives IN the seam
		 * (the refusal of text arriving into an open span) is only pinned here.
		 */
		domEdit(top, bottom, inserted, caretAfter) {
			const domBuffer =
				state.buffer.slice(0, top) + inserted + state.buffer.slice(bottom);
			const caret = caretAfter ?? top + inserted.length;
			const applied = applyDomEdit(
				state.capture,
				state.buffer,
				domBuffer,
				caret,
				"typing",
			);
			apply(applied);
			state.capture = applied.capture;
			draft();
			return this;
		},
		/** One intercepted printable keystroke: never reaches the DOM. */
		typeKeystroke(text) {
			const typed = typeIntoCapture(
				state.capture,
				state.buffer,
				{ start: state.caret, end: state.caret },
				text,
			);
			apply(typed);
			state.capture = syncCapture(
				typed.capture,
				state.buffer,
				state.caret,
				"typing",
			);
			draft();
			return this;
		},
		/** Shift+Enter: a typographic edit, not a masked character. */
		newline() {
			if (isTyping(state.capture)) state.capture = abandonTyping(state.capture);
			return this.edit(state.caret, state.caret, "\n");
		},
		/** `text` typed character by character, as a person types it. */
		type(text) {
			for (const char of charsOf(text)) this.typeKeystroke(char);
			return this;
		},
		backspace() {
			if (state.caret === 0) return this;
			return this.edit(state.caret - 1, state.caret, "");
		},
		del() {
			return this.edit(state.caret, state.caret + 1, "");
		},
		replaceSelection(to, text) {
			return this.edit(state.caret, to, text);
		},
		caretTo(at) {
			state.caret = at;
			// A caret move may keep an arm and RE-OPEN a span, but never arms
			// (§2): "caret" is its own origin for exactly that reason.
			state.capture = syncCapture(
				state.capture,
				state.buffer,
				state.caret,
				"caret",
			);
			return this;
		},
		/** What the last `paste` did, so a test can read the receipt it minted. */
		lastPaste: null,
		paste(text) {
			const captured = capturePasted({
				capture: state.capture,
				buffer: state.buffer,
				caret: state.caret,
				selection: { start: state.caret, end: state.caret },
				pasted: text,
				index: state.nextIndex,
				taken: taken(),
			});
			state.lastPaste = captured;
			if (captured) {
				apply(captured);
				state.capture = captured.capture;
				if (captured.payload) mint(captured.payload);
				draft();
				return this;
			}
			// Nothing to capture: the ordinary paste, which the DOM applies and the
			// harness mirrors like any other edit.
			return this.edit(state.caret, state.caret, text);
		},
		enter() {
			const result = mintTypedCredential({
				capture: state.capture,
				buffer: state.buffer,
				caret: state.caret,
				index: state.nextIndex,
				taken: taken(),
			});
			if (result.minted) {
				apply(result);
				state.capture = result.capture;
				mint(result.payload);
				draft();
			}
			return result;
		},
		escape() {
			const result = cancelTypedCredential(state.capture, state.buffer);
			state.lastCancel = result;
			if (result.cancelled) {
				apply(result);
				state.capture = result.capture;
				draft();
			}
			return result;
		},
		/** What the last `escape` answered, so a test can read the token it left. */
		lastCancel: null,
		/** A value arriving from a route no keystroke produced (§2). */
		arrive(value, caret) {
			state.buffer = value;
			state.caret = caret ?? value.length;
			state.capture = syncCapture(
				state.capture,
				state.buffer,
				state.caret,
				"arrival",
			);
			draft();
			return this;
		},
		/** Accept the slash row: it inserts the token plus its trailing space. */
		acceptCompletion(text) {
			const at = state.caret;
			state.buffer = state.buffer.slice(0, at) + text + state.buffer.slice(at);
			state.caret = at + text.length;
			state.capture = syncCapture(
				state.capture,
				state.buffer,
				state.caret,
				"completion",
			);
			draft();
			return this;
		},
		/** What the submit seam hands the model, after storing cited credentials. */
		submit({ refused = new Map(), sessionId = "sess-1" } = {}) {
			const cited = citedPayloads(state.buffer, state.payloads.values());
			const text = substituteCredentials(
				state.buffer,
				state.payloads.values(),
				refused,
			);
			state.sent = { text, cited, sessionId };
			if (cited.length && refused.size === 0) {
				for (const payload of cited) state.payloads.delete(payload.index);
			}
			return state.sent;
		},
	};
};

/*
 * Matchers hoisted to module scope: `lint/performance/useTopLevelRegex` is the
 * scripts tree's own rule, and a literal built inside a test callback is rebuilt
 * on every case.
 */
const ARMING_SHAPE = /^\/(?:credential|cred)[ \t]*$/i;
const HAS_LINES = /lines/;
const KEY_SHAPE = /^LOP_SECRET_[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/;

/** A draw that walks a fixed alphabet sequence, so naming is deterministic. */
const drawFrom = (indices) => {
	let at = 0;
	return () => indices[at++ % indices.length];
};

/*
 * ---------------------------------------------------------------------------
 * §2 — arming
 * ---------------------------------------------------------------------------
 */

test("the arming token is recognised leading, mid-prose and after a newline", () => {
	// `editor.py:551`, ported verbatim: `(?:^|(?<=\s))/(?:credential|cred)[ \t]*$`.
	for (const text of [
		"/credential",
		"/credential ",
		"/credential  \t",
		"deploy with /credential",
		"deploy with /credential ",
		"line one\n/credential ",
		"line one\nuse /cred\t",
		"/cred ",
		"/CREDENTIAL ",
		"/Cred ",
	]) {
		const span = armSpan(text, text.length);
		assert.ok(span, `expected ${JSON.stringify(text)} to arm`);
		const armed = text.slice(span.start, span.end);
		assert.match(
			armed,
			ARMING_SHAPE,
			`the arming span is the token itself: ${JSON.stringify(armed)}`,
		);
	}
});

test("the arming token is only counted on the caret's OWN line", () => {
	/*
	 * The `$` in `CREDENTIAL_ARM` is "end of the caret's own line", which is why
	 * a `/credential` used three lines up cannot arm a paste made here.
	 */
	const buffer = "line one\n/credential \nline three";
	assert.equal(armSpan(buffer, buffer.length), null);
	// The caret at the end of the token's own line still arms.
	assert.ok(armSpan(buffer, "line one\n/credential ".length));
});

test("a lookalike token inside a word, or a longer word, does not arm", () => {
	for (const text of [
		"am/credential ",
		"foo /credentials ",
		"/credentialx ",
		"/credentials",
		"http://x/credential ",
		"deploy with /credentialx",
	]) {
		assert.equal(
			armSpan(text, text.length),
			null,
			`${JSON.stringify(text)} is not the gesture`,
		);
	}
});

test("a mention that merely ARRIVES in the buffer never arms", () => {
	/*
	 * §2's negative case, and the one a pure predicate cannot express on its own:
	 * the same string and the same caret are identical whichever route produced
	 * them, so the route is an argument. A restored draft that ends in
	 * `/credential ` must not swallow the operator's next paste — the TUI pins
	 * the same rule as
	 * `test_a_mention_of_the_command_in_text_never_typed_through_the_arm_does_not_arm`.
	 */
	const composer = harness();
	composer.arrive("/credential ");
	assert.equal(composer.state.capture.arm, null);
	assert.equal(isArmed(composer.state.capture), false);
	// …and the paste that follows is an ordinary paste, not a captured secret.
	composer.paste("hunter2");
	assert.equal(composer.state.buffer, "/credential hunter2");
	assert.equal(composer.state.payloads.size, 0);
});

test("typing the token arms it, and the arm is latched, not re-derived", () => {
	const composer = harness();
	composer.type("/credential");
	assert.ok(
		isArmed(composer.state.capture),
		"the token typed up to its end arms",
	);
	composer.typeKeystroke(" ");
	assert.ok(
		isTyping(composer.state.capture),
		"the space opens the masked span",
	);
	composer.type("hunter2");
	// A typed word, a caret move and a newline all KEEP the arm — those are the
	// edits that used to disarm silently and land the next paste in plaintext.
	composer.caretTo(2);
	composer.caretTo(composer.state.buffer.length);
	composer.edit(composer.state.caret, composer.state.caret, "\n");
	assert.ok(isArmed(composer.state.capture));
});

test("the /cred alias arms, and an accepted completion arms its trailing space", () => {
	const alias = harness();
	alias.type("/cred ");
	assert.ok(isTyping(alias.state.capture), "/cred and a space open the span");
	alias.type("abcd");
	assert.equal(alias.state.capture.value, "abcd");

	/*
	 * §1's second door: accepting the `/credential` row inserts `/credential `,
	 * and the trailing space opens the capture — the same character at the same
	 * offset as a hand-typed one, which is why the rule is stated about the
	 * BUFFER rather than about the route that produced the space.
	 */
	const picked = harness();
	picked.type("/cred");
	picked.acceptCompletion("ential ");
	assert.ok(
		isTyping(picked.state.capture),
		"the completion's own trailing space opens the span",
	);
	picked.type("s3cret");
	assert.equal(picked.state.capture.value, "s3cret");
	assert.ok(!picked.state.buffer.includes("s3cret"));
});

test("a flag-shaped tail disarms the latched arm rather than being masked", () => {
	/*
	 * `CREDENTIAL_ARGUMENT` (`editor.py:630`, matched ANCHORED at `editor.py:5916`):
	 * `/credential --forget-all` is the operator addressing the COMMAND, and a
	 * leading `-` cannot begin a key, so the two intents are unambiguous. The
	 * operator who wants the destructive verb still reaches it by typing it.
	 */
	const composer = harness();
	composer.type("/credential");
	assert.ok(isArmed(composer.state.capture));
	composer.type(" --forget-all");
	assert.equal(
		composer.state.capture.arm,
		null,
		"the flag turns the tail into an argument",
	);
	assert.equal(composer.state.buffer, "/credential --forget-all");
});

test("only a LEADING flag disarms: a `-` later in the tail stays armed", () => {
	/*
	 * The reference matches the flag at the START of the tail (`.match`,
	 * `editor.py:5916`), not anywhere in it. Unanchored, prose that happens to
	 * contain a hyphen after the token — `/credential the prod-key name` —
	 * disarmed the gesture, and the operator's next paste landed in the document:
	 * the false-negative direction, which no keystroke undoes (code review round
	 * 1, MINOR-2).
	 */
	const opened = { arm: { start: 4, end: 16 }, typingAt: null, value: "" };
	const armOf = (buffer) =>
		syncCapture(opened, buffer, buffer.length, "typing").arm;
	assert.ok(
		armOf("use /credential the prod-key name"),
		"a hyphen later in the tail is prose, not the command",
	);
	assert.ok(
		armOf("use /credential foo -"),
		"a `-` that is not the FIRST thing after the blanks is not the flag",
	);
	assert.equal(
		armOf("use /credential --forget-all"),
		null,
		"the command's own flag still disarms",
	);
});

test("the citation predicate checks the payload's own index, not just its marker text", () => {
	/*
	 * §4 states the citation rule as "index AND marker text", and both halves
	 * have to be able to say no (code review round 1, MINOR-1). Every payload
	 * this module BUILDS has the two in agreement — `credentialMarker` writes
	 * both from one index — so the halves are separable only for a payload whose
	 * fields disagree, which is what this test builds by hand. Deleting the
	 * index half used to leave the suite green.
	 */
	const agreed = {
		index: 1,
		key: "LOP_SECRET_ABCDEFGH",
		value: "s3cret",
		marker: credentialMarker(1, "s3cret"),
	};
	assert.deepEqual(citationSpan(`x ${agreed.marker} y`, agreed), {
		start: 2,
		end: 2 + agreed.marker.length,
	});
	// The marker TEXT is present, so the buffer can be walked to it — and the
	// payload's own index still says no.
	const disagreed = { ...agreed, index: 2 };
	assert.equal(
		citationSpan(`x ${agreed.marker} y`, disagreed),
		null,
		"a payload whose index and marker disagree cites nothing",
	);
	assert.equal(citedPayloads(`x ${agreed.marker} y`, [disagreed]).length, 0);
	// And the text half still says no on its own.
	assert.equal(citationSpan("nothing here", agreed), null);
});

test("text arriving into an open span ends the capture instead of joining the secret", () => {
	/*
	 * The reference refuses to mirror it (`editor.py:6312-6323`) — "leave the
	 * value untouched rather than silently corrupting it" — and the port takes
	 * that answer as an ABANDONED capture, because the arriving text would
	 * otherwise sit among the mask cells and desynchronise the run the mint
	 * splices (`pastePassthrough` takes the same answer for the blank-paste case,
	 * citing this same reference). Dropping a filename onto the composer used to
	 * append it to the held value: the pill's count changed and the secret was
	 * wrong (code review round 1, MINOR-3).
	 */
	const composer = harness();
	composer.type("/credential ");
	composer.type("sk-");
	const span = maskSpan(composer.state.capture);
	assert.deepEqual(span, { start: 12, end: 15 });
	// A drop lands INSIDE the span, as the DOM would apply it.
	composer.domEdit(13, 13, "dropped-file.txt");
	assert.equal(
		composer.state.capture.value,
		"",
		"the dropped text did not join the held value",
	);
	assert.equal(
		isTyping(composer.state.capture),
		false,
		"the typed capture ended rather than absorbing the drop",
	);
	assert.ok(
		isArmed(composer.state.capture),
		"the ARM survives, so the gesture is still one space away",
	);
	assert.ok(composer.state.buffer.includes("dropped-file.txt"));
	// A DELETION is still the operator's own edit and is still mirrored: the
	// cells and the held value can never disagree in LENGTH, which is the
	// invariant the pill's count and the mint's splice both rest on.
	const editing = harness();
	editing.type("/credential ");
	editing.type("abcdef");
	editing.domEdit(14, 15, "");
	assert.equal(
		charsOf(editing.state.buffer).filter((c) => c === MASK_CELL).length,
		5,
	);
	assert.equal(charsOf(editing.state.capture.value).length, 5);
});

test("the list answer's names come from the objects the runtime sends", () => {
	/*
	 * `{"ok": true, "credentials": [{"key": …, "source": …}]}`
	 * (`local_operator/session/credential_ops.py:59-64`). Read as `string[]`, the
	 * guard's `taken` set never matched a name the session already held, so §8's
	 * "consulted rather than trusted to probability" was inert — and
	 * `CredentialPicker` rendered the object as a React child and crashed the
	 * renderer (React #31). One reading, both callers (QA round 1, Q3).
	 */
	assert.deepEqual(
		credentialNamesFrom({
			data: {
				ok: true,
				credentials: [
					{ key: "LOP_SECRET_ABCDEFGH", source: "command" },
					{ key: "LOP_SECRET_JKMNPQRSTV", source: "command" },
				],
			},
		}),
		["LOP_SECRET_ABCDEFGH", "LOP_SECRET_JKMNPQRSTV"],
	);
	// Total: anything unexpected is an empty list rather than a crash.
	assert.deepEqual(credentialNamesFrom(undefined), []);
	assert.deepEqual(credentialNamesFrom({ data: { credentials: "nope" } }), []);
	assert.deepEqual(
		credentialNamesFrom({ data: { credentials: [{}, null, 3] } }),
		[],
	);
	// The older spelling still narrows the guard rather than emptying it.
	assert.deepEqual(
		credentialNamesFrom({ data: { credentials: ["OLD_NAME"] } }),
		["OLD_NAME"],
	);
});

test("a minted name dodges one the session's store already holds", () => {
	/*
	 * §8's collision guard, end to end on the real path: the names come from the
	 * list answer through the SAME reader the composer uses, and the draw is
	 * forced to offer the taken name first. With the misparse in place the set
	 * was empty, so the guard accepted the first candidate it drew.
	 */
	const taken = credentialNamesFrom({
		data: { credentials: [{ key: "LOP_SECRET_ABCDEFGH" }] },
	});
	assert.deepEqual(taken, ["LOP_SECRET_ABCDEFGH"]);
	// The draw is a per-character index into the alphabet, so the two candidates
	// are spelled as two runs of indices the way `cryptoDraw` supplies them.
	const drawn = ["ABCDEFGH", "JKMNPQRSTV"];
	const indices = drawn.flatMap((word) =>
		charsOf(word).map((char) => CREDENTIAL_KEY_ALPHABET.indexOf(char)),
	);
	let at = 0;
	const key = generateCredentialKey(
		taken,
		() => indices[at++ % indices.length],
	);
	assert.equal(key, "LOP_SECRET_JKMNPQRS", "the taken name is skipped");
	// The control: with nothing taken, the very same draw is accepted as it
	// stands, which is what makes the assertion above about the GUARD rather
	// than about the draw.
	let again = 0;
	assert.equal(
		generateCredentialKey([], () => indices[again++ % indices.length]),
		"LOP_SECRET_ABCDEFGH",
	);
});

test("an Esc cancel reports the token it left inert, and an edit that moves it ends that", () => {
	/*
	 * The submission seam's half of §5 (QA round 1, Q2): the notice promises
	 * "Enter will expose them", and the dispatcher then took the leading token as
	 * the COMMAND — opening the picker and stripping the restored prose out of
	 * the operator's sentence. The composer asks `holdsCancelledToken` instead,
	 * which is a question about the buffer and so is cleared by precisely the
	 * edits that move the token.
	 */
	const composer = harness();
	composer.type("/credential ");
	composer.type("hunter2");
	composer.escape();
	const { token } = composer.state.lastCancel;
	/*
	 * `restored` IS PART OF THE TOKEN NOW (review round 3, MINOR 1). The submit seam
	 * has to know whether this cancel put characters back — an empty span restores
	 * nothing, so the words written after it are the operator's own prose, while a
	 * span that held characters leaves a secret in the box — and the record of the
	 * gesture is where that fact belongs, because nothing later can tell the two
	 * apart from the buffer.
	 */
	/*
	 * `restoredText` moved with the count (UX round 6, U24): the composer needed the
	 * characters themselves to answer "is the run still in this draft?", because a count
	 * alone let a cleared box and a fresh sentence be read as the run's draft. Both
	 * halves of this pair assert it — the characters here, and the empty string for the
	 * span that put nothing back.
	 */
	assert.deepEqual(token, {
		span: { start: 0, end: 12 },
		text: "/credential ",
		restored: 7,
		restoredText: "hunter2",
	});
	assert.ok(holdsCancelledToken(composer.state.buffer, token));
	// Prose written AROUND the restored characters leaves it standing — this is
	// the draft the notice is about, and Enter must send it as it reads.
	assert.ok(holdsCancelledToken("/credential hunter2 tonight", token));
	// An edit that MOVES the token clears it.
	assert.equal(holdsCancelledToken("please /credential hunter2", token), false);
	assert.equal(holdsCancelledToken("/cred hunter2", token), false);
	assert.equal(holdsCancelledToken("", token), false);
	// THE EMPTY-SPAN CANCEL REPORTS THE TOKEN TOO (UX round 2, U9), and the
	// reason is that the promise and the SUBMIT rule are two different questions.
	// The notice is suppressed here — nothing was restored, so there is nothing to
	// warn about — but `/credential ` + Esc + `mysecretname` + Enter used to reach
	// the dispatcher, which read the leading token as the COMMAND, opened the
	// picker, ate the operator's words as its argument and stripped them out of
	// the box. Nothing sent, nothing said. With the token reported, the run the
	// cancel left behind is inert to submit exactly as the restored one is.
	const empty = harness();
	empty.type("/credential ");
	empty.escape();
	assert.deepEqual(empty.state.lastCancel.token, {
		span: { start: 0, end: 12 },
		text: "/credential ",
		restored: 0,
		restoredText: "",
	});
	assert.equal(empty.state.lastCancel.restored, 0);
	// The characters the operator writes AFTER an empty-span cancel land after
	// the run, so the run is still there — and that is the whole of U9: the same
	// visible buffer behaved as prose when the span had held characters and as a
	// command when it had not.
	const typed = harness();
	typed.type("deploy with /credential ");
	typed.escape();
	typed.type("mysecretname");
	assert.equal(typed.state.buffer, "deploy with /credential mysecretname");
	assert.ok(
		holdsCancelledToken(typed.state.buffer, typed.state.lastCancel.token),
	);
	// The half that must NOT change: with no cancel at all, `/credential <args>`
	// is still the command's own line. Nothing registered a token, so nothing
	// suppresses the dispatcher; the composer suite pins what the dispatcher then
	// does with the arguments (`/credential --forget-all` still strips them).
	const uncancelled = harness();
	uncancelled.type("/credential --forget-all");
	assert.equal(uncancelled.state.lastCancel, undefined);
	assert.equal(holdsCancelledToken("/credential --forget-all", null), false);
});

test("the armed token is painted, not only announced", () => {
	/*
	 * Design round 1, D2. The TUI marks the armed token twice over
	 * (`local_operator.tui.local_operator.tcss:624`: the amber run and the glyph
	 * swap); the port carried neither, so the only cue was one muted sentence.
	 * The mirror can carry one of them, and this is the plan that does it.
	 */
	const armed = { arm: { start: 4, end: 16 }, typingAt: null, value: "" };
	const plan = paintPlan("use /credential", new Map(), armed);
	assert.deepEqual(plan, [
		{ kind: "plain", text: "use " },
		{ kind: "armed", text: "/credential" },
	]);
	// While the span is open the token is STILL the armed token, and the mask is
	// the run after it — the two never overlap.
	const typingComposer = harness();
	typingComposer.type("use /credential ");
	typingComposer.type("sk");
	const maskedPlan = paintPlan(
		typingComposer.state.buffer,
		new Map(),
		typingComposer.state.capture,
	);
	assert.deepEqual(
		maskedPlan.map((segment) => segment.kind),
		["plain", "armed", "mask"],
	);
	// An idle capture paints nothing, which is what keeps the overlay unmounted
	// for every composer that is not in this gesture.
	assert.deepEqual(paintPlan("just prose", new Map(), IDLE_CAPTURE), [
		{ kind: "plain", text: "just prose" },
	]);
});

test("the arming token survives text edited before it and is dropped with it", () => {
	// The token slides as the operator edits text ahead of it; the arm follows
	// the token's own identity, not its old offset (`_relocate_armed_token`).
	const composer = harness();
	composer.type("with /credential");
	composer.caretTo(0);
	composer.type("deploy ");
	assert.deepEqual(composer.state.capture.arm, {
		start: "deploy with /credential".indexOf("/credential"),
		end: "deploy with /credential".length,
	});
	// Deleting the token withdraws the gesture — the visible way to un-arm.
	composer.caretTo(composer.state.buffer.length);
	for (let i = 0; i < "/credential".length; i++) composer.backspace();
	assert.equal(composer.state.capture.arm, null);
});

test("re-location prefers the anchored token, then the only match, then nearest", () => {
	assert.deepEqual(tokenSpans("a /cred b /credential c"), [
		{ start: 2, end: 7 },
		{ start: 10, end: 21 },
	]);
	// The anchored word wins outright.
	assert.deepEqual(
		relocateArm("a /cred b /credential c", { start: 10, end: 21 }),
		{
			start: 10,
			end: 21,
		},
	);
	// A single match is the answer however far the text before it moved.
	assert.deepEqual(
		relocateArm(`${"x".repeat(400)} /cred`, { start: 2, end: 5 }),
		{
			start: 401,
			end: 406,
		},
	);
	// Two matches and the latch gone from its own offset: nearest wins.
	assert.deepEqual(
		relocateArm("a /cred b /credential c", { start: 12, end: 12 }),
		{ start: 10, end: 21 },
	);
	// No token at all: the gesture is gone.
	assert.equal(relocateArm("nothing here", { start: 0, end: 0 }), null);
	/*
	 * The U6 TYPED-THROUGH CASE (UX round 2, U6; code review round 1, MAJOR 1).
	 *
	 * While the operator re-types the token it armed on — `/credential` seen
	 * again one character at a time — the middle spellings match NEITHER token
	 * regex, so without rule 0 the latched arm found nothing at its own anchor
	 * and the nearest-match tie-break handed it to the `/credential` earlier in
	 * the line. That migration is one-way, so the arm never came home, the
	 * opener space never opened a span, and the next secret was typed into the
	 * document in plaintext.
	 */
	const typedThroughBuffer = "use /credential here\n/credential";
	const secondToken = typedThroughBuffer.lastIndexOf("/credential");
	const full = secondToken + "/credential".length;
	assert.equal(secondToken, 21, "the SECOND token sits on the second line");
	assert.deepEqual(
		relocateArm(typedThroughBuffer, { start: secondToken, end: full }),
		{
			start: secondToken,
			end: full,
		},
	);
	// One character short of the full spelling, and well past the floor: still
	// the operator's own gesture, so the arm stays on it.
	const shortened = typedThroughBuffer.slice(0, -1);
	assert.deepEqual(relocateArm(shortened, { start: secondToken, end: full }), {
		start: secondToken,
		end: shortened.length,
	});
	// Below the floor the word is a deletion, not a gesture in progress: the
	// single ordinary token earlier in the buffer is the only answer left.
	assert.deepEqual(
		relocateArm("use /credential here\n/cre", {
			start: secondToken,
			end: secondToken + 4,
		}),
		{
			start: 4,
			end: 15,
		},
	);
	// A LONGER word that merely starts with the token is not a PREFIX of it, so
	// it is not the operator's gesture either.
	assert.deepEqual(
		relocateArm("use /credential here\n/credentials", {
			start: secondToken,
			end: secondToken + 12,
		}),
		{ start: 4, end: 15 },
	);
});

test("a token retyped through a partial spelling keeps the arm, so no secret lands as text", () => {
	const composer = harness();
	// The buffer ARRIVES with the earlier mention in it (nothing armed), and the
	// operator types the second token — which is the shape that arms the LATER
	// token and is the only shape rule 0 can protect.
	composer.arrive("use /credential here\n");
	assert.equal(composer.state.capture.arm, null);
	composer.type("/credential ");
	const anchor = composer.state.capture.arm.start;
	assert.equal(anchor, 21, "the SECOND token is the one armed");
	assert.ok(isTyping(composer.state.capture));
	// Backspace the delimiter, then into the token: the anchor's own word is now
	// a partial spelling, and the arm must stay on it rather than migrating onto
	// the earlier mention.
	composer.backspace();
	composer.backspace();
	assert.equal(
		composer.state.capture.arm.start,
		anchor,
		"the arm did not migrate onto the earlier token",
	);
	composer.type("l ");
	assert.ok(
		isTyping(composer.state.capture),
		"the re-typed opener space opens the span again",
	);
	composer.type("S3CRET");
	assert.equal(composer.state.capture.value, "S3CRET");
	assert.ok(
		!composer.state.buffer.includes("S3CRET"),
		"the secret is held, never in the document",
	);
});

/*
 * ---------------------------------------------------------------------------
 * §3 — masking
 * ---------------------------------------------------------------------------
 */

test("one mask cell per printable character, the delimiter not counted", () => {
	const composer = harness();
	composer.type("/credential ");
	const value = "aZ9!@#$%^&*()_+-=[]{};':\",./<>?";
	composer.type(value);
	assert.equal(
		composer.state.capture.value,
		value,
		"punctuation is captured as characters, not as key names",
	);
	assert.equal(
		composer.state.buffer,
		`/credential ${MASK_CELL.repeat(value.length)}`,
		"the document holds one cell per character and nothing else",
	);
	/*
	 * WHICH IS THE WHOLE OF THE INVARIANT: not one character of the value is
	 * anywhere in the document. The gate that decides this is PRINTABLE
	 * CHARACTERS, never key names — the TUI documents the measured leak this
	 * fixes (`editor.py:2948-2959`): punctuation keys arrive spelled as words
	 * (`minus`, `full_stop`), so a `len(key) == 1` gate masked letters and digits
	 * while every punctuation character fell straight through. The canary
	 * `zQ7-TYPED-LEAK-CANARY-4417` rendered as `•••-TYPED-LEAK-CANARY-4417`.
	 */
	const visible = composer.state.buffer.slice("/credential ".length);
	for (const char of charsOf(value)) {
		assert.ok(
			char === MASK_CELL || char === "-" || !visible.includes(char),
			`${JSON.stringify(char)} must not be visible`,
		);
	}
	assert.equal(
		composer.state.capture.value.length,
		composer.state.buffer.length - "/credential ".length,
		"the delimiting space is the opener and is not counted",
	);
});

test("a space typed inside the span is part of the secret", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.type("two words");
	assert.equal(composer.state.capture.value, "two words");
	assert.equal(
		composer.state.buffer,
		`/credential ${MASK_CELL.repeat(9)}`,
		"nine cells for nine characters, the delimiting space excluded",
	);
});

test("a multi-line secret reports characters and never lines", () => {
	/*
	 * Through the PASTE route, which takes the whole value in one edit. A typed
	 * newline does NOT do this — see the shift+enter test below — because a
	 * newline inside the contiguous cell run desynchronises the mint's splice.
	 */
	const composer = harness();
	composer.type("/credential ");
	const value = "-----BEGIN KEY-----\nAAAA\n-----END KEY-----";
	composer.paste(value);
	const payload = [...composer.state.payloads.values()][0];
	assert.equal(payload.value, value);
	// `_credential_label`: `<n> chars`, never `<n> lines`. A line count is the
	// weakest integrity check exactly where truncation hides, as in a PEM block.
	assert.equal(payload.marker, `[Credential #1, ${value.length} chars]`);
	assert.ok(!HAS_LINES.test(payload.marker));
	// And the document never held any of it.
	assert.ok(!composer.state.buffer.includes("AAAA"));
});

test("shift+enter ends the capture rather than being masked", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.type("abc");
	composer.newline();
	assert.equal(isTyping(composer.state.capture), false, "the capture ended");
	assert.equal(
		composer.state.capture.value,
		"",
		"abandoned, never cancelled: the held characters are not written out",
	);
	assert.ok(
		!composer.state.buffer.includes("abc"),
		"and never entered the document",
	);
	assert.ok(composer.state.buffer.includes("\n"), "the newline lands as usual");
});

test("a leading - escapes the mask, so /credential --forget-all stays reachable", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.type("-");
	assert.equal(
		composer.state.buffer,
		"/credential -",
		"the flag lands as plaintext, not as a masked character",
	);
	assert.equal(composer.state.capture.value, "");
	assert.equal(
		composer.state.capture.arm,
		null,
		"and the flag rule ends the gesture, exactly as it does for a pasted one",
	);
	composer.type("-forget-all");
	assert.equal(composer.state.buffer, "/credential --forget-all");
	// A `-` that is NOT the first character of the span is part of the secret.
	const inside = harness();
	inside.type("/credential ");
	inside.type("sk-");
	assert.equal(inside.state.capture.value, "sk-");
	assert.equal(inside.state.buffer, `/credential ${MASK_CELL.repeat(3)}`);
});

test("the caret leaving the span ends the typing state without disclosing", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.type("12345");
	composer.caretTo(0);
	assert.equal(isTyping(composer.state.capture), false, "the capture ended");
	assert.ok(
		!composer.state.buffer.includes("12345"),
		"and did not write the secret out",
	);
	// The cells stay where they were: a caret move is not a request to delete
	// what the operator can see, and it is not a request for the plaintext back.
	assert.equal(composer.state.buffer, `/credential ${MASK_CELL.repeat(5)}`);
});

/*
 * ---------------------------------------------------------------------------
 * §3 — positional edits
 * ---------------------------------------------------------------------------
 */

test("arrow-then-type splices the value where the operator watched it land", () => {
	/*
	 * UX round 1's U1, the defect the mirror exists for: an append gave the chip
	 * the right LENGTH with the wrong ORDER, so the integrity check passed on a
	 * value that can never be displayed again to catch it.
	 */
	const composer = harness();
	composer.type("/credential ");
	composer.type("ABCDEFGH");
	composer.caretTo(composer.state.caret - 2);
	composer.type("xy");
	assert.equal(composer.state.capture.value, "ABCDEFxyGH");
	assert.equal(composer.state.buffer, `/credential ${MASK_CELL.repeat(10)}`);
});

test("Backspace and Delete remove the character the cell stood for", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.type("abcd");
	composer.backspace();
	assert.equal(composer.state.capture.value, "abc");
	assert.equal(composer.state.buffer, `/credential ${MASK_CELL.repeat(3)}`);
	composer.caretTo(12 + 1);
	composer.del();
	assert.equal(
		composer.state.capture.value,
		"ac",
		"Delete takes the cell ahead",
	);
	assert.equal(composer.state.buffer, `/credential ${MASK_CELL.repeat(2)}`);
});

test("select-and-replace lands in the value at the selected cells", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.type("abcdef");
	composer.caretTo(12 + 2);
	composer.replaceSelection(12 + 5, "X");
	assert.equal(composer.state.capture.value, "abXf");
	assert.equal(composer.state.buffer, `/credential ${MASK_CELL.repeat(4)}`);
	// A selection that STRADDLES the span's edge removes only the held part, and
	// the caret it leaves inside the span keeps the capture open.
	const straddle = harness();
	straddle.type("/credential ");
	straddle.type("abc");
	straddle.caretTo(12 + 2);
	straddle.replaceSelection(12 + 20, "");
	assert.equal(
		straddle.state.capture.value,
		"ab",
		"only the part inside the span",
	);
	assert.equal(straddle.state.buffer, `/credential ${MASK_CELL.repeat(2)}`);
	assert.ok(isTyping(straddle.state.capture));
});

test("an edit outside the span is ordinary text and never masked", () => {
	// The caret must be inside the span for the capture to be live at all (§3),
	// so text typed elsewhere in the buffer is prose.
	const composer = harness();
	composer.type("/credential ");
	composer.type("abc");
	composer.caretTo(0);
	composer.typeKeystroke("x");
	assert.equal(composer.state.buffer, `x/credential ${MASK_CELL.repeat(3)}`);
	assert.equal(isTyping(composer.state.capture), false);
});

/*
 * ---------------------------------------------------------------------------
 * §4 — Enter mints the pill
 * ---------------------------------------------------------------------------
 */

test("Enter consumes token + space + every cell in ONE edit and lands past it", () => {
	const composer = harness();
	composer.type("deploy with /credential ");
	composer.type("hunter2");
	const tokenStart = "deploy with ".length;
	const before = composer.state.buffer;
	const result = composer.enter();
	assert.ok(result.minted);
	// ONE edit: the only difference between the buffers is the replaced range.
	assert.equal(
		result.buffer,
		"deploy with [Credential #1, 7 chars] ",
		"the token, its space and every cell are gone; the marker carries its own space",
	);
	assert.ok(before.slice(0, tokenStart) === result.buffer.slice(0, tokenStart));
	// The caret lands after the marker's trailing space, so prose continues
	// inline in the middle of a sentence.
	assert.equal(result.caret, "deploy with [Credential #1, 7 chars] ".length);
	assert.equal(result.payload.marker, "[Credential #1, 7 chars]");
	// The mint leaves the composer ready for the next sentence, with no capture
	// open and no value held.
	assert.equal(result.capture.arm, null);
	assert.equal(result.capture.typingAt, null);
	assert.equal(result.capture.value, "");
});

test("the marker is exactly the TUI's format and parses back to its index", () => {
	assert.equal(
		credentialMarker(3, "x".repeat(64)),
		"[Credential #3, 64 chars]",
	);
	CREDENTIAL_MARKER.lastIndex = 0;
	const match = CREDENTIAL_MARKER.exec("[Credential #3, 64 chars]");
	assert.ok(match);
	assert.equal(Number(match[1]), 3);
	assert.equal(Number(match[2]), 64);
});

test("an empty span mints nothing and the capture stays open", () => {
	const composer = harness();
	composer.type("/credential ");
	const result = composer.enter();
	assert.equal(result.minted, false);
	assert.equal(composer.state.payloads.size, 0, "no key is advertised");
	assert.ok(isTyping(composer.state.capture), "the capture stays open");
	assert.equal(
		composer.state.buffer,
		"/credential ",
		"and leaves the token for the dispatcher to consume",
	);
});

test("a pill can be minted at the start of a line and mid-prose alike", () => {
	const leading = harness();
	leading.type("/credential ");
	leading.type("aaa");
	leading.enter();
	assert.equal(leading.state.buffer, "[Credential #1, 3 chars] ");

	const midLine = harness();
	midLine.type("use /credential ");
	midLine.type("bbb");
	midLine.enter();
	assert.equal(midLine.state.buffer, "use [Credential #1, 3 chars] ");
	// The token was consumed, so the line no longer starts with a slash command
	// — the leading-slash path cannot fire on a minted pill.
	assert.ok(!midLine.state.buffer.startsWith("/"));
});

test("the index counts within the composer and resets to the next free number", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.type("one");
	composer.enter();
	composer.type(" and /credential ");
	composer.type("two");
	composer.enter();
	assert.equal(
		composer.state.buffer,
		"[Credential #1, 3 chars]  and [Credential #2, 3 chars] ",
	);
	assert.deepEqual(
		[...composer.state.payloads.values()].map((p) => p.index),
		[1, 2],
	);
});

/*
 * ---------------------------------------------------------------------------
 * §5 — Escape
 * ---------------------------------------------------------------------------
 */

test("Esc restores the typed characters as plaintext and reports the length", () => {
	const composer = harness();
	composer.type("deploy with /credential ");
	composer.type("hunter2");
	const result = composer.escape();
	assert.ok(result.cancelled);
	assert.equal(
		composer.state.buffer,
		"deploy with /credential hunter2",
		"the characters come back as ordinary text; the token is left inert",
	);
	assert.equal(
		result.restored,
		7,
		"the announcement's length, never the value",
	);
	assert.equal(
		unredactedNotice(result.restored),
		"7 characters are now PLAIN TEXT in the composer — Enter will expose them",
	);
	assert.equal(composer.state.payloads.size, 0, "nothing is held");
	assert.equal(
		isArmed(composer.state.capture),
		false,
		"and the arm ends with it",
	);
});

test("the ARMING POWER belongs to the completion and the keystroke, and to no other route", () => {
	/*
	 * Code review round 2, MINOR 1: the composer's pick pin asserted that the
	 * completion is CONSULTED, not that the route can arm — and the reviewer
	 * measured that swapping `"completion"` for `"caret"` at that call site
	 * survives every case in the composer suite. Re-measured here: it does, and
	 * the reason is not a missing pin, it is that the two are indistinguishable
	 * THERE. `handleSlashPick` writes through `applyCapture`, the write reaches
	 * the controlled textarea, and the textarea's own `onChange` mirrors it as
	 * `"typing"` — the other origin `mayArm` accepts — so the capture arms on the
	 * mirror whatever the pick said.
	 *
	 * Where the power IS observable is the module, and that is what this case
	 * pins: given the same buffer and caret, the completion arms and a caret move
	 * does not. Deleting `|| arrival === "completion"` from `mayArm`, or adding
	 * `"caret"` to it, fails here — which is the statement the composer's call
	 * site is making when it names `"completion"` (and why naming it is not
	 * decoration).
	 */
	const byCompletion = harness();
	byCompletion.state.buffer = "/credential";
	byCompletion.state.caret = 11;
	byCompletion.acceptCompletion(" ");
	assert.deepEqual(
		byCompletion.state.capture.arm,
		{ start: 0, end: 12 },
		"the row's own trailing space arms the capture",
	);

	const byCaret = harness();
	byCaret.state.buffer = "/credential ";
	byCaret.state.caret = 12;
	byCaret.caretTo(12);
	assert.equal(
		byCaret.state.capture.arm,
		null,
		"the same buffer, reached by a caret move, does not arm: §2's caret origin carries no arming power",
	);

	// And the keystroke still does, which is what the picker's write becomes
	// through the textarea's own onChange.
	const byTyping = harness();
	byTyping.type("/credential ");
	assert.ok(byTyping.state.capture.arm, "a typed trailing space arms");
});

test("Esc on an empty span ends the mode and leaves the token inert", () => {
	const composer = harness();
	composer.type("/credential ");
	const result = composer.escape();
	assert.ok(result.cancelled);
	assert.equal(
		result.restored,
		0,
		"nothing to restore, so nothing to announce",
	);
	assert.equal(composer.state.buffer, "/credential ");
	assert.equal(isArmed(composer.state.capture), false);
	assert.equal(isTyping(composer.state.capture), false);
	/*
	 * THE NO-RE-ARM RULE (the TUI's R1/U2, shipped twice): after the cancel the
	 * buffer still ends in the token, so a cancel that re-entered the arm sync
	 * re-armed itself and made Esc inert while the prose typed next became a
	 * credential. The disarm is explicit, and the operator's next character
	 * makes the line stop matching on its own.
	 */
	const after = syncCapture(
		composer.state.capture,
		"/credential H",
		"/credential H".length,
		"typing",
	);
	assert.equal(after.arm, null, "the prose typed after a cancel never re-arms");
	// Typing into the restored plaintext is ordinary text, masked nowhere.
	composer.typeKeystroke("H");
	assert.equal(composer.state.buffer, "/credential H");
	assert.equal(isTyping(composer.state.capture), false);
});

test("Esc while armed with no space does not disarm", () => {
	// §5's other arm: only the TYPING sub-state has an Escape meaning. With the
	// popup open it closes the popup; otherwise it keeps its existing meaning.
	const composer = harness();
	composer.type("/credential");
	const result = composer.escape();
	assert.equal(result.cancelled, false, "no span is open, so Esc is not ours");
	assert.ok(isArmed(composer.state.capture), "the arm survives");
});

/*
 * ---------------------------------------------------------------------------
 * §5 — paste
 * ---------------------------------------------------------------------------
 */

test("a paste while armed captures instantly, in one edit, and disarms", () => {
	const composer = harness();
	composer.type("take this /credential ");
	composer.paste("  sk-live-0123456789  ");
	const result = composer.state.lastPaste;
	assert.equal(result.kind, "minted");
	assert.equal(
		composer.state.buffer,
		"take this [Credential #1, 18 chars] ",
		"one edit: the token is replaced by the receipt",
	);
	assert.equal(
		result.payload.value,
		"sk-live-0123456789",
		"trimmed, never masked",
	);
	assert.equal(composer.state.capture.arm, null, "the capture disarms");
	// A second paste means retyping the token; the first marker stays cited and
	// its payload untouched — "it is not a replacement".
	composer.paste("another");
	assert.equal(
		composer.state.buffer,
		"take this [Credential #1, 18 chars] another",
	);
	assert.equal(composer.state.payloads.size, 1);
});

test("a paste into a non-empty span appends to the SAME secret, masked", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.type("sk-");
	composer.paste("live-999");
	assert.equal(composer.state.capture.value, "sk-live-999");
	assert.equal(
		composer.state.buffer,
		`/credential ${MASK_CELL.repeat(11)}`,
		"the pasted characters never enter the document either",
	);
	assert.equal(
		composer.state.payloads.size,
		0,
		"no second pill: one credential",
	);
});

test("a paste into an EMPTY open span closes it and mints in place", () => {
	const composer = harness();
	composer.type("/credential ");
	assert.ok(isTyping(composer.state.capture));
	composer.paste("sk-live-1");
	assert.equal(composer.state.buffer, "[Credential #1, 9 chars] ");
	assert.equal(isTyping(composer.state.capture), false);
	assert.equal(composer.state.payloads.size, 1);
});

test("an empty or whitespace-only paste captures nothing and lands as text", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.paste("   ");
	assert.equal(composer.state.payloads.size, 0, "a blank advertises no key");
	assert.equal(
		composer.state.buffer,
		"/credential    ",
		"the whitespace is the operator's own text, not part of a secret",
	);
	assert.equal(composer.state.capture.value, "", "and captures nothing");
	assert.ok(isTyping(composer.state.capture), "the capture is still open");
	// The blank did not desynchronise the pair: the next typed character is
	// still masked, and the receipt counts the secret and not the whitespace.
	composer.type("ab");
	assert.equal(composer.state.capture.value, "ab");
	assert.equal(composer.state.buffer, `/credential    ${MASK_CELL.repeat(2)}`);
	const empty = harness();
	empty.type("/credential ");
	empty.paste("");
	assert.equal(empty.state.payloads.size, 0);
	assert.equal(empty.state.buffer, "/credential ");
});

test("a second capture needs the token retyped, and cites its own payload", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.paste("first");
	composer.type(" and ");
	composer.type("/credential ");
	composer.paste("second");
	assert.equal(composer.state.payloads.size, 2);
	assert.deepEqual(
		[...composer.state.payloads.values()].map((p) => p.value),
		["first", "second"],
	);
	assert.equal(
		composer.state.buffer,
		"[Credential #1, 5 chars]  and [Credential #2, 6 chars] ",
	);
});

test("the caret returning to the token re-opens the capture", () => {
	// `test_the_caret_returning_to_the_token_re_opens_the_capture`: the span is
	// POSITIONAL, open exactly while the caret is in it. Without the re-open, a
	// token left armed after a caret move kept its span open, so the next typed
	// character landed in PLAINTEXT — the capture only ever opened on the edit
	// that inserted the space, and that space had already been typed.
	const composer = harness();
	composer.type("/credential ");
	composer.caretTo(0);
	assert.equal(isTyping(composer.state.capture), false);
	composer.caretTo("/credential ".length);
	assert.ok(
		isTyping(composer.state.capture),
		"back in the span, masking again",
	);
	composer.type("9999");
	assert.ok(!composer.state.buffer.includes("9999"));
});

test("a caret move never arms the gesture by itself", () => {
	// §2: only typing arms. A click at the end of a restored draft that happens
	// to read `/credential ` must not turn the next paste into a secret — which
	// is why the caret's own origin may open an existing arm but never make one.
	const composer = harness();
	composer.arrive("deploy with /credential ");
	composer.caretTo("deploy with /credential ".length);
	assert.equal(isArmed(composer.state.capture), false);
	composer.paste("hunter2");
	assert.equal(composer.state.buffer, "deploy with /credential hunter2");
	assert.equal(composer.state.payloads.size, 0);
});

/*
 * ---------------------------------------------------------------------------
 * §8 — naming
 * ---------------------------------------------------------------------------
 */

test("the name is prefix + 8 symbols from the lookalike-free alphabet", () => {
	const key = generateCredentialKey([], drawFrom([0, 1, 2, 3, 4, 5, 6, 7]));
	assert.equal(key, `${CREDENTIAL_KEY_PREFIX}ABCDEFGH`);
	assert.match(key, KEY_SHAPE);
	// The alphabet is THIRTY symbols, not the 31 §8 of the design document
	// claims: `O`, `I`, `L`, `U`, `0` and `1` are excluded against base32's 32.
	assert.equal(CREDENTIAL_KEY_ALPHABET.length, 30);
	for (const excluded of ["O", "I", "L", "U", "0", "1"]) {
		assert.ok(!CREDENTIAL_KEY_ALPHABET.includes(excluded));
	}
	// 8 characters over 30 symbols is 39.3 bits, which is the figure the
	// document's own reasoning gives for this alphabet.
	assert.ok(Math.abs(Math.log2(30) * 8 - 39.26) < 0.01);
});

test("the name satisfies the backend's own pattern and length bound", () => {
	for (let i = 0; i < 200; i++) {
		const key = generateCredentialKey([]);
		assert.match(
			key,
			CREDENTIAL_KEY_PATTERN,
			`${key} must round-trip the store`,
		);
		assert.ok(isStorableCredentialKey(key));
	}
	// The widened fallback is 16 symbols and still storable.
	assert.ok(
		isStorableCredentialKey(`${CREDENTIAL_KEY_PREFIX}${"A".repeat(16)}`),
	);
	assert.ok(!CREDENTIAL_KEY_PATTERN.test("LOP-SECRET-ABC"));
});

test("a collision is avoided against the session's names AND the composer's", () => {
	/*
	 * A collision SILENTLY REPLACES a live credential (`store_credential`
	 * overwrites), so `taken` is consulted rather than trusted to probability —
	 * and it must include the names the session already holds, because the
	 * composer's own map resets on every submit and cannot see the credential
	 * handed over ten minutes ago (review round 1, R3).
	 */
	const colliding = `${CREDENTIAL_KEY_PREFIX}ABCDEFGH`;
	const taken = [colliding, `${CREDENTIAL_KEY_PREFIX}ABCDEFGJ`];
	// The stub draws the colliding name first, then a distinct one, which is the
	// sequence the guard has to walk past.
	const draw = drawFrom([0, 1, 2, 3, 4, 5, 6, 7, 9, 1, 2, 3, 4, 5, 6, 7]);
	const key = generateCredentialKey(taken, draw);
	assert.ok(!taken.includes(key), `${key} must not clobber a live credential`);
	assert.equal(key, `${CREDENTIAL_KEY_PREFIX}KBCDEFGH`);

	// The composer's in-flight keys are unioned with the session's names by the
	// caller (§8), and the union is what the mint consults at Enter time.
	const composer = harness();
	composer.state.sessionNames = [`${CREDENTIAL_KEY_PREFIX}ABCDEFGH`];
	composer.type("/credential ");
	composer.type("one");
	const first = composer.enter();
	assert.notEqual(first.payload.key, `${CREDENTIAL_KEY_PREFIX}ABCDEFGH`);
	const takenNow = [
		...composer.state.sessionNames,
		...[...composer.state.payloads.values()].map((p) => p.key),
	];
	assert.ok(
		takenNow.includes(first.payload.key),
		"in-flight keys are in `taken`",
	);
});

test("the mint can never spin: 16 collisions widen the name instead", () => {
	// A draw that only ever produces the colliding suffix.
	const stub = () => 0;
	const colliding = `${CREDENTIAL_KEY_PREFIX}${"A".repeat(8)}`;
	const key = generateCredentialKey([colliding], stub);
	assert.equal(key, `${CREDENTIAL_KEY_PREFIX}${"A".repeat(16)}`);
	assert.ok(isStorableCredentialKey(key));
});

test("the value never reaches the outgoing text and the citation does", () => {
	const composer = harness();
	composer.type("deploy with /credential ");
	composer.type("hunter2-canary");
	composer.enter();
	const sent = composer.submit();
	assert.ok(
		!sent.text.includes("hunter2-canary"),
		"the bytes are not in the prompt",
	);
	CREDENTIAL_MARKER.lastIndex = 0;
	assert.ok(
		!CREDENTIAL_MARKER.test(sent.text),
		"and neither is the composer-local marker",
	);
	const key =
		[...composer.state.payloads.values()][0]?.key ?? sent.cited[0].key;
	assert.equal(
		sent.text,
		`deploy with [credential ${key} (14 chars) — available to bash and eval as $${key}; its value cannot be read] `,
	);
	assert.equal(
		credentialCitation(sent.cited[0]),
		`[credential ${key} (14 chars) — available to bash and eval as $${key}; its value cannot be read]`,
	);
});

test("an uncited marker is never stored", () => {
	const composer = harness();
	composer.type("keep /credential ");
	composer.type("secret");
	composer.enter();
	// The operator selects the whole pill and deletes it: nothing cites it now.
	composer.caretTo(0);
	composer.replaceSelection(composer.state.buffer.length, "");
	const sent = composer.submit();
	assert.deepEqual(sent.cited, [], "a marker that is gone is not a citation");
	assert.equal(sent.text, "");
});

test("the not-stored phrase names the cause that actually applied", () => {
	assert.equal(
		describeUnstored("unreachable"),
		"[credential NOT stored — the session could not be reached; try again]",
	);
	assert.equal(
		describeUnstored("rejected-key"),
		"[credential NOT stored — the store rejected its name]",
	);
	assert.equal(
		describeUnstored("lost"),
		"[credential NOT stored — its value did not survive; ask the operator to paste it again]",
	);
});

test("a refused credential cites honestly beside one that landed", () => {
	/*
	 * Review round 1's R1 / QA's Q1 are the defect this pins: the caller used to
	 * decide once for the whole message, so one refusal among several successes
	 * still advertised a key nothing held.
	 */
	const composer = harness();
	composer.type("/credential ");
	composer.type("first");
	composer.enter();
	composer.type(" and /credential ");
	composer.type("second");
	composer.enter();
	const payloads = [...composer.state.payloads.values()];
	const refused = new Map([[payloads[1].index, "lost"]]);
	const sent = composer.submit({ refused });
	assert.ok(
		sent.text.includes(`$${payloads[0].key}`),
		"the stored one names its key",
	);
	assert.ok(
		!sent.text.includes(`$${payloads[1].key}`),
		"the refused one must not name a key nothing holds",
	);
	assert.ok(sent.text.includes(describeUnstored("lost")));
});

test("every citation is rewritten, stored or not, so no marker reaches the model", () => {
	const composer = harness();
	composer.type("/credential ");
	composer.type("only");
	composer.enter();
	const sent = composer.submit({ refused: new Map([[1, "unreachable"]]) });
	CREDENTIAL_MARKER.lastIndex = 0;
	assert.ok(!CREDENTIAL_MARKER.test(sent.text));
	assert.ok(
		sent.text.includes(describeUnstored("unreachable")),
		"the description survives; only the citation changes",
	);
});

test("a marker nothing backs is a not-stored citation, not prose to be guessed at", () => {
	/*
	 * §4's grammar decides which occurrence a PAYLOAD cites — the marker text must
	 * be the payload's own and the index must match — and that rule still holds
	 * for the citation itself. What round 2 changed is what happens to a marker
	 * that rule rejects (design round 2, D2 + UX round 2, U11 + code review round
	 * 2, MAJOR 1).
	 *
	 * It used to be sent VERBATIM as "prose", on the reasoning that the app cannot
	 * tell a hand-typed lookalike from its own receipt. But §6 persists the marker
	 * text deliberately while the value map dies with the document, so the
	 * COMMONEST instance of that shape is the app's own receipt coming back after
	 * a reload — and the model then received a composer-local
	 * `[Credential #1, 19 chars]` naming a key nothing holds. The shape is now
	 * treated as one thing: a citation of a value this composer cannot reach, sent
	 * as the not-stored sentence. A hand-typed lookalike is caught by the same rule
	 * because the rule CANNOT tell it apart, and a rule that guessed would be the
	 * paint/send disagreement this whole path exists to remove.
	 */
	const composer = harness();
	composer.type("/credential ");
	composer.type("real");
	composer.enter();
	const payload = [...composer.state.payloads.values()][0];
	const text = `${composer.state.buffer}my own [Credential #1, 999 chars] note, and [Credential #7, 4 chars]`;
	// The payload still cites only its OWN marker at its own index.
	assert.equal(citationSpan(text, payload).start, 0);
	const out = substituteCredentials(text, [payload]);
	assert.ok(out.includes(`$${payload.key}`), "the backed marker is cited");
	assert.ok(
		!out.includes("[Credential #1, 999 chars]"),
		"an edited tail is a marker no payload backs, so it is rewritten too",
	);
	assert.ok(!out.includes("[Credential #7, 4 chars]"));
	assert.equal(
		(out.match(/NOT stored/g) ?? []).length,
		2,
		"one not-stored citation per unbacked marker, and none for the backed one",
	);
});

test("a duplicated citation is cited once and not-stored after it", () => {
	/*
	 * The first occurrence is the one the payload cites (so it carries the real
	 * key); every copy after it names a value the model cannot use, so it takes
	 * the not-stored sentence rather than being passed through as text — the
	 * model cannot tell the two apart either.
	 */
	const composer = harness();
	composer.type("/credential ");
	composer.type("dup");
	composer.enter();
	const marker = composer.state.buffer.trim();
	const payload = [...composer.state.payloads.values()][0];
	const text = `${marker} ${marker}`;
	const out = substituteCredentials(text, [payload]);
	assert.ok(out.includes(`$${payload.key}`));
	assert.ok(
		!out.includes(marker),
		"no bare marker is left in the outgoing text",
	);
	assert.ok(out.includes(describeUnstored("lost")));
});

/*
 * ---------------------------------------------------------------------------
 * The notices (§4, §5, §9.4) — one authority per phrase
 * ---------------------------------------------------------------------------
 */

/*
 * §5/§6's ONE RULE FOR "does this count describe this buffer" (code review round
 * 4, MINOR 1).
 *
 * The rule has two callers and one answer: the RENDERED sentence asks it with the
 * render's own buffer, and the PERSISTED count asks it (through `disclosureOver`)
 * with the value it is about to write. It is pinned HERE, in the pure module,
 * because the DOM suite cannot tell it apart from the retirement effect that runs
 * in the same commit: with the `over` test dropped, every rendered case stayed
 * green (measured - 21/21 passing with the mutation in place), so the component
 * suite was pinning the effect while the record credited the derivation.
 *
 * What the rule prevents, and why a bare count is not enough: the sentence says
 * "N characters are now PLAIN TEXT in the composer", and the count travels in
 * the persisted draft. Unpaired, four backspaces left it claiming eleven over a
 * seven-character remnant, a cleared box retyped with ordinary prose re-persisted
 * the stale seven, and a restored marker could carry it into a transcript that
 * mentions no secret at all (UX round 3, U12).
 */
test("a disclosure count applies only to the buffer it was taken over", () => {
	const held = { chars: 11, over: "/credential BACKSPACE-1" };
	assert.equal(
		unredactedOverBuffer(held, "/credential BACKSPACE-1"),
		11,
		"the count stands while the box still holds the text it describes",
	);
	assert.equal(
		unredactedOverBuffer(held, "/credential BACKSPA"),
		null,
		"and comes down on the first edit: a shorter remnant is not the buffer it was taken over",
	);
	assert.equal(
		unredactedOverBuffer(held, ""),
		null,
		"an empty box discloses nothing",
	);
	assert.equal(
		unredactedOverBuffer(held, "[Credential #1, 19 chars] "),
		null,
		"and a minted marker cannot carry a count taken over the plaintext it replaced",
	);
	assert.equal(
		unredactedOverBuffer(null, "/credential BACKSPACE-1"),
		null,
		"no disclosure means no count, whatever the box holds",
	);
});

test("the notices are the TUI's own sentences", () => {
	assert.equal(
		CREDENTIAL_ARMED_NOTICE,
		"armed — add a space, then type or paste the secret",
	);
	/*
	 * `pill`, NOT the TUI's `chip` (UX round 1, U5). The two sentences are the
	 * TUI's verbatim except for this one word, and the exception is forced by
	 * this composer's own furniture: its working-directory control is a chip
	 * with its own menu, so "turns it into a chip" named the wrong object in the
	 * one sentence that says what Enter does. The marker is called a pill
	 * everywhere else in the design record and in this module, and the word is
	 * five characters shorter, so the overflow behaviour cannot regress on it.
	 */
	assert.equal(
		CREDENTIAL_TYPING_NOTICE,
		"masked as you type — Enter turns it into a pill, Esc cancels",
	);
	assert.ok(
		!CREDENTIAL_TYPING_NOTICE.includes("chip"),
		"the notice must not call the marker a chip",
	);
	assert.equal(
		unredactedNotice(64),
		"64 characters are now PLAIN TEXT in the composer — Enter will expose them",
	);
	assert.equal(
		storedNotice(["LOP_SECRET_K3RQ7WZM"]),
		"Stored LOP_SECRET_K3RQ7WZM. Injected into every bash command as an environment variable; the agent cannot read the value.",
	);
	assert.equal(
		unstoredNotice(["LOP_SECRET_K3RQ7WZM"]),
		"1 credential could not be stored (LOP_SECRET_K3RQ7WZM); the agent has been told so. Paste the value again after /credential to retry.",
	);
	assert.equal(
		unstoredNotice(["B", "A"]),
		"2 credentials could not be stored (A, B); the agent has been told so. Paste the value again after /credential to retry.",
	);
});

/*
 * ---------------------------------------------------------------------------
 * §6 — the draft rule
 * ---------------------------------------------------------------------------
 */

test("no persisted draft write happens while a masked capture is open", () => {
	/*
	 * §6: the persisted draft keeps the last non-capturing value. `conversation-input-store`
	 * is persisted to localStorage, so a draft write during a capture would put
	 * the mask cells on disk with no value behind them — dead text the operator
	 * cannot use when the draft is restored.
	 *
	 * The harness writes the draft exactly where the hook does (after every
	 * change) and with the hook's own gate, so this is the rule rather than a
	 * restatement of it.
	 */
	const composer = harness();
	composer.type("prose first");
	composer.type(" /credential");
	const writesBeforeCapture = composer.state.drafted.length;
	composer.typeKeystroke(" ");
	assert.ok(isTyping(composer.state.capture), "the span is open");
	composer.type("hunter2");
	assert.equal(
		composer.state.drafted.length,
		writesBeforeCapture,
		"not one write while the span is open, the delimiter included",
	);
	assert.equal(
		composer.state.drafted[composer.state.drafted.length - 1],
		"prose first /credential",
		"the draft keeps the last value with no secret in it — the token, not the space that opened the span",
	);
	assert.ok(
		composer.state.drafted.every((value) => !value.includes(MASK_CELL)),
		"the mask cells never reach the draft, so no dead text can be restored",
	);
	composer.enter();
	composer.type("after");
	assert.ok(
		composer.state.drafted[composer.state.drafted.length - 1].endsWith("after"),
		"and the draft resumes once the capture is closed",
	);
});

test("the map is keyed by index and holds the marker beside the key", () => {
	// §6: `{ index, key, value, marker }`. The marker rides along because a
	// restored draft repaints its pill from the text it holds, and the submit
	// path has to be able to tell the app's own citation from a lookalike.
	const composer = harness();
	composer.type("/credential ");
	composer.type("abc");
	composer.enter();
	const [payload] = [...composer.state.payloads.values()];
	assert.deepEqual(Object.keys(payload).sort(), [
		"index",
		"key",
		"marker",
		"value",
	]);
	assert.equal(payload.index, 1);
	assert.equal(payload.value, "abc");
	assert.equal(payload.marker, "[Credential #1, 3 chars]");
	assert.ok(isStorableCredentialKey(payload.key));
});

test("maskEdit is a no-op outside an open span", () => {
	assert.equal(
		maskEdit(IDLE_CAPTURE, "abc", 1, { top: 1, bottom: 1, inserted: "x" }),
		null,
	);
	assert.equal(maskSpan(IDLE_CAPTURE), null);
});

test("the token regex is read with a fresh lastIndex, so two reads agree", () => {
	/*
	 * The module's own discipline, stated in its comment block: `CREDENTIAL_TOKEN` is
	 * a /g regex, so `exec` carries the previous match's position and an unreset
	 * second call answers `null` for the same string. The composer reads it once per
	 * pick to decide whether the picker wrote a credential token (review round 10,
	 * MINOR-2), and a read that depended on how many times it had been called before
	 * would make that decision a function of history.
	 */
	const draft = "please /credential mysecretname";
	CREDENTIAL_TOKEN.lastIndex = 0;
	const first = CREDENTIAL_TOKEN.exec(draft);
	CREDENTIAL_TOKEN.lastIndex = 0;
	const second = CREDENTIAL_TOKEN.exec(draft);
	assert.equal(
		first?.[0],
		second?.[0],
		"two reads with a fresh lastIndex agree",
	);
	assert.equal(first?.[0], "/credential");
	// The reset is what buys that: the same two calls without it disagree, which is
	// why every reader in this module resets first.
	CREDENTIAL_TOKEN.lastIndex = 0;
	CREDENTIAL_TOKEN.exec(draft);
	assert.equal(
		CREDENTIAL_TOKEN.exec(draft),
		null,
		"an unreset second read is the trap the discipline exists for",
	);
});

/* Hoisted for the reason the story file hoists its matchers: a regex built inside a
   test body is rebuilt on every call, and `lint/performance/useTopLevelRegex` is
   the rule that says so. */
const CLEARED_KEY_NOTICE =
	/Removed LOP_SECRET_4CE3Y48G \(credential #3\) from this message/;
const CLEARED_REPASTE =
	/press ⌘Z to put it back, or paste it again after \/credential/;

/*
 * ---------------------------------------------------------------------------
 * THE CHIP'S OWN TWO QUESTIONS: what the transcript treats as a citation, and
 * what the composer's x does to one
 * ---------------------------------------------------------------------------
 *
 * Operator report, 2026-09-17: a message sent with a pasted secret reads in the
 * transcript as a wall of technical text, and the composer's "pill" is a wash
 * behind the marker's own square brackets rather than a chip. Part A of that
 * change is RENDER-ONLY - the citation the model receives and the transcript
 * stores does not change by one byte - so the only thing to pin on that side is
 * what the renderer RECOGNISES, and the negatives are the load-bearing half: a
 * hand-typed lookalike must stay prose, and the citation's own text inside a
 * fenced block must stay exactly as the operator quoted it.
 *
 * Part B's clear control has a second half that cannot be photographed into
 * proof: the VALUE and the PAYLOAD are gone, not just the marker text. The
 * frames show the sentence with the reference removed; these cases show that no
 * citation, no marker and no secret survives the click.
 */

/** A payload as the mint builds one, with its marker built the same way. */
const chipPayload = (index, value) => ({
	index,
	key: `LOP_SECRET_4CE3Y48${index}`,
	value,
	marker: credentialMarker(index, value),
});

test("every citation the app writes comes back as ONE citation segment", () => {
	const payload = chipPayload(1, "s".repeat(73));
	const sentence = credentialCitation(payload);
	assert.deepEqual(citationSegments(sentence), [
		{ kind: "stored", text: sentence, key: payload.key, chars: 73 },
	]);
	for (const reason of ["unreachable", "rejected-key", "lost"]) {
		const unstored = describeUnstored(reason);
		assert.deepEqual(
			citationSegments(unstored),
			[{ kind: "unstored", text: unstored }],
			reason,
		);
	}
});

test("a citation mid-sentence stays inside its paragraph, and two of them are two chips", () => {
	const sentence = credentialCitation(chipPayload(1, "s".repeat(73)));
	const text = `here is the key ${sentence} — and the same one again ${sentence}`;
	const segments = citationSegments(text);
	assert.deepEqual(
		segments.map((segment) => segment.kind),
		["text", "stored", "text", "stored"],
	);
	assert.equal(segments[0].text, "here is the key ");
	assert.equal(segments[2].text, " — and the same one again ");
	// The split is a PROJECTION: joining the pieces gives the document back, so a
	// chip can only ever be a re-drawing of text the transcript already held.
	assert.equal(segments.map((segment) => segment.text).join(""), text);
});

test("a lookalike is prose: only the whole sentence, with its two names agreeing", () => {
	const sentence = credentialCitation(chipPayload(1, "s".repeat(73)));
	const cases = [
		// the second name edited by hand: the case a permissive scan would chip
		sentence.replace("$LOP_SECRET_4CE3Y481", "$LOP_SECRET_OTHER000"),
		// the sentence's own tail missing
		"[credential LOP_SECRET_4CE3Y481 (73 chars) — available to bash and eval as $LOP_SECRET_4CE3Y481]",
		// the MARKER grammar, which never reaches the transcript and is not a citation
		"[Credential #1, 73 chars]",
		// a bracket that is not a citation at all
		"[credential]",
	];
	for (const text of cases) {
		assert.deepEqual(
			citationSegments(text).map((segment) => segment.kind),
			["text"],
			text,
		);
	}
});

test("the fenced and inline-code cases are left byte-identical, and prose beside them is not", () => {
	const sentence = credentialCitation(chipPayload(1, "s".repeat(73)));
	const tree = {
		type: "root",
		children: [
			{
				type: "paragraph",
				children: [{ type: "text", value: "what you sent:" }],
			},
			{ type: "code", lang: "text", value: sentence },
			{
				type: "paragraph",
				children: [
					{ type: "text", value: "and again " },
					{ type: "text", value: sentence },
				],
			},
			{
				type: "paragraph",
				children: [{ type: "inlineCode", value: sentence }],
			},
		],
	};
	remarkCredentialCitations()(tree);
	const fenced = tree.children[1];
	assert.equal(fenced.value, sentence, "a fenced block is untouched");
	assert.equal(fenced.children, undefined, "and nothing was hung on it");
	const inline = tree.children[3].children[0];
	assert.equal(inline.type, "inlineCode");
	assert.equal(inline.value, sentence);
	// Prose beside the fence is chipped, and the text around it survives unchanged.
	const prose = tree.children[2].children;
	assert.deepEqual(
		prose.map((node) => node.type),
		["text", "link"],
	);
	assert.equal(prose[0].value, "and again ");
	assert.equal(
		prose[1].children[0].value,
		sentence,
		"the node still carries the sentence",
	);
	assert.equal(prose[1].title, sentence);
});

test("the chip's URL round-trips, and a URL this app did not write is not a citation", () => {
	const href = citationHref({
		kind: "stored",
		key: "LOP_SECRET_4CE3Y48G",
		chars: 73,
	});
	assert.equal(href, "#lo-credential/LOP_SECRET_4CE3Y48G/73");
	assert.deepEqual(citationFromHref(href), {
		kind: "stored",
		key: "LOP_SECRET_4CE3Y48G",
		chars: 73,
	});
	assert.deepEqual(citationFromHref(citationHref({ kind: "unstored" })), {
		kind: "unstored",
	});
	for (const other of [
		"https://example.com/x",
		"#lo-credential",
		"#lo-credential/not a key/73",
		"#lo-credential/LOP_SECRET_4CE3Y48G/seven",
		undefined,
	]) {
		assert.equal(citationFromHref(other), null, String(other));
	}
});

test("the marker's chip label is the index, and the count is the marker's own", () => {
	assert.deepEqual(markerChip(credentialMarker(1, "x".repeat(19))), {
		index: 1,
		label: "#1",
		chars: 19,
	});
	assert.deepEqual(markerChip(credentialMarker(12, "x")), {
		index: 12,
		label: "#12",
		chars: 1,
	});
	assert.equal(markerChip("deploy with"), null);
	assert.equal(
		markerChip(`${credentialMarker(1, "x")} and more`),
		null,
		"a span that merely contains the grammar is not a run of its own",
	);
});

test("the x takes the marker and its trailing space in ONE edit, and stops citing the value", () => {
	const payload = chipPayload(1, "s".repeat(19));
	const buffer = `deploy with ${payload.marker} to the staging box`;
	const cleared = clearCitedCredential({ buffer, payload });
	assert.equal(cleared.cleared, true);
	assert.equal(cleared.buffer, "deploy with to the staging box");
	assert.equal(cleared.caret, "deploy with ".length);
	// THE VALUE/PAYLOAD OUTCOME, which is the half a frame cannot show: nothing
	// cites the payload any more, so the submit seam has nothing to stamp, and the
	// splice leaves neither the marker's text nor the secret in the buffer.
	assert.equal(citedPayloads(cleared.buffer, [payload]).length, 0);
	assert.equal(
		substituteCredentials(cleared.buffer, [payload]),
		cleared.buffer,
	);
	assert.ok(!cleared.buffer.includes("[Credential"));
	assert.ok(!cleared.buffer.includes(payload.value));
});

test("a marker at the end of the buffer goes without eating a character", () => {
	const payload = chipPayload(1, "abc");
	const cleared = clearCitedCredential({
		buffer: `use ${payload.marker}`,
		payload,
	});
	assert.equal(cleared.cleared, true);
	// The blank BEFORE the marker is the operator's and stays; there is no trailing
	// blank to take with it, which is the half this case exists for.
	assert.equal(cleared.buffer, "use ");
	assert.equal(cleared.caret, 4);
});

test("the x is refused, not guessed, when the marker it would remove has moved on", () => {
	const payload = chipPayload(1, "abc");
	const gone = "no reference here";
	assert.deepEqual(clearCitedCredential({ buffer: gone, payload }), {
		cleared: false,
		buffer: gone,
		caret: gone.length,
		// Nothing left, so there is nothing for an undo to put back: the `removed`
		// half is what `restoreClearedCredential` refuses on (UX round 1, U2).
		removed: "",
	});
	// The index half: a payload whose marker names a DIFFERENT index is not this
	// payload's citation, which is what a hand-edited marker tail produces.
	const edited = { ...payload, marker: credentialMarker(2, payload.value) };
	const kept = clearCitedCredential({
		buffer: `x ${payload.marker} y`,
		payload: edited,
	});
	assert.equal(kept.cleared, false);
	assert.equal(kept.buffer, `x ${payload.marker} y`);
});

test("the cleared notice names the key and says who can supply the value again", () => {
	const notice = clearedNotice("LOP_SECRET_4CE3Y48G", 3, "⌘Z");
	assert.match(notice, CLEARED_KEY_NOTICE);
	assert.match(notice, CLEARED_REPASTE);
});

/* ---------------------------------------------------------------------------
 * ROUND 1's REMEDIATION: the pipeline the defect lived in, the link provenance
 * the QA round found, the undo, and the copy the two reviews asked for.
 * ------------------------------------------------------------------------- */

test("two citations on one line are two chips, and the math pipeline must not eat them", async () => {
	/*
	 * R1-1's own shape, over the renderer's real plugin list. Every citation the
	 * app writes carries exactly ONE `$` (`... available to bash and eval as
	 * $KEY ...`), so one alone never matches `INLINE_MATH_REGEX` - and TWO of them
	 * always do. That made `containsLatex` answer true, enabled `remark-math`,
	 * and micromark paired the two citations' `$`s at PARSE time, before the
	 * citation plugin could run: the operator's own sentence was typeset as a
	 * formula and neither reference was chipped.
	 */
	const first = credentialCitation(chipPayload(1, "s".repeat(73)));
	const second = credentialCitation(chipPayload(2, "s".repeat(19)));
	const source = `here is ${first} and also ${second} ok`;
	assert.equal(
		containsRenderableMath(source),
		false,
		"a document whose only `$`s are two citations' is not a math document",
	);
	assert.deepEqual(
		await drivePipeline(source, false),
		{ link: 2, inlineMath: 0 },
		"both citations must be chipped",
	);
	/*
	 * THE NEGATIVE CONTROL, and it is the whole reason this test can fail: with the
	 * math pass forced on - the pipeline that shipped - the citations are split and
	 * NOTHING is chipped, and the words between the two `$`s become one inline
	 * formula. A test that only ran the fixed pipeline could pass with the plugin
	 * deleted.
	 */
	assert.deepEqual(
		await drivePipeline(source, true),
		{ link: 0, inlineMath: 1 },
		"the defect, reproduced on the pipeline that shipped it",
	);
	assert.equal(maskCitations(source)?.includes("$"), false);
});

test("a citation plus a `$VAR` on the same line resolves in the citation's favour", async () => {
	const citation = credentialCitation(chipPayload(1, "s".repeat(19)));
	const source = `export ${"$"}TOKEN before this ${citation} ok`;
	assert.equal(containsRenderableMath(source), false);
	assert.deepEqual(await drivePipeline(source, false), {
		link: 1,
		inlineMath: 0,
	});
});

test("a citation plus a PRICE still resolves in the citation's favour (code review round 2, R2-1)", async () => {
	/*
	 * THE DOOR ROUND 1'S FIX LEFT OPEN. The veto counted "pairable" dollars, and
	 * `PAIRABLE_DOLLAR` refuses to count a `$` a digit follows - while micromark's
	 * inline-math CLOSER has no such exclusion, so one citation plus `$5` still
	 * paired. The reviewer measured the consequence on the shipped tree: the same
	 * document went `{link:0, inlineMath:1}`, i.e. no chip and the app's own
	 * sentence typeset as a formula. The rule is now "the MASKED document holds no
	 * `$` at all" (`containsRenderableMath`), and these are the shapes that tell the
	 * two rules apart.
	 */
	const citation = credentialCitation(chipPayload(1, "s".repeat(19)));
	for (const price of ["$5", "$5.00", "$1,000", "us$5", "\\$5"]) {
		const source = `deploy with ${citation} it costs ${price} a month`;
		assert.equal(containsRenderableMath(source), false, price);
		assert.deepEqual(
			await drivePipeline(source, false),
			{ link: 1, inlineMath: 0 },
			`the citation pass alone must chip it (${price})`,
		);
		// The negative control: the same document through the shipped pipeline with
		// math enabled loses the chip, which is the defect the veto exists to prevent.
		assert.deepEqual(
			await drivePipeline(source, true),
			{ link: 0, inlineMath: 1 },
			`math enabled still eats it, which is why the veto must hold (${price})`,
		);
	}
});

test("a citation alone does not disable math, and math without a citation is untouched", async () => {
	const citation = credentialCitation(chipPayload(1, "s".repeat(19)));
	// One citation is one `$`: no pair, so `containsLatex` was never true for it and
	// this document never had math to lose.
	assert.equal(containsRenderableMath(citation), false);
	assert.deepEqual(await drivePipeline(citation, false), {
		link: 1,
		inlineMath: 0,
	});
	// No citation: the rule is the old `containsLatex`, unchanged, so every render
	// that never opted in behaves exactly as it did.
	assert.equal(containsRenderableMath("solve $x^2$ for me"), true);
	assert.equal(containsRenderableMath("it costs $5 and $10"), false);
	assert.equal(containsRenderableMath("prices are $5"), false);
	assert.equal(containsRenderableMath("no dollars here"), false);
	// THE RECORDED TRADE, in one assertion: a document that cites a credential AND
	// carries a formula shows the formula as its own source, because a citation
	// that silently fails to chip is the defect this whole change exists to remove.
	assert.equal(
		containsRenderableMath(`solve $x^2$ then use ${citation}`),
		false,
	);
});

test("the notice line's precedence puts the actionable sentence first (UX round 2, U10)", () => {
	/*
	 * Round 1 ordered the line `unredacted > cleared > armed`, and the armed step did
	 * not hold: arm the capture at the end of the buffer, clear a chip, and the line
	 * stopped saying the capture was armed while it still was. The rule is the one
	 * the first step already argued - the sentence that knows what the NEXT keystroke
	 * will do outranks the one reporting the last edit - so armed now wins over
	 * cleared, and the cleared sentence keeps the line whenever nothing actionable
	 * wants it.
	 */
	const cleared = { key: "LOP_SECRET_4CE3Y48G", index: 3, stale: false };
	const undoCap = "⌘Z";
	assert.equal(
		noticeLineFor({ unredacted: null, armed: true, cleared, undoCap }),
		CREDENTIAL_ARMED_NOTICE,
	);
	assert.equal(
		noticeLineFor({ unredacted: null, armed: false, cleared, undoCap }),
		clearedNoticeLine(cleared.key, cleared.index, undoCap),
	);
	assert.equal(
		noticeLineFor({ unredacted: null, armed: true, cleared: null, undoCap }),
		CREDENTIAL_ARMED_NOTICE,
	);
	assert.equal(
		noticeLineFor({ unredacted: null, armed: false, cleared: null, undoCap }),
		null,
	);
	// The disclosure still outranks both, for the reason its own comment gives.
	assert.equal(
		noticeLineFor({
			unredacted: "Enter will expose them",
			armed: true,
			cleared,
			undoCap,
		}),
		"Enter will expose them",
	);
	// And the stale register is the same key with different words (U7's refusal).
	assert.equal(
		noticeLineFor({
			unredacted: null,
			armed: false,
			cleared: { key: cleared.key, index: cleared.index, stale: true },
			undoCap,
		}),
		clearedStaleNotice(cleared.key),
	);
});

test("the toast says only what the toast can do, and the refusal has words (UX round 2, U7, U9)", () => {
	/*
	 * U9: the two channels printed the same 110 characters, and the toast's `Undo`
	 * sat beside "its value is gone" - a claim the button contradicts for as long as
	 * the button exists. The durable channel keeps the fact; the transient one names
	 * the reference and offers the undo. U7: the refusal a moved buffer produces is a
	 * sentence, not a silence.
	 */
	assert.equal(clearedToastLine(2), "Credential #2 removed");
	assert.match(clearedStaleNotice("LOP_SECRET_4CE3Y48G"), /cannot be put back/);
	assert.match(
		clearedStaleNotice("LOP_SECRET_4CE3Y48G"),
		/LOP_SECRET_4CE3Y48G/,
	);
	assert.notEqual(
		clearedToastLine(2),
		clearedNoticeLine("LOP_SECRET_4CE3Y48G", 3, "⌘Z"),
	);
	assert.ok(!clearedToastLine(2).includes("gone"));
	/*
	 * AND THE DURABLE LINE NAMES BOTH THE WAY BACK AND WHICH ONE WENT (UX round 3,
	 * U15/U16). It said only "paste it again" while the cheap path the same round added
	 * is the composer's own key, and it named only the KEY - which appears on no chip on
	 * screen (the chip's face is `#N`), so a reader could not correlate the two channels.
	 */
	const durable = clearedNoticeLine("LOP_SECRET_4CE3Y48G", 3, "⌘Z");
	assert.ok(durable.includes("⌘Z"), durable);
	assert.ok(durable.includes("credential #3"), durable);
	assert.ok(durable.includes("paste it again"), durable);
	// The key named is the handler's own label, so the sentence cannot promise a key
	// the composer does not listen for: the same helper, the other platform's spelling.
	assert.ok(clearedNoticeLine("K", 1, "Ctrl+Z").includes("Ctrl+Z"));
});

test("only a link whose visible text IS the citation is chipped", () => {
	/*
	 * QA round 1, Q1: `citationFromHref` validates a URL's SHAPE, and a hand-typed
	 * markdown link to the private scheme satisfies it - so the transcript drew the
	 * app's own receipt for a reference the app never wrote. The criterion is
	 * provenance, and the pair the plugin builds (URL and visible text from one
	 * segment) is what proves it.
	 */
	const payload = chipPayload(1, "s".repeat(19));
	const sentence = credentialCitation(payload);
	const href = citationHref({ kind: "stored", key: payload.key, chars: 19 });
	assert.deepEqual(citationFromLink(href, sentence), {
		kind: "stored",
		key: payload.key,
		chars: 19,
	});
	for (const [why, url, text] of [
		[
			"the hand-typed link the QA round reproduced",
			"#lo-credential/LOP_SECRET_ZZZZZZZZ/19",
			"sneaky",
		],
		["a link whose words are not a citation", href, "the deploy key"],
		[
			"a citation sentence pointing at another key's URL",
			citationHref({ kind: "stored", key: "LOP_SECRET_OTHERKEY", chars: 19 }),
			sentence,
		],
		[
			"a URL with no count to carry",
			`#lo-credential/${payload.key}/`,
			sentence,
		],
		[
			"a key that is not a store key",
			citationHref({ kind: "stored", key: "not a key", chars: 19 }),
			sentence,
		],
		["an ordinary link", "https://example.com/x", sentence],
		["no URL at all", undefined, sentence],
	]) {
		assert.equal(citationFromLink(url, text), null, why);
	}
	// The not-stored register is a citation too, and its URL carries no count.
	const unstored = describeUnstored("lost");
	assert.deepEqual(
		citationFromLink(citationHref({ kind: "unstored" }), unstored),
		{
			kind: "unstored",
		},
	);
});

test("the undo puts the marker back at the offset, and refuses once the buffer moved", () => {
	/*
	 * UX round 1, U2: the payload is held until the toast retires, so what the undo
	 * has to restore is the TEXT. `restoreClearedCredential` is the pure half of
	 * that, and its refusal is the guard that makes the recorded offset safe.
	 */
	const payload = chipPayload(1, "s".repeat(19));
	const buffer = `deploy with ${payload.marker} to the staging box`;
	const cleared = clearCitedCredential({ buffer, payload });
	assert.equal(cleared.removed, `${payload.marker} `);
	const restored = restoreClearedCredential({
		buffer: cleared.buffer,
		cleared,
	});
	assert.equal(restored.buffer, buffer);
	assert.equal(restored.caret, cleared.caret + cleared.removed.length);
	assert.ok(!restored.buffer.includes(payload.value));
	// The buffer moved on: the recorded offset no longer names the place the
	// reference sat, and an insert there would corrupt the operator's prose.
	assert.equal(
		restoreClearedCredential({
			buffer: `${cleared.buffer} and I typed more`,
			cleared,
		}),
		null,
	);
	// A clear that spliced nothing has nothing to restore.
	const refused = clearCitedCredential({ buffer: "no reference", payload });
	assert.equal(
		restoreClearedCredential({ buffer: refused.buffer, cleared: refused }),
		null,
	);
});

test("the clear control's name and the composer chip's title are per-reference copy", () => {
	/*
	 * D4 and U3, pinned because both are strings a reader meets: the control's name
	 * has to distinguish two chips in a screen reader's list, and the composer's
	 * chip - which names an INDEX, not a key - has to explain itself on hover. Both
	 * live in `credential-capture.ts` with the rest of this feature's copy.
	 */
	assert.equal(clearControlLabel(1), "Remove credential #1");
	assert.equal(clearControlLabel(12), "Remove credential #12");
	assert.equal(
		markerChipTitle(1, 19),
		"Credential #1, 19 chars — held in this message; its value cannot be read",
	);
	assert.equal(CREDENTIAL_CLEAR_UNDO_LABEL, "Undo");
	// U9's own rule, kept: the notice LINE and the durable sentence are one authority.
	// The TOAST stopped sharing it in round 2 (it says `Credential #N removed` beside
	// the `Undo`), which is why the pair compared here is the line and the sentence it
	// is built from rather than the pair of channels.
	assert.equal(
		clearedNoticeLine("LOP_SECRET_4CE3Y48G", 3, "⌘Z"),
		clearedNotice("LOP_SECRET_4CE3Y48G", 3, "⌘Z"),
		"the notice line and its own sentence come from one authority",
	);
	assert.notEqual(
		clearedToastLine(3),
		clearedNoticeLine("LOP_SECRET_4CE3Y48G", 3, "⌘Z"),
		"the transient channel must not repeat the durable one (U9)",
	);
});
