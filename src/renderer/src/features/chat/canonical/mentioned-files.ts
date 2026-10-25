/**
 * Which files a conversation mentions, pulled out of the transcript.
 *
 * ## Why this exists
 *
 * A file the agent touched reaches the renderer only as text. The canonical
 * wire carries no list of files the AGENT used — `CanonicalContentBlock`
 * (`src/shared/desktop-session-contract.ts`) now also carries `document` blocks,
 * but those are files the USER sent, not paths an agent read or wrote — so a
 * path survives in exactly four places: prose, tool arguments, tool output, and
 * a diff body. The old producer read `message.files`, which the canonical
 * transcript never carried, and it is gone with the dead `MessageItem` effect.
 *
 * So the panel's content is *inferred* from what the agent wrote. That is a
 * weaker guarantee than a field on the wire, and the whole shape of this module
 * is a consequence: a mention is admitted on evidence, never on resemblance.
 *
 * ## Two tiers, because structured data and prose deserve different trust
 *
 * | Tier | Source | Bar |
 * |---|---|---|
 * | `file-url` | a `file://` URL anywhere | the URL alone; no extension required |
 * | `tool-arg` | a value under a path key in tool `args` | absolute, `~`-prefixed, or resolvable against the session cwd; extension optional |
 * | `prose` | assistant/user text, tool `output`, diff bodies | absolute (or `~`) **and** a known extension |
 * | `artifact` | a generated image/video's digest (see below) | a 32-hex store digest, from a source that states one |
 *
 * A `file://` URL is something the app itself wrote — the canvas hands paths to
 * the OS that way — so it is admitted without asking what the file is. A path
 * *key* in tool arguments is a producer stating an intent ("this call reads
 * `path`, writes `output_file`"), so the key is the evidence and the extension
 * is not needed. Prose is the only place where a string can look like a path
 * without being one, so prose is the only tier that demands both a known shape
 * (absolute) and a known format (extension).
 *
 * ## Artifacts: files that have a digest and no path
 *
 * `generate_image` and `generate_video` register their output in the attachment
 * store (`cache_media`) and the transcript carries only the content digest -
 * never a path - so the four path tiers above cannot see them at all. In one
 * real session 69 generated pictures yielded ZERO mentions. The `artifact` tier
 * reads the three places a digest survives:
 *
 * 1. a tool record's `images[]` entries that the reducer built from an
 *    ARTIFACT block (`kind` set). A legacy image block (no `kind`) is a browser
 *    screenshot or a pasted picture the model was shown; admitting those would
 *    bury the panel under every screenshot the agent ever took (thousands in a
 *    long session), and the ones worth keeping already arrive as a path.
 * 2. `digest <hex>` / `attached: digest <hex>, <hex>` in the output of the
 *    generating tools (`generate_image`, `video_status`), and in a video job's
 *    COMPLETION ROW. A video result is text only - its receipt has no content
 *    block - and `generate_video` itself returns only "Video generation started"
 *    (the job is detached), so the receipt reaches the transcript as a
 *    `job_result` custom row the session manager delivers when the job settles
 *    (`harness/jobs.py` `JOB_RESULT_MESSAGE_TYPE`, `session.py`
 *    `_job_result_message`). That row is the ORDINARY way a video arrives; a
 *    `video_status` call is only the model checking up. Restricted to these
 *    sources: a 32-hex run in `bash` output is a hash, not a file, and bash and
 *    task jobs deliver `job_result` rows too, with arbitrary output.
 * 3. a read path into the attachment store, `.../attachments/<digest>.bin`.
 *    That path used to become an `other` tile for a `.bin` nothing can open; the
 *    digest is in its name, so it is mapped to the artifact it is instead.
 *
 * An artifact mention's `path` is `artifact:<digest>` (`utils/artifact-identity`)
 * so the dedupe-by-path rule below needs no second code path, and its
 * `artifact` field carries what the block stated. The scanner does not know the
 * session (it is a pure function of records); the hook attaches it.
 *
 * ## What is deliberately NOT admitted
 *
 * Relative paths (`src/foo.py`, `node_modules/react/index.js`) are prose noise:
 * in a coding session they are everywhere, they cannot be resolved to a file
 * without guessing a root, and the guess is wrong exactly when it matters. A
 * `file://` URL or a path key can carry a relative candidate because those
 * carry an explicit intent; a bare relative token cannot.
 *
 * A path containing a space (`/Users/x/My Documents/a.pdf`) also falls out, and
 * this is the module's one accepted false negative. It is a trade, not an
 * oversight: recovering it means splitting on whitespace inside a token, which
 * is how a prose scanner invents files that do not exist. A structured value or
 * a `file://` URL recovers the same path when the agent actually worked on it.
 *
 * ## Cost control
 *
 * Extraction is memoised per record **object** in a module-level `WeakMap`,
 * which is the identity contract the reducer already guarantees
 * (`transcript-reducer.ts`: a delta that changes nothing returns the same record
 * object, and the view's memoisation depends on it). A streaming turn therefore
 * re-scans one record per delta instead of the whole transcript, and the
 * `WeakMap` cannot retain a record the transcript has dropped.
 *
 * Pure: no React, no DOM, no Electron. `import type` only, so the module bundles
 * for `node --test` without a browser.
 */

