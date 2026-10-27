/**
 * Wave B of the French pass: the composer, the pickers, the offline states, the
 * status readings and the tool-step words.
 *
 *     node --test scripts/i18n-wave-b-keyed-copy.test.mjs
 *
 * WHY THIS SUITE EXISTS. Every string it covers was an English literal in a
 * `.ts`/`.tsx` module, so it rendered English over an otherwise French page: the
 * device picker's heading and pairing line, the `@` and slash popups' headings,
 * the loading and connection-loss sentences, the run details panel's quiet line,
 * the session-status readings, the tool row's outcome words, and the toast
 * region's own labels.
 *
 * WHAT IT MEASURES, and with which instrument.
 *
 * A. THE CALL SITE READS THE ACTIVE CATALOGUE, AT CALL TIME. The shipped French
 *    catalogue does not carry these keys yet — this wave lands English and
 *    context, and the translator lane follows — so an assertion against `fr`
 *    would fall back to English and prove nothing. Instead a MARKER message is
 *    registered for `fr` for each key and the locale is switched, exactly as a
 *    served catalogue layers over the bundle at runtime (`registerCatalogue`).
 *    A call site that reads the catalogue therefore renders the marker; a call
 *    site that kept its literal renders English and fails. This is also the
 *    MUTATION PROOF: restore any one literal and its case goes red naming the
 *    module (verified by running this file against such a tree).
 *
 * B. THE LITERAL IS GONE FROM EVERY TOUCHED MODULE. The runtime case cannot see
 *    a literal that happens to equal the English message, so each module's
 *    source is scanned for the strings it used to hold (comments stripped, so
 *    the notes that QUOTE the old sentence are not findings).
 *
 * WHAT IT DOES NOT PROVE: pixels. These are the same components the app mounts
 * (`TranscriptPlaceholder`, `RunDetailsPanel`, `AtPicker` …) and their call
 * sites are proven here at the seam they use; the rendered frames belong to the
 * review round, not to this file.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * as device from "./src/renderer/src/features/chat/device/chat-device-model";',
			'export * as status from "./src/renderer/src/features/chat/chat-status";',
			'export * as slash from "./src/renderer/src/features/chat/components/slash-contract";',
			'export * as toolRow from "./src/renderer/src/features/chat/components/trace/tool-row-model";',
			'export * as session from "./src/renderer/src/features/chat/session-status/session-model";',
			'export * as notice from "./src/renderer/src/features/chat/canonical/session-failure-notice";',
			'export { DESKTOP_STREAM_DETAIL } from "./src/shared/desktop-stream-notice";',
			// The ONE i18n instance every module above sees: a second specifier would
			// give the test its own copy of the locale store and the switches below
			// would not reach the modules under test.
			'export { registerCatalogue, setLocale, t } from "@shared/i18n";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { "@shared": "./src/renderer/src/shared" },
});

const lib = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Every locale the catalogue tree ships. */
const SHIPPED = ["en", "es", "fr", "hi", "ru", "ur", "vi", "zh-CN"];

const MARKER = "⟦fr⟧";

/* Hoisted for `useTopLevelRegex`, the repo's lint rule for literals a callback
 * would rebuild on every call. */
const COUNT_WITH_NOUN = /3 conversations/;
const DEVICE_NAME = /build-box/;
const LITERAL_FAILED_OUTCOME = /\berror: "failed"/;
const PROVIDER_IN_SENTENCE = /runs Radient/;

/** The ICU tail a marked message keeps, for the keys whose call site passes values. */
const PLACEHOLDER_TAIL = {
	"ui.chat.device.row.conversations": " {count}",
	"ui.chat.device.sentence.move_in_flight": " {name}",
	"ui.chat.status.credential_refused": "",
	"ui.chat.session_status.not_signed_in": " {label}",
	"ui.chat.session_status.not_signed_in_description": " {label}",
	"ui.chat.pickers.slash.click.runs": " /{label}",
};

/**
 * Register a French marker for `keys`, switch to `fr`, and run `read`.
 *
 * The marker is a prefix rather than the whole message: several of these
 * sentences interpolate a value (a device name, a provider label), and the
 * assertion has to keep seeing that value to prove the message — not only the
 * locale — is the one the call site asked for.
 */
function inFrench(keys, read) {
	lib.registerCatalogue(
		"fr",
		Object.fromEntries(
			keys.map((key) => [
				key,
				/*
				 * A key that interpolates a value keeps its placeholder in the marker,
				 * so the case can still prove the value reaches the sentence: dropping
				 * it would let a call site that ignored its argument pass.
				 */
				`${MARKER} ${key}${PLACEHOLDER_TAIL[key] ?? ""}`,
			]),
		),
	);
	lib.setLocale("fr");
	try {
		return read();
	} finally {
		lib.setLocale("en");
	}
}

