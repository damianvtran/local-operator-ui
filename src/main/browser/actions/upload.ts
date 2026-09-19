import { statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { BrowserHostError } from "../errors";
import type { FileFact } from "../protocol";
import type { TabRecord } from "../registry";
import { safeName } from "../vendor/driver/file-transfer-policy";
import { CAPS } from "../vendor/driver/file-transfer.tables.gen";
import type { BrowserActionContext } from "./context";
import { stringParam } from "./context";
import { pageOf } from "./gate";
import { resolveNode } from "./input";

/**
 * `upload`: attach real local files to a page's file input.
 * Design: docs/design/browser-file-transfer.md §6.1, §9.2, §9.3, §9.4.
 *
 * WHY `DOM.setFileInputFiles` AND NOTHING ELSE. It is the CDP primitive Puppeteer
 * and Playwright use, it is available over the tab-scoped session the browser
 * driver already holds, and it makes the BROWSER PROCESS read the bytes off disk —
 * so nothing here base64-inflates a 40 MB PDF through the wire, and the file the
 * page receives is the file the user has. The extension host uses the same
 * command for the same reason (measured working on a `<input multiple>`,
 * 2026-09-18: read-back `{"count":2,"names":["deck.pptx","notes file with
 * spaces.pdf"],"sizes":[13,69]}`).
 *
 * WHAT THIS MODULE DOES NOT DECIDE. Whether a local file MAY leave is Python's
 * (`browser_files.check_upload`): the workspace rule, the credential deny-list,
 * the config-root refusal and the caps are all judged there, on the RESOLVED path,
 * before the call is dispatched. This host attaches the paths it is given and
 * reports what the DOM actually holds. The one thing it must NOT do is second-
 * guess a file from its name — a host-side copy of the deny-list would be a second
 * policy that can disagree with the authoritative one, and §9.2's rules need the
 * resolved path, which is the harness's fact, not this host's.
 *
 * THE READ-BACK IS THE POINT (§9.3). A file input that silently ignored the call
 * must not be reported as filled: `type`'s rule — compare the read-back, never
 * interpolate what was sent — is applied to attachments. The comparison is
 * name-and-size against the files on disk, and a mismatch fails the call naming
 * BOTH sides, because "the input holds nothing" and "the input holds something
 * else" have different remedies.
 *
 * A READ THAT COULD NOT BE TAKEN IS THE OTHER CASE, AND IT IS NOT A FAILURE (review
 * round 2, R2-2). A page that submits itself from the change handler — or replaces
 * its own document — destroys the execution context the read-back runs in, in the
 * same tick as the attach: so the attach happened and the bytes went while the DOM
 * can no longer be asked. That is reported as an UNVERIFIED attach (facts from the
 * paths, plus a `readback` marker the harness turns into `verified: false` and an
 * audit row) rather than as an error, because "the call failed" over bytes that left
 * is what makes a model re-send them. The extension host states the same rule in the
 * same words; the two hosts must classify the same failure the same way.
 */

/** What the DOM holds after the attach, read back over the same session. */
interface InputReadBack {
	count: number;
	names: string[];
	sizes: number[];
}

/** Read `input.files` from the resolved node.
 *
 * A function on the NODE rather than a `document.querySelector` in the page: the
 * target may be a snapshot ref (`e5`), which no CSS selector can address, and
 * `DOM.resolveNode` already gave us the object. `returnByValue` keeps the answer
 * to names and sizes — never the file's contents, which this host has no business
 * reading through the page. */
/** Read `input.files` from the resolved node.
 *
 * A function on the NODE rather than a `document.querySelector` in the page: the
 * target may be a snapshot ref (`e5`), which no CSS selector can address, and
 * `DOM.resolveNode` already gave us the object. `returnByValue` keeps the answer
 * to names and sizes — never the file's contents, which this host has no business
 * reading through the page.
 *
 * READ THROUGH THE PROTOTYPE'S OWN GETTER, NEVER `this.files`. The page is the
 * adversary this read-back exists for, and `files` is a property a page can shadow
 * with `Object.defineProperty` to answer with anything — including a count that
 * matches what was attached for an input the page actually ignored, which is the
 * one failure this comparison is here to catch. The extension host reads the same
 * way for the same reason (`extension/src/commands/upload.ts`), and the two hosts
 * have to agree on what a read-back MEANS rather than merely on its shape. */
const READ_FILES_FUNCTION = `function () {
  if (!("files" in this)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
  let files;
  try { files = descriptor && descriptor.get ? descriptor.get.call(this) : this.files; }
  catch (err) { return null; }
  if (!files) return null;
  const list = Array.from(files);
  return { count: list.length, names: list.map((f) => f.name), sizes: list.map((f) => f.size) };
}`;

/** What a selector names, when it names something that is not a file input. */
const NOT_A_FILE_INPUT =
	'that selector is not a file input; snapshot the page and use the element that <input type="file"> names';

/** CDP failures that mean the page MOVED ON under the read-back.
 *
 * Used for WORDING only, never as the gate (review round 2, R2-2): every failed
 * read-back is reported as an UNVERIFIED attach — see the `try` in `upload` — and
 * this list only decides which sentence the marker carries. Matched on the MESSAGE
 * because `-32000` is CDP's generic "something went wrong", and the strings are the
 * concrete ones Chromium returns.
 *
 * WHY IT IS TWO LISTS RATHER THAN THE EXTENSION HOST'S ONE (which this mirrors
 * otherwise): the extension words every read failure as "the page navigated out of
 * the change event", and the execution context can also be destroyed by a document
 * REPLACEMENT that is not a navigation at all (`document.open()`, which a page can
 * do from its own change handler) — and a node the page detached produces a third.
 * The CLASSIFICATION is identical in all three cases, which is what the two hosts
 * must agree on; the sentence names the mechanism the host actually observed, so a
 * model reading it is not told about a navigation that did not happen. */
const CONTEXT_GONE = [
	"Cannot find context with specified id",
	"Cannot find execution context",
	"Execution context was destroyed",
	"Inspected target navigated or closed",
];

/** CDP failures that mean the NODE the read-back addressed is gone. */
const NODE_GONE = [
	"Node with given id does not belong to the document",
	"No node with given id found",
	"Could not find node with given id",
];

function isContextGone(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return CONTEXT_GONE.some((marker) => message.includes(marker));
}

function isNodeGone(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return NODE_GONE.some((marker) => message.includes(marker));
}

/** One readable line for an error that failed a READ, for the note and the audit
 * row. Trimmed to a single line and capped: the text comes from Chromium, lands in
 * the operator's transcript and in the audit file, and a multi-line CDP payload
 * there would push the rest of the row out of sight. The harness sanitises and
 * caps it again on its own side (`browser_files.readback_label`), because a host
 * must not be trusted for the length of a string it chose. */
function describeError(error: unknown): string {
	const message = (error instanceof Error ? error.message : String(error))
		.replace(/\s+/g, " ")
		.trim();
	return message.slice(0, 120) || "no detail";
}

export async function upload(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const selector = stringParam(params, "selector");
	if (!selector) {
		throw new BrowserHostError(
			"element_not_found",
			"upload needs a selector naming the file input",
		);
	}
	const paths = uploadPaths(params);
	const contents = record.view.webContents;
	const node = await resolveNode(ctx, record, selector);

	// Reported, never obeyed (§9.3): a site's `accept` does not protect the user's
	// files, and honouring it would let a PAGE steer which files the agent tries to
	// attach. It is read here so the number that appears in the log and in a
	// mismatch's data is the input's own, which is what makes a failure
	// explainable.
	const accept = await acceptsOf(ctx, record, node.nodeId);

	await ctx.cdp
		.send(contents, "DOM.setFileInputFiles", {
			files: paths,
			nodeId: node.nodeId,
		})
		.catch((error: unknown) => {
			// THE ONE CDP FAILURE WITH A BETTER SENTENCE THAN CHROMIUM'S (review round
			// 1, Q3). A selector that names a real `<button>` fails inside
			// `DOM.setFileInputFiles` with Chromium's own `{"code":"internal","message":
			// "Node is not a file input element"}` — no selector, no `accept`, no remedy —
			// so the module's own `NOT_A_FILE_INPUT` sentence, which names all three, never
			// fired. Re-raised as the typed code that already means "this selector does not
			// address the thing this action needs".
			if (!/not a file input/i.test(String(error))) throw error;
			throw new BrowserHostError("element_not_found", NOT_A_FILE_INPUT, {
				selector,
				accept,
			});
		});

	// THE READ-BACK IS MANDATORY, BUT A READ THAT COULD NOT BE TAKEN IS NOT A FAILED
	// ATTACH (review round 2, R2-2, and the same rule the extension host states).
	// A page that submits itself from the change handler navigates in the same tick
	// as the attach, which destroys the execution context this read runs in — the
	// attach has already RESOLVED and the bytes have already gone. Letting the raw
	// CDP error escape said "the call failed" about bytes that left, with no
	// `accepted` facts, no note and no audit row: the model cannot learn the files
	// were sent (so it retries and double-sends) and a real egress leaves no trail.
	// So the calls in this `try` are READS, and a read that failed is evidence of
	// nothing — what the read-back exists to catch is a MISMATCH, found by a read
	// that SUCCEEDED, and every mismatch still throws below.
	let held: InputReadBack | null = null;
	let readback = "";
	try {
		held = await readBack(ctx, record, node.objectId);
	} catch (error) {
		readback = isContextGone(error)
			? "unavailable — the page replaced its document from the change event before the input could be read back"
			: isNodeGone(error)
				? "unavailable — the input was replaced or removed before it could be read back"
				: `unavailable — the read-back failed (${describeError(error)})`;
	}
	if (!readback) {
		if (!held) {
			throw new BrowserHostError("element_not_found", NOT_A_FILE_INPUT, {
				selector,
				accept,
			});
		}
		assertHolds(paths, held, selector, accept);
	}

	// ONE TAIL FOR BOTH OUTCOMES, so the strip's line and the tool result are built
	// from the same facts however the read went: a second copy is how the row and
	// the answer start describing one attach differently. The FACTS are the paths
	// this call was handed (`bytes` is this host's own stat, so the harness's
	// comparison against its re-stat still holds and still catches a mismatch — the
	// marker is what says the DOM was not asked, never a licence to skip the check).
	ctx.registry.touch(record);
	// THE UPLOAD'S OWN LINE IN THE STRIP (review round 1, U3). Recorded HERE rather
	// than by the caller because this is the only place that knows both halves the
	// row needs — the names the call attached and the page they went to — and
	// because a note written anywhere else would be a second account of a transfer.
	const facts = paths.map(factOf);
	const page = pageOf(record.view);
	ctx.downloads.noteUpload(record.tabId, facts, siteOf(page.url));
	return {
		// The selectors that accepted files. One entry today, because the wire takes
		// one `selector`; the field is a list because the result vocabulary is shared
		// with the extension host, whose `DOM.setFileInputFiles` call can address the
		// same shape.
		inputs: [selector],
		accepted: facts,
		// The host's own word about its read: "" when it completed, a sentence when it
		// could not. The harness reports the attach as UNVERIFIED when this is set
		// (`tools/builtin.py`: `verified = count >= 0 and not readback_reported`) rather
		// than turning a completed egress into an error.
		readback,
		// The page's own identity, as every other action reports it: the harness's audit
		// row for this call records the origin the files went TO, and a host that answered
		// without it would leave that row naming nowhere.
		...page,
	};
}

/** The `paths` parameter: a non-empty list of absolute paths.
 *
 * ABSOLUTE is enforced here because the host's job is to hand the browser process
 * paths it can open, and a relative one would resolve against the APP's working
 * directory rather than the session's — a file the user never named. The harness
 * resolves and checks the paths before dispatching; this is the boundary that says
 * so rather than silently attaching something else. */
function uploadPaths(params: Record<string, unknown>): string[] {
	const raw = params.paths;
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new BrowserHostError(
			"internal",
			"upload needs a non-empty list of paths",
			{ param: "paths" },
		);
	}
	const paths: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string" || !entry.trim()) {
			throw new BrowserHostError(
				"internal",
				"every upload path must be a non-empty string",
				{ param: "paths" },
			);
		}
		const path = entry.trim();
		if (!isAbsolute(path)) {
			throw new BrowserHostError(
				"internal",
				`upload needs absolute paths; ${safeName(path)} is not one`,
				{ param: "paths" },
			);
		}
		paths.push(path);
	}
	if (paths.length > CAPS.uploadMaxFiles) {
		throw new BrowserHostError(
			"internal",
			`upload takes at most ${CAPS.uploadMaxFiles} files per call`,
			{ param: "paths", limit: CAPS.uploadMaxFiles },
		);
	}
	return paths;
}