import type { CanvasArtifact } from "@features/chat/types/canvas";
import {
	DIGEST_PATTERN,
	artifactPath,
	digestOfAttachmentBinPath,
} from "@features/chat/utils/artifact-identity";
import { KNOWN_EXTENSIONS } from "@features/chat/utils/file-kind";
import {
	API_PATH_PREFIXES,
	ELLIPSIS_SEGMENT,
	LINE_REFERENCE,
	MAX_CANDIDATE_LENGTH,
	MENTION_POLICY,
	PLACEHOLDER_MARKERS,
	TRAILING_PUNCTUATION,
	WHITESPACE,
	normalizeCandidate,
	targetsIn,
} from "@features/chat/utils/link-grammar";
import type { TranscriptRecord } from "./transcript-reducer";

/** Where a mention was found. Strongest first; the first find wins. */
export type MentionedFileSource =
	| "file-url"
	| "tool-arg"
	| "prose"
	| "artifact";

/**
 * What a transcript stated about an artifact, minus the session it belongs to
 * (which the scanner, being a pure function of records, cannot know).
 */
export type ArtifactMention = Omit<CanvasArtifact, "sessionId">;

export type MentionedPath = {
	/**
	 * The path as the transcript spelled it, with any `file://` prefix removed
	 * and trailing punctuation trimmed.
	 *
	 * `~` is KEPT: expansion belongs to the main process, where `app.getPath("home")`
	 * lives, and doing it here would make the renderer's idea of the home
	 * directory a second, silently wrong answer. A relative candidate is also
	 * kept relative — see `resolveUserPath` in `src/main/index.ts` for the one
	 * resolution rule.
	 */
	path: string;
	source: MentionedFileSource;
	/**
	 * Present exactly when `source` is `artifact`; `path` is then
	 * `artifact:<digest>`, an identity and not a filesystem path.
	 */
	artifact?: ArtifactMention;
};

/**
 * Keys whose value is a path even when it looks like nothing at all.
 *
 * Semantic labels are deliberately absent. `target`, `source`, `dest` and
 * `destination` used to be listed here, and the harness's own `send` tool is
 * what turned that into a defect: `{"target": "50809"}` is a peer PID and
 * `{"target": "lop-bridge-wedge"}` is another session's conversation NAME, and
 * because a cwd was present both were admitted as files and probed to a
 * missing-file tile. A key that means "the thing this call is about" is not a
 * key that means "a path"; the real-path keys below are, and the prose scanner
 * still catches a path that genuinely appears in a `command` string.
 */
const PATH_KEYS = new Set([
	"path",
	"file",
	"files",
	"filepath",
	"file_path",
	"filename",
	"output_path",
	"output_file",
	"directory",
	"dir",
	"cwd",
]);

/**
 * Memo, keyed by the record object the reducer guarantees is stable, and
 * separated per cwd.
 *
 * The cwd belongs in the key because it is an INPUT to extraction
 * (`extractFromArgs` admits a relative path key only when a cwd makes it
 * resolvable), and a transcript's cwd is learned from the canonical frontend a
 * frame or two after the first records arrive. One cache would freeze the
 * cwd-less answer for every record already scanned.
 */