/** Comments stripped, so a note quoting the old sentence is not a finding. */
const code = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

/* --------------------------------------------------------------- the device picker */

const DEVICE_KEYS = [
	"ui.chat.device.label.this_device",
	"ui.chat.device.picker.heading.start",
	"ui.chat.device.picker.heading.move",
	"ui.chat.device.sentence.pairing_guidance",
	"ui.chat.device.sentence.mesh_read_failure",
	"ui.chat.device.sentence.move_in_flight",
	"ui.chat.device.notice.move_hold_detail",
	"ui.chat.device.row.not_here_why",
	"ui.chat.device.footer.move_deletes_copy",
	"ui.chat.device.row.conversations",
];

test("the picker's headings, rows and sentences come from the catalogue", () => {
	const read = () => ({
		label: lib.device.thisDeviceLabel(),
		/* The create arm is a DRAFT: the model derives the arm from the placement,
		 * so a `local` placement always draws the move's vocabulary. */
		headingStart: lib.device.devicePickerModel({
			placement: { kind: "draft", deviceId: null },
			selfDeviceId: "self",
			selfName: "",
			selfConversations: 3,
			peers: [],
			networks: [],
			meshRead: "ok",
			canTransfer: true,
		}).heading,
		headingMove: lib.device.devicePickerModel({
			placement: { kind: "local" },
			selfDeviceId: "self",
			selfName: "",
			selfConversations: 3,
			peers: [],
			networks: [],
			meshRead: "ok",
			canTransfer: true,
		}).heading,
		guidance: lib.device.pairingGuidance(),
		readFailure: lib.device.meshReadFailure(),
		hold: lib.device.moveHoldSentence("build-box"),
		holdDetail: lib.device.moveHoldDetail(),
		notHere: lib.device.notHereWhy(),
		footer: lib.device.moveFooter(),
		count: lib.device
			.devicePickerModel({
				placement: { kind: "local" },
				selfDeviceId: "self",
				selfName: "",
				selfConversations: 3,
				peers: [],
				networks: [],
				meshRead: "ok",
				canTransfer: true,
			})
			.self.facts.join(" "),
	});
	const english = read();
	assert.equal(english.label, "This device");
	assert.equal(english.headingStart, "Start the conversation on");
	assert.equal(english.headingMove, "Move this conversation to");
	assert.match(english.count, COUNT_WITH_NOUN);
	assert.match(english.hold, DEVICE_NAME, "the device name survives");
	const french = inFrench(DEVICE_KEYS, read);
	assert.equal(french.label, `${MARKER} ui.chat.device.label.this_device`);
	assert.equal(
		french.headingStart,
		`${MARKER} ui.chat.device.picker.heading.start`,
	);
	assert.equal(
		french.headingMove,
		`${MARKER} ui.chat.device.picker.heading.move`,
	);
	assert.equal(
		french.guidance,
		`${MARKER} ui.chat.device.sentence.pairing_guidance`,
	);
	assert.equal(
		french.readFailure,
		`${MARKER} ui.chat.device.sentence.mesh_read_failure`,
	);
	assert.equal(
		french.hold,
		`${MARKER} ui.chat.device.sentence.move_in_flight build-box`,
		"the device name survives in French",
	);
	assert.equal(
		french.holdDetail,
		`${MARKER} ui.chat.device.notice.move_hold_detail`,
	);
	assert.equal(french.notHere, `${MARKER} ui.chat.device.row.not_here_why`);
	assert.equal(
		french.footer,
		`${MARKER} ui.chat.device.footer.move_deletes_copy`,
	);
	assert.equal(
		french.count,
		`${MARKER} ui.chat.device.row.conversations 3`,
		"the count survives in French",
	);
});

/* --------------------------------------------- the pairing line's code spans */

/** A backtick-delimited span: what the picker's plain-text painter shows verbatim. */
const CODE_SPAN = /`[^`]*`/g;

/**
 * The pairing line opens two code spans, so it must close two.
 *
 * WHY A RENDERED FENCE COUNT RATHER THAN THE STRING: the English value once read
 * ``join one with `lop network join '<token>'.`` — the second span opened and never
 * closed, so the picker (which paints this sentence as plain text, not as markdown)
 * showed a stray backtick and no fenced command. A `includes("lop network join")`
 * case cannot see that (chat-device-model.test.mjs has one, and stayed green), so the
 * measurable fact is the fence parity. The `<token>` literal is the other half: the
 * source quotes it as `'<token>'` because an unquoted angle bracket is an ICU
 * UNCLOSED_TAG, `t()` degrades a formatting failure to the key, and the quoting
 * renders away — so a rendered `<token>` proves both the quoting and its removal.
 */