/** The input's own `accept` attribute, or "" when it has none. */
async function acceptsOf(
	ctx: BrowserActionContext,
	record: TabRecord,
	nodeId: number,
): Promise<string> {
	const attributes = await ctx.cdp.send<{ attributes?: string[] }>(
		record.view.webContents,
		"DOM.getAttributes",
		{ nodeId },
	);
	const list = attributes?.attributes ?? [];
	for (let index = 0; index + 1 < list.length; index += 2) {
		if (list[index] === "accept") return list[index + 1] ?? "";
	}
	return "";
}

async function readBack(
	ctx: BrowserActionContext,
	record: TabRecord,
	objectId: string,
): Promise<InputReadBack | null> {
	const answer = await ctx.cdp.send<{
		result?: { value?: InputReadBack | null };
	}>(record.view.webContents, "Runtime.callFunctionOn", {
		objectId,
		functionDeclaration: READ_FILES_FUNCTION,
		returnByValue: true,
	});
	return answer?.result?.value ?? null;
}

/** Compare what the DOM holds to the files that were handed to it.
 *
 * Both sides are named on a mismatch. Size is compared as well as the name
 * because a page that re-created the File objects from something else (a canvas,
 * a fetch) would match on the name and differ on the bytes; the size is the
 * cheapest fact that catches it without reading contents. */