const recordCaches = new Map<
	string,
	WeakMap<TranscriptRecord, MentionedPath[]>
>();

function cacheFor(cwd: string | undefined) {
	const key = cwd ?? "";
	let cache = recordCaches.get(key);
	if (!cache) {
		cache = new WeakMap();
		recordCaches.set(key, cache);
	}
	return cache;
}

/**
 * `file://` URLs in one string, in order.
 *
 * A match that stops at a space whose next token continues the path was
 * truncated by the scanner — `file:///Users/x/My Docs/a.pdf` captures
 * `/Users/x/My` — and a truncated path is dropped rather than guessed. This is
 * the documented cost of not having a quoting grammar, asserted as such in the
 * tests so the trade stays visible.
 *
 * Only a SAME-LINE continuation counts: the guard exists for a URL that
 * contained a space, and a newline is a new line. Narrowing it that way is what
 * lets a plain path list keep its `file://` entry.
 */
function scanFileUrls(text: string): string[] {
	return targetsIn(text, MENTION_POLICY)
		.filter((found) => found.kind === "file-url")
		.map((found) => found.target);
}

/**
 * Bare absolute paths in one string, in order, extension-filtered.
 *
 * `https://…` runs are removed before scanning rather than rejected after: a URL
 * contains a path, and a scanner that sees the path first admits
 * `https://example.com/a/b.png` as `/a/b.png`.
 */
function scanProse(text: string): string[] {
	return targetsIn(text, MENTION_POLICY)
		.filter((found) => found.kind === "path")
		.map((found) => found.target);
}

/**
 * Canonicalise a value that arrived under a path key.
 *
 * Looser than `normalizeCandidate` in exactly one way: a relative path is
 * returned rather than rejected, because the key already said "this is a path"
 * and the cwd decides whether it can be resolved. Everything a URL-shaped or
 * API-shaped string is rejected by is shared with the prose path.
 *
 * ONE difference is enough only because the editor line reference is trimmed here
 * too, in the same order and for the same reason (`LINE_REFERENCE`): round 1's
 * review R1-5 measured the second difference this tier used to carry, where
 * `{"path": "…/run.mjs:59"}` kept the `:59` that prose - and the same spelling
 * under a non-path key - had already stopped naming. A path key says the value is
 * a path, and a `:59` is not part of one, so the two tiers of the panel agree and
 * the extent of that agreement is pinned in `mentioned-files.test.mjs`.
 */
function normalizePathValue(raw: string): string | null {
	const stripped = raw.startsWith("file://")
		? raw.slice("file://".length)
		: raw;
	const candidate = stripped.trim().replace(TRAILING_PUNCTUATION, "");
	if (!candidate) return null;
	if (candidate.length > MAX_CANDIDATE_LENGTH) return null;
	// The line reference, on this tier as well; see this function's docblock.
	const canonical = candidate.replace(LINE_REFERENCE, "");
	if (!canonical) return null;
	if (canonical.includes("://")) return null;
	if (canonical.startsWith("//")) return null;
	if (API_PATH_PREFIXES.some((prefix) => canonical.startsWith(prefix)))
		return null;
	// Whitespace inside a path key's value means the value is prose (a whole
	// command, a sentence), and treating a sentence as a path is how a panel
	// fills with junk. The prose scanner handles those values instead.
	if (WHITESPACE.test(canonical)) return null;
	// A glob, a placeholder or an abbreviation under a path key is still not a
	// file.
	if (PLACEHOLDER_MARKERS.test(canonical)) return null;
	if (ELLIPSIS_SEGMENT.test(canonical)) return null;
	return canonical;
}

/** Every string in an arbitrarily nested argument value, in order. */
function* stringValues(value: unknown): Generator<string> {
	if (typeof value === "string") {
		yield value;
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) yield* stringValues(item);
		return;
	}
	if (value && typeof value === "object") {
		for (const item of Object.values(value as Record<string, unknown>))
			yield* stringValues(item);
	}
}