test("the pairing line closes both code spans it opens", () => {
	const rendered = lib.t("ui.chat.device.sentence.pairing_guidance");
	assert.deepEqual(
		{
			backticks: rendered.split("`").length - 1,
			spans: [...rendered.matchAll(CODE_SPAN)].map((match) => match[0]),
			token: rendered.includes("<token>"),
		},
		{
			backticks: 4,
			spans: ["`lop network init`", "`lop network join <token>`"],
			token: true,
		},
	);
});

/* ------------------------------------------------------------- the status strip */

test("the chat status strip's four sentences are the catalogue's", () => {
	const keys = {
		unreachable: "ui.chat.status.unreachable",
		"credential-refused": "ui.chat.status.credential_refused",
		degraded: "ui.chat.status.degraded",
		"internet-offline": "ui.chat.status.internet_offline",
	};
	/*
	 * The display the strip paints, not the helper alone: a literal restored at one
	 * of `chatStatusDisplay`'s four `title:` arms would leave the helper honest and
	 * the screen English, so the case drives the real builder for every state.
	 */
	const display = (over) =>
		lib.status.chatStatusDisplay({
			connectivityIssue: null,
			server: null,
			internetOffline: false,
			...over,
		});
	const read = () => ({
		unreachable: display({ connectivityIssue: "server_offline" })?.title,
		"credential-refused": display({
			server: {
				state: "attached",
				pairing: { available: false, cause: "credential-refused" },
			},
		})?.title,
		degraded: display({ server: { state: "degraded" } })?.title,
		"internet-offline": display({
			connectivityIssue: "internet_offline",
			internetOffline: true,
		})?.title,
	});
	assert.equal(
		read().degraded,
		"The server is answering slowly. Your messages are queued.",
	);
	const french = inFrench(Object.values(keys), read);
	for (const [kind, key] of Object.entries(keys)) {
		assert.equal(french[kind], `${MARKER} ${key}`, kind);
	}
	/* The Retry beside every row is the shared action, not a second spelling. */
	assert.ok(
		code("src/renderer/src/features/chat/chat-status.ts").includes(
			"ui.common.actions.retry",
		),
		"the strip's action label is the shared Retry key",
	);
});

/* ------------------------------------------------------------------ the slash popup */

test("the slash popup's phase labels and footers come from the catalogue", () => {
	const keys = [
		"ui.chat.pickers.commands.title",
		"ui.chat.pickers.slash.phase.arguments",
		"ui.chat.pickers.slash.enter_needs_a_pick",
		"ui.chat.pickers.slash.click.runs",
		"ui.chat.pickers.slash.click.runs_with_value",
		"ui.chat.pickers.slash.click.completes_value",
		"ui.chat.pickers.slash.click.chooses_name",
	];
	const read = () => ({
		commandPhase: lib.slash.phaseLabel("command", undefined, ""),
		argumentPhase: lib.slash.phaseLabel("argument", undefined, ""),
		clickRuns: lib.slash.clickFooter({
			matched: true,
			phase: "command",
			label: "help",
			runs: true,
			arms: false,
			takesDraft: false,
			hoists: false,
		}),
		clickCompletes: lib.slash.clickFooter({
			matched: true,
			phase: "argument",
			label: "help",
			runs: false,
			arms: false,
			takesDraft: false,
			hoists: false,
		}),
	});
	const english = read();
	assert.equal(english.commandPhase, "Commands");
	assert.equal(english.argumentPhase, "Arguments");
	assert.equal(english.clickRuns, "Click runs /help.");
	assert.equal(english.clickCompletes, "Click completes this value.");
	const french = inFrench(keys, read);
	assert.equal(french.commandPhase, `${MARKER} ui.chat.pickers.commands.title`);
	assert.equal(
		french.argumentPhase,
		`${MARKER} ui.chat.pickers.slash.phase.arguments`,
	);
	assert.equal(
		french.clickRuns,
		`${MARKER} ui.chat.pickers.slash.click.runs /help`,
	);
	assert.equal(
		french.clickCompletes,
		`${MARKER} ui.chat.pickers.slash.click.completes_value`,
	);
	/* The Enter line is a key rather than a literal, and the key is the one named. */
	assert.ok(
		code(
			"src/renderer/src/features/chat/components/slash-contract.ts",
		).includes('"ui.chat.pickers.slash.enter_needs_a_pick"'),
	);
});