function assertHolds(
	paths: string[],
	held: InputReadBack,
	selector: string,
	accept: string,
): void {
	const expected = paths.map((path) => basename(path));
	const mismatch =
		held.count !== expected.length ||
		expected.some((name, index) => held.names[index] !== name) ||
		paths.some((path, index) => sizeOf(path) !== held.sizes[index]);
	if (!mismatch) return;
	throw new BrowserHostError(
		"internal",
		`the file input did not take the files: it holds ${summarise(held)}, and ${expected.length} were attached (${expected.join(", ")})`,
		{
			selector,
			attached: expected,
			held: held.names,
			accept,
			reason: "read_back_mismatch",
		},
	);
}

function summarise(held: InputReadBack): string {
	if (held.count === 0) return "nothing";
	return `${held.count} file(s) [${held.names.join(", ")}]`;
}

function sizeOf(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return -1;
	}
}

/** The site an upload went to, for the strip's own line: the HOST of the page the
 * action reported, never a URL a caller composed. A URL that will not parse yields
 * "" — the row then says what it can rather than inventing a destination. */
function siteOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

/** The fact Python is told about one attached file. `sha256` is empty for the
 * same reason it is on the download path (§6.1): Python hashes the file it reads,
 * and a host-reported digest would be a host's word taken on trust. */
function factOf(path: string): FileFact {
	return {
		name: basename(path),
		path,
		bytes: sizeOf(path),
		mime: "",
		sniffed: "",
		sha256: "",
	};
}

/** Exported (with its types) so the desktop suite can drive the read-back
 * comparison without a browser, which is the check that decides whether an attach
 * is believed. */
export { assertHolds as assertInputHolds };
export type { InputReadBack };