/**
 * Paths named by a tool call's arguments.
 *
 * Two sources, one tier. A value under a path key is admitted on the key alone.
 * Every OTHER string value is scanned with the prose rules, because a shell
 * command's own text is a real mention — `bash {command: "convert in.png > /tmp/out.png"}`
 * names a file the agent wrote, and the key is `command`, not `path`. The second
 * source is stricter on purpose: it is prose that happens to live in an
 * argument.
 */
export function extractFromArgs(
	args: Record<string, unknown> | null,
	cwd?: string,
): MentionedPath[] {
	if (!args) return [];
	const found: MentionedPath[] = [];
	const seen = new Set<string>();
	const push = (path: string, source: MentionedFileSource) => {
		if (seen.has(path)) return;
		seen.add(path);
		found.push({ path, source });
	};

	for (const [key, value] of Object.entries(args)) {
		if (PATH_KEYS.has(key)) {
			for (const raw of stringValues(value)) {
				// A path key may hold a relative path, so this normaliser accepts one
				// — but a relative candidate is admitted only when a cwd makes it
				// resolvable, and it is stored exactly as written. Resolution happens
				// in main (`resolveUserPath`), so a relative candidate never becomes
				// an invented absolute path here.
				const candidate = normalizePathValue(raw);
				if (!candidate) continue;
				if (candidate.startsWith("/") || candidate.startsWith("~/") || cwd)
					push(candidate, "tool-arg");
			}
			continue;
		}
		// Not a path key. Prose rules, and only over absolute-looking text.
		for (const raw of stringValues(value)) {
			for (const candidate of scanFileUrls(raw)) push(candidate, "tool-arg");
			for (const candidate of scanProse(raw)) push(candidate, "tool-arg");
		}
	}
	return found;
}

/** The text-bearing fields of a record, in the order they are scanned. */
function recordText(record: TranscriptRecord): {
	text: string | null;
	output: string | null;
	diff: string | null;
} {
	switch (record.kind) {
		case "user":
		case "assistant":
			return { text: record.text || null, output: null, diff: null };
		case "tool":
			return {
				text: null,
				output: record.output,
				// Only the `+`/`-`/`@@` body: a diff header (`--- a/x`) is relative
				// and unhelpful, and the structured `args.path` already carries the
				// file the call touched.
				diff: record.diff?.join("\n") ?? null,
			};
		default:
			return { text: null, output: null, diff: null };
	}
}

/**
 * The tools whose result text states the digest of media they generated.
 *
 * An allow-list, not a pattern over every tool: 32 hex characters are an MD5,
 * a UUID without dashes or a cache key in the output of `bash`, `read` and
 * `eval` constantly, and none of those is an artifact. These three are the
 * producers of the two sentences below, so the name is part of the evidence.
 */
const ARTIFACT_TOOLS = new Set([
	"generate_image",
	"generate_video",
	"video_status",
	// The two audio producers (sound phase): their artifacts arrive with a block
	// exactly as an image's does, but a result whose block was pruned still
	// states the digest in prose, and the allow-list is what admits that receipt
	// without admitting every hex string a bash row prints.
	"generate_voiceover",
	"generate_sound_effect",
]);

/**
 * The receipt sentence a settled VIDEO job delivers (`video/jobs.py`
 * `finish_video_result`): `Video ready - job <id> ... attached: digest <hex>`.
 *
 * It is the gate on a `job_result` row, and the sentence rather than the bare
 * word `digest` on purpose: a `job_result` row carries whatever a bash or task
 * job printed, and "manifest digest <hex>" from a checksum tool is not media.
 * Anchored to a line start (`m`) because the row's body is
 * `background job '<label>' completed:\n<receipt>` - the receipt is its own line.
 */
const VIDEO_RECEIPT = new RegExp(
	`^Video ready \\u2014 job [^\\n]*?attached: digest\\s+${DIGEST_PATTERN}`,
	"m",
);

/**
 * `digest <hex>` and `attached: digest <hex>, <hex>` (`image_tool.py` caption,
 * `video/jobs.py` receipt). The list form is what a multi-asset result prints,
 * so one match yields several digests. Anchored on the word `digest`, never on
 * bare hex, so a hash printed beside other text is not read.
 */
const DIGEST_PHRASE = new RegExp(
	`digest\\s+(${DIGEST_PATTERN}(?:\\s*,\\s*${DIGEST_PATTERN})*)`,
	"g",
);
const DIGEST_TOKEN = new RegExp(DIGEST_PATTERN, "g");