/* -------------------------------------------------------------------- the tool row */

test("the tool row's generic verb and outcome words come from the catalogue", () => {
	const keys = [
		"ui.chat.canonical.tool_row.generic_verb.settled",
		"ui.chat.canonical.tool_row.generic_verb.running",
	];
	const read = () => ({
		settled: lib.toolRow.toolVerb("mcp__never_heard_of").settled,
		running: lib.toolRow.toolVerb("mcp__never_heard_of").running,
	});
	assert.equal(read().settled, "Called");
	assert.equal(read().running, "Calling");
	const french = inFrench(keys, read);
	assert.equal(
		french.settled,
		`${MARKER} ui.chat.canonical.tool_row.generic_verb.settled`,
	);
	assert.equal(
		french.running,
		`${MARKER} ui.chat.canonical.tool_row.generic_verb.running`,
	);
	/*
	 * The outcome words own their keys in `tool-row.tsx`; that module renders a
	 * component tree, so the assertion is on its table rather than through a
	 * bundle. Restoring an English word there fails the literal scan below.
	 */
	const row = code(
		"src/renderer/src/features/chat/components/trace/tool-row.tsx",
	);
	for (const key of [
		"ui.chat.canonical.tool_row.outcome.succeeded",
		"ui.chat.canonical.tool_row.outcome.failed",
		"ui.chat.canonical.tool_row.outcome.interrupted",
		"ui.chat.canonical.tool_row.outcome.never_ran",
	]) {
		assert.ok(row.includes(key), `tool-row.tsx no longer names ${key}`);
	}
	assert.ok(
		!LITERAL_FAILED_OUTCOME.test(row),
		"the outcome word is a key, not the literal",
	);
});

/* ----------------------------------------------------------- the session readings */

test("the model-access band's sentences come from the catalogue", () => {
	const reading = {
		provider: "radient",
		label: "Radient",
		state: "absent",
	};
	const keys = [
		"ui.chat.session_status.not_signed_in",
		"ui.chat.session_status.not_signed_in_description",
		"ui.chat.session_status.temporarily_unavailable",
		"ui.chat.session_status.temporarily_unavailable_description",
	];
	const read = () => lib.session.modelAccessPresentation(reading);
	const english = read();
	assert.equal(english.title, "Not signed in to Radient");
	assert.match(english.description, PROVIDER_IN_SENTENCE);
	const french = inFrench(keys, read);
	assert.equal(
		french.title,
		`${MARKER} ui.chat.session_status.not_signed_in Radient`,
	);
	assert.equal(
		french.description,
		`${MARKER} ui.chat.session_status.not_signed_in_description Radient`,
	);
	const transient = inFrench(keys, () =>
		lib.session.modelAccessPresentation({
			...reading,
			state: "temporarily_unavailable",
		}),
	);
	assert.equal(
		transient.title,
		`${MARKER} ui.chat.session_status.temporarily_unavailable`,
	);
	assert.equal(
		transient.description,
		`${MARKER} ui.chat.session_status.temporarily_unavailable_description`,
	);
});

/* ------------------------------------------------------------ the connection loss */

test("every connection-loss notice is the catalogue's sentence", () => {
	const keys = [
		"ui.common.connection.session_loss.lost",
		"ui.common.connection.session_loss.server_down",
		"ui.common.connection.session_loss.not_paired",
		"ui.common.connection.session_loss.frame_too_large",
		"ui.common.connection.session_loss.history_unreadable",
	];
	const read = () => ({
		lost: lib.notice.streamFailureNotice(null).statement,
		serverDown: lib.notice.streamFailureNotice(
			lib.DESKTOP_STREAM_DETAIL.serverDown,
		).statement,
		notPaired: lib.notice.streamFailureNotice(
			lib.DESKTOP_STREAM_DETAIL.notPaired,
		).statement,
		frame: lib.notice.streamFailureNotice(lib.DESKTOP_STREAM_DETAIL.frameBudget)
			.statement,
		history: lib.notice.historyUnreadable().statement,
	});
	const english = read();
	assert.equal(
		english.lost,
		"Lost the connection to this conversation — reconnect to keep reading.",
	);
	assert.equal(
		lib.notice.streamFailureNotice(lib.DESKTOP_STREAM_DETAIL.notPaired).action,
		null,
		"a pairing failure offers no control it cannot perform",
	);
	assert.equal(lib.notice.historyUnreadable().action, "reconnect");
	const french = inFrench(keys, read);
	assert.equal(french.lost, `${MARKER} ui.common.connection.session_loss.lost`);
	assert.equal(
		french.history,
		`${MARKER} ui.common.connection.session_loss.history_unreadable`,
	);
});