/**
 * The artifact mentions one tool record states, in the order it states them.
 *
 * Structured first: a block with metadata (name, dimensions, content type) beats
 * the same digest named in prose, and the caller keeps the FIRST mention of an
 * identity, so the richer one must be produced first.
 */
function artifactMentionsOf(record: TranscriptRecord): MentionedPath[] {
	const found: MentionedPath[] = [];
	const push = (digest: string, artifact: ArtifactMention) =>
		found.push({
			path: artifactPath(digest),
			source: "artifact",
			artifact,
		});
	if (record.kind === "custom") {
		// A detached video job's completion, delivered as a `job_result` row (see
		// the module header). Kind comes from the sentence: only a video job writes it.
		if (record.customType === "job_result" && VIDEO_RECEIPT.test(record.text)) {
			for (const phrase of record.text.matchAll(DIGEST_PHRASE)) {
				for (const digest of phrase[1].match(DIGEST_TOKEN) ?? [])
					push(digest, { digest, kind: "video" });
			}
		}
		return found;
	}
	if (record.kind !== "tool") return found;
	for (const image of record.images) {
		// A block without `kind` is a legacy image (a browser screenshot, a
		// pasted picture): not generated media. See the module header.
		if (!image.attachment || image.kind === undefined) continue;
		/*
		 * AUDIO IS ADMITTED NOW (sound phase). It used to be skipped because the
		 * Files list had no seat a sound could take; the "Sounds" section and its
		 * band are that seat, so the mention reaches the authoritative list the
		 * same way a video's does — and an artifact whose kind no surface can
		 * render would be the F2 class of defect, not a cautious omission.
		 */
		const artifact: ArtifactMention = {
			digest: image.attachment,
			kind: image.kind,
			contentType: image.mimeType,
		};
		if (image.name) artifact.name = image.name;
		if (typeof image.sizeBytes === "number")
			artifact.sizeBytes = image.sizeBytes;
		if (typeof image.width === "number") artifact.width = image.width;
		if (typeof image.height === "number") artifact.height = image.height;
		if (typeof image.durationS === "number")
			artifact.durationS = image.durationS;
		push(image.attachment, artifact);
	}
	if (ARTIFACT_TOOLS.has(record.toolName) && record.output) {
		// A video result is text only, so its kind comes from the tool that
		// produced it. `video_status` and `generate_video` are the video tools; a
		// voiceover or a sound effect is the audio lane's (a `digest` phrase in
		// its text means the same store the block path reads); an image caption
		// always arrives with a block (above) when not pruned.
		const kind =
			record.toolName === "generate_image"
				? "image"
				: record.toolName === "generate_voiceover" ||
						record.toolName === "generate_sound_effect"
					? "audio"
					: "video";
		for (const phrase of record.output.matchAll(DIGEST_PHRASE)) {
			for (const digest of phrase[1].match(DIGEST_TOKEN) ?? [])
				push(digest, { digest, kind });
		}
	}
	return found;
}

/**
 * The artifact a read path into the attachment store stands for.
 *
 * The record's own image block for that digest, when it has one, says what the
 * bytes are; otherwise they are treated as an image (the store's `.bin` reads in
 * real transcripts are pasted screenshots), and the viewer's decode check is the
 * backstop for the rare video.
 */
function artifactForBinPath(
	digest: string,
	record: TranscriptRecord,
): ArtifactMention {
	const block =
		record.kind === "tool"
			? record.images.find((image) => image.attachment === digest)
			: undefined;
	/*
	 * Three kinds, the block's own first: a `.bin` path read in a real transcript
	 * is usually a pasted screenshot, so "image" is the default — but a video or
	 * a sound block that names this digest is the better evidence, and the sound
	 * phase's blocks are what make a `generate_voiceover` read path land in the
	 * Sounds section instead of a picture tile.
	 */
	const artifact: ArtifactMention = {
		digest,
		kind:
			block?.kind === "video"
				? "video"
				: block?.kind === "audio"
					? "audio"
					: "image",
	};
	if (block?.mimeType) artifact.contentType = block.mimeType;
	return artifact;
}

/** Extract from one record, in tier order so the stronger source wins. */
function extractFromRecord(
	record: TranscriptRecord,
	cwd?: string,
): MentionedPath[] {
	const { text, output, diff } = recordText(record);
	const found: MentionedPath[] = [];
	const seen = new Set<string>();
	const push = (path: string, source: MentionedFileSource) => {
		// A read path into the attachment store is an ARTIFACT's address, not a
		// file the user has: map it to the identity it names rather than to a
		// `.bin` tile. Done here, at the single admission point every path tier
		// passes through, so no tier can leak one.
		const digest = digestOfAttachmentBinPath(path);
		if (digest !== null) {
			const identity = artifactPath(digest);
			if (seen.has(identity)) return;
			seen.add(identity);
			found.push({
				path: identity,
				source: "artifact",
				artifact: artifactForBinPath(digest, record),
			});
			return;
		}
		if (seen.has(path)) return;
		seen.add(path);
		found.push({ path, source });
	};

	// Tier 0: generated media, which has a digest and never a path.
	for (const mention of artifactMentionsOf(record)) {
		if (seen.has(mention.path)) continue;
		seen.add(mention.path);
		found.push(mention);
	}
	// Tier 1: a `file://` URL anywhere in the record's own words.
	for (const body of [text, output]) {
		if (!body) continue;
		for (const candidate of scanFileUrls(body)) push(candidate, "file-url");
	}
	// Tier 2: path keys and command text in tool arguments.
	if (record.kind === "tool") {
		for (const mention of extractFromArgs(record.args, cwd))
			push(mention.path, "tool-arg");
	}
	// Tier 3: prose, output and diff bodies.
	for (const body of [text, output, diff]) {
		if (!body) continue;
		for (const candidate of scanProse(body)) push(candidate, "prose");
	}
	return found;
}

/**
 * Every path the records mention, in first-mention order.
 *
 * Order is the record list's own order — the reducer keeps it chronological,
 * durable pages before live — and within a record it is tier order, so a path
 * named both in prose and in a `read` call is reported once, at its strongest
 * source. Nothing is ever re-sorted: a re-scan after an older page arrives must
 * not shuffle entries a reader is already looking at, and the store's append
 * order is the only order the panel has.
 *
 * ## There is no output cap, and its absence is the fix
 *
 * This used to stop at 200 candidates. Because records only ever append and a
 * re-scan restarts from record 0 in the same order, the same first 200 mentions
 * came back on every pass — so paths 201+ were not merely delayed, they were
 * unreachable for the life of the conversation, and `use-mentioned-files` saw
 * an empty delta and stopped probing. Measured on this machine's own durable
 * store, 23 of 1,735 sessions returned exactly 200 paths and one real session
 * lost ~1,700 of them. A scan bound belongs at the SCAN (how far back the
 * producer pages, which the panel states and can extend); an output bound here
 * dropped files silently, which is the failure the panel exists to prevent.
 *
 * Cost is bounded without it: the per-record memo means a re-scan is O(new
 * records), and the number of paths is bounded by the conversation itself.
 */
export function extractMentionedPaths(
	records: readonly TranscriptRecord[],
	cwd?: string,
): MentionedPath[] {
	const found: MentionedPath[] = [];
	const seen = new Set<string>();
	for (const record of records) {
		const cache = cacheFor(cwd);
		let perRecord = cache.get(record);
		if (!perRecord) {
			perRecord = extractFromRecord(record, cwd);
			cache.set(record, perRecord);
		}
		for (const mention of perRecord) {
			if (seen.has(mention.path)) continue;
			seen.add(mention.path);
			found.push(mention);
		}
	}
	return found;
}

/** Re-exported so a caller deciding "is this a file?" asks the same set. */
export { KNOWN_EXTENSIONS };

/**
 * The grammar's own canonicaliser, re-exported rather than copied.
 *
 * It moved to `link-grammar.ts` with the rest of the token grammar, and the
 * tests that pin its rejection rules one at a time still import it from here
 * (`scripts/mentioned-files.test.mjs`) - so a reader who came for the panel
 * finds the rule where the panel's own answer is decided instead of following a
 * second definition. There is one implementation; this is a name for it.
 */
export { normalizeCandidate };