/* ------------------------------------------------ every touched module, no literals */

/**
 * The sentences this wave removed, by the module that held them.
 *
 * Every entry is asserted ABSENT from its module's code. The list is the leak
 * report's own strings, so a reviewer can read this table against the census.
 */
const REMOVED = {
	"src/renderer/src/features/chat/device/chat-device-model.ts": [
		'"This device is in no network.',
		'"The device list could not be read',
		'"Start the conversation on"',
		'"This device"',
	],
	"src/renderer/src/features/chat/chat-status.ts": [
		"Can't reach the Local Operator server",
		"The server is answering slowly",
		"This machine is offline",
		'"Retry"',
	],
	"src/renderer/src/features/chat/components/slash-contract.ts": [
		'"Commands"',
		'"Arguments"',
		"Enter needs a row you pick",
		"Click runs /",
	],
	"src/renderer/src/features/chat/canonical/transcript-placeholder.tsx": [
		"Loading conversation",
	],
	"src/renderer/src/features/chat/components/at-picker.tsx": [
		'aria-label="Files"',
		'"Projects" : "Files"',
		'? "Project"',
	],
	"src/renderer/src/features/chat/components/run-details/run-details-panel.tsx":
		['"Nothing in flight."', '"Nothing to show yet."'],
	"src/renderer/src/features/chat/session-status/session-status-strip.tsx": [
		"Model: none resolved yet",
		"Context: nothing measured yet",
		"Set once the conversation starts",
	],
	"src/renderer/src/features/agents/config-run/config-composer.tsx": [
		'"Configure agents by conversation"',
		'? "Run details"',
	],
	"src/renderer/src/features/agents/config-run/use-config-run.ts": [
		"The backend could not be reached, so the composer is unavailable",
	],
	"src/renderer/src/features/chat/components/trace/tool-row-model.ts": [
		'"Called"',
		'"Calling"',
	],
	"src/renderer/src/features/chat/canonical/session-failure-notice.ts": [
		"Lost the connection to this conversation",
	],
	"src/shared/desktop-stream-notice.ts": [
		"Lost the connection to this conversation",
		"This app is not paired with the Local Operator server",
	],
	"src/renderer/src/shared/components/common/themed-toast-container.tsx": [],
};

test("no module in this wave still holds the sentence it replaced", () => {
	for (const [path, literals] of Object.entries(REMOVED)) {
		const source = code(path);
		for (const literal of literals) {
			assert.ok(!source.includes(literal), `${path} still holds ${literal}`);
		}
	}
});

test("the toast region and its close control are labelled from the catalogue", () => {
	const source = code(
		"src/renderer/src/shared/components/common/themed-toast-container.tsx",
	);
	assert.ok(
		source.includes(
			'containerAriaLabel={t("ui.common.layout.toasts.notifications")}',
		),
		"the region label is passed through t()",
	);
	assert.ok(
		source.includes(
			'closeButtonAriaLabel: t("ui.common.layout.toasts.dismiss")',
		),
		"the close control's name is passed through t()",
	);
	assert.equal(lib.t("ui.common.layout.toasts.dismiss"), "Close toast");
	assert.equal(lib.t("ui.common.layout.toasts.notifications"), "Notifications");
});

/* ------------------------------------------------------- every shipped locale, no crash */

test("every shipped locale resolves each key the wave added", () => {
	for (const tag of SHIPPED) {
		lib.setLocale(tag);
		for (const key of [
			"ui.chat.device.label.this_device",
			"ui.chat.device.picker.heading.start",
			"ui.chat.device.picker.heading.move",
			"ui.chat.device.sentence.pairing_guidance",
			"ui.chat.device.sentence.mesh_read_failure",
			"ui.chat.device.notice.move_hold_detail",
			"ui.chat.device.row.not_here_why",
			"ui.chat.device.footer.move_deletes_copy",
			"ui.chat.status.degraded",
			"ui.chat.pickers.slash.region_label",
			"ui.chat.canonical.placeholder.loading",
			"ui.chat.run_details.nothing_in_flight",
			"ui.agents.config.disabled_gate",
			"ui.common.connection.session_loss.lost",
			"ui.common.layout.toasts.dismiss",
		]) {
			const message = lib.t(key);
			assert.equal(typeof message, "string", `${tag}: ${key}`);
			assert.notEqual(message, key, `${tag}: ${key} resolves, not echoes`);
		}
	}
	lib.setLocale("en");
});
