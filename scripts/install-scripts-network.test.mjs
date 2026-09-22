import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

/*
 * The first-run install scripts under `src/main/backend/scripts/` must not fetch
 * a third-party binary, and every URL one names must be on a short justified
 * list.
 *
 * WHY THIS EXISTS. All three scripts used to download FFmpeg from
 * `github.com/eugeneware/ffmpeg-static/releases/download/b6.0/` into
 * `$APP_DATA_DIR/bin/ffmpeg`. On macOS BOTH asset names were wrong
 * (`ffmpeg-mac-arm64` and `ffmpeg-mac-x64`; the release publishes
 * `ffmpeg-darwin-arm64`), and `curl` without `--fail` treats a 404 as a
 * successful transfer: the 9-byte `Not Found` body was written to the binary
 * path, `chmod +x` made it "executable", the script's own `[ -f ] && [ -x ]`
 * verification passed, and the next run's presence check made the broken file
 * permanent. Nothing in the app or in `local-operator` ever executed it, and
 * because both shell scripts run under `set -e`, a failed download was fatal
 * BEFORE the venv was created - so a machine that can reach PyPI but not
 * github.com could not install at all.
 *
 * THE INVARIANT, and why it is stated this way rather than as a list of
 * forbidden commands: **a URL cannot be added to one of these scripts without
 * this file going red, whatever fetches it, and it cannot be admitted for a
 * script it was not justified for.** Every URL-shaped literal on every CODE line
 * must be a key of `URL_USE`, and that key names the scripts it is admitted for.
 * Four earlier shapes failed and are the reason for this one: a vocabulary of
 * client names (`Invoke-RestMethod`, `urllib.request.urlretrieve` and a fetcher
 * held in a shell variable all walked through it), a hardcoded script list (a
 * fourth installer script was covered by nothing, and no other test in the tree
 * enumerates that directory), a bound check by substring over the raw line (a
 * fetch could carry `--max-time` in a trailing comment, or `--max-time 0`), and
 * an inventory keyed by URL alone (an entry justified for one installer licensed
 * every installer).
 *
 * WHAT IS PINNED
 *
 *  - the `src/main/backend/scripts/` DIRECTORY is enumerated and asserted against
 *    `EXPECTED_SCRIPTS` plus `EXPECTED_OTHER_ENTRIES`, so a new installer of any
 *    name or extension - not only `.sh`/`.ps1` - fails here until it is added
 *    deliberately;
 *  - no release asset (`releases/download` and GitHub's `releases/latest/
 *    download` alias), no binary or archive payload, and no FFmpeg token on any
 *    code line;
 *  - every URL on a code line is in `URL_USE` with its reason, is admitted for
 *    THAT script, and its host is in `HOSTS`; the set of scripts naming each URL
 *    must equal the scripts its entry declares, so a dead entry cannot sit in the
 *    list and a live fetch cannot hide behind one;
 *  - a URL on a print-only line must name a declared prose host or an allowlisted
 *    URL, and such a line may not run a command substitution - `echo "$(curl ...)"`
 *    is a fetch behind a message, and the honest answer to it is red rather than
 *    a rule that has to guess;
 *  - every fetch carries a POSITIVE bound (`[1-9]\d*`), checked against the CODE
 *    with comments stripped and continuations joined, and with the real spellings
 *    accepted - `--max-time 30`, `--max-time=30` and `-m30` all bound a curl;
 *  - a code line that names a URL must invoke a fetch client this file knows, so
 *    an unrecognised client is refused rather than skipped; clients whose bound is
 *    not one flag are named in `UNBOUNDED_BY_DESIGN` with a reason instead of
 *    passing silently;
 *  - a URL built from a shell identifier (`https://${server}`) requires that
 *    identifier to be bound EXACTLY ONCE in the file, so the hosts it can hold are
 *    the ones the array beside it names;
 *  - nothing in these scripts may name the app data directory's `bin/`: that is
 *    the path the deleted block created, the path the CI assertion asserts absent,
 *    and the destination the regression reused when it was re-introduced into the
 *    wrong script;
 *  - the shell scripts still parse (`bash -n`), and the PowerShell one is parsed
 *    where a parser exists.
 *
 * WHERE THIS FILE STOPS, said plainly rather than promised away. Three limits,
 * each of them measured or reasoned rather than assumed:
 *
 *  - a URL assembled at runtime from pieces that never appear whole on one line
 *    (a scheme built by concatenation, a host read from the environment) is not
 *    visible to any rule here - that is the shape no textual guard can see;
 *  - this file examines ONE directory. A script placed anywhere else in the tree
 *    is outside it, which is why the workflow's `paths:` filter on
 *    `src/main/backend/scripts/**` is load-bearing;
 *  - the probes' content-type check proves the answer came back as JSON, not that
 *    it is PyPI's JSON: a proxy answering 200 with `application/json` and an error
 *    body is silent, and so is any client in `UNBOUNDED_BY_DESIGN`, whose bound is
 *    a review question rather than a pattern.
 *
 * Everything a fetch must name literally to work is covered.
 *
 * The scripts are read from the tree as text, because text is what ships; the
 * parse checks are the only executable part, and they cannot use a model of the
 * scripts in place of them.
 */

const SCRIPTS_DIR = "src/main/backend/scripts";

const LINUX_SCRIPT = "src/main/backend/scripts/linux-install-script.sh";
const MACOS_SCRIPT = "src/main/backend/scripts/macos-install-script.sh";
const WINDOWS_SCRIPT = "src/main/backend/scripts/windows-install-script.ps1";

/** The installers this repository ships. The directory listing must match this. */
const EXPECTED_SCRIPTS = [LINUX_SCRIPT, MACOS_SCRIPT, WINDOWS_SCRIPT];

/**
 * The other entries `src/main/backend/scripts/` holds, with the reason each is
 * not an installer.
 *
 * The listing is asserted WHOLE rather than filtered by extension: a `.bash`,
 * a `.cmd`, or an extensionless `bootstrap-installer` carrying the deleted block
 * was green under an extension filter (QA round 2, Q12), and the cheap honest fix
 * is to make this directory's contents an explicit list that a new file has to
 * join deliberately. That is also why a `.ts` helper landing here would fail
 * until it is added: this directory is what the app bundles and runs at first
 * run, and everything in it should be something a reader has classified.
 */
const EXPECTED_OTHER_ENTRIES = [
	//
	// The module that imports the three scripts as raw strings for the app to run,
	// and the ambient declaration that lets it:
	// `declare module "*.sh?raw"`. Neither is an installer and no rule below applies
	// to either.
	"src/main/backend/scripts/index.ts",
	"src/main/backend/scripts/raw-imports.d.ts",
];

/** Every entry in the directory, sorted, for the comparison against the lists. */
function directoryEntries() {
	return readdirSync(SCRIPTS_DIR)
		.map((name) => `${SCRIPTS_DIR}/${name}`)
		.sort();
}

const SCRIPTS = directoryEntries().filter(
	(entry) => entry.endsWith(".sh") || entry.endsWith(".ps1"),
);
const SHELL_SCRIPTS = SCRIPTS.filter((script) => script.endsWith(".sh"));
const POWERSHELL_SCRIPTS = SCRIPTS.filter((script) => script.endsWith(".ps1"));

/**
 * Every URL these scripts may name on a code line, the scripts it is admitted
 * for, and the reason it remains.
 *
 * `scripts` is load-bearing: a URL admitted for Windows is not admitted for
 * macOS, because that is how the deleted regression comes back - the pyenv-win
 * source archive fetched in the macOS script and expanded into the app data
 * directory was green against the round-1 guard, which keyed its admission by
 * URL alone (agent review round 2, R2-1). `reason` is prose a reviewer weighs
 * rather than something a machine can check; what IS checked is that the list is
 * short, that every entry is used by exactly the scripts it declares, and that
 * an entry admitting a payload shape says why.
 *
 * The scripts naming each entry must equal its `scripts` exactly, so a dead entry
 * cannot sit here looking like a justification (QA round 2, Q11) and a live fetch
 * cannot borrow one.
 */
const URL_USE = new Map([
	[
		"https://pypi.org/pypi/local-operator/json",
		{
			scripts: [MACOS_SCRIPT, LINUX_SCRIPT],
			reason:
				"the PyPI reachability probe on macOS and Linux - a bounded, warning-only diagnostic that stands in front of the install so a broken network is named before pip fails, and that checks the answer's content type so a captive portal's HTML page cannot read as reachable. It proves the answer came back as JSON, not that it is PyPI's JSON: a proxy answering 200 with an application/json error body is silent, which is stated in both scripts where the check lives",
		},
	],
	[
		"https://pypi.org",
		{
			scripts: [MACOS_SCRIPT],
			reason:
				"the macOS install-failure path's PyPI diagnosis, which runs only after pip has already failed",
		},
	],
	[
		"https://bootstrap.pypa.io/get-pip.py",
		{
			scripts: [LINUX_SCRIPT],
			reason:
				"pip's own bootstrap script, fetched only when a venv came up with no pip at all (the Linux script's last-resort fallback), into the app data directory where the script's own cleanup trap removes it",
		},
	],
	[
		"https://github.com/pyenv-win/pyenv-win/archive/master.zip",
		{
			scripts: [WINDOWS_SCRIPT],
			reason:
				"Windows' Python provisioning, and nothing else: a SOURCE archive rather than a binary payload - the archive's own contents are what downloads the platform's Python - and the fetch the Windows install genuinely cannot do without",
			admittedPayload:
				"the archive extension list bans `.zip`; this URL is the one entry allowed to match it, for the WINDOWS script alone",
		},
	],
	[
		"https://${server}",
		{
			scripts: [LINUX_SCRIPT],
			reason:
				"the Linux connectivity check's two hosts, spelled in its own `servers` array rather than as literals - the identifier is asserted to be bound exactly once, so it cannot be repointed at a third host",
		},
	],
]);

/**
 * Hosts these scripts may name on a code line. `github.com` is here only for
 * pyenv-win's source archive; a release asset from it, or from anywhere else, is
 * banned by shape above and cannot be admitted by adding it to `URL_USE`.
 */
const HOSTS = new Map([
	["pypi.org", "the index the install installs from"],
	["bootstrap.pypa.io", "pip's bootstrap script"],
	["github.com", "pyenv-win's source archive on Windows only (see URL_USE)"],
]);

/**
 * Hosts that may be named on a line whose whole job is printing text.
 *
 * Print-only lines are relaxed for the URL rule - a message that names the Python
 * download page is guidance, not a fetch - but not for the host rule, so a URL
 * cannot be smuggled in behind an `echo` without appearing here, and not for the
 * command-substitution rule below: `echo "$(curl ...)"` is a fetch wearing a
 * message, and it is red rather than analysed. (An earlier version of this
 * comment declared that a fetch behind a print-only line went unbound; it does
 * not - the bound rule runs on those lines too, because `fetchLines` does not
 * consider `MESSAGE_LINE` - and the rule that was missing is the one below.)
 */
const PROSE_HOSTS = new Map([
	[
		"www.python.org",
		"the Python download page the Linux error messages point at",
	],
]);

/** A line whose whole job is to print: a URL on one is prose, not a fetch. */
const MESSAGE_LINE =
	/^\s*(?:echo|log|_log\w*|error_exit|Write-(?:Output|Error|Host|Warning|Debug))\b/;

/**
 * The bodies of the command substitutions on a line: `$(...)` with nesting, and
 * backtick pairs.
 *
 * Used to ask whether a URL sits INSIDE a substitution, which is the difference
 * between a message that mentions a URL and a message that fetches one. A
 * PowerShell subexpression that interpolates a property - `"$($_.Exception.Message)"`
 * - is not a fetch, and a rule that treated every `$(` as one would red an
 * ordinary error message (the first draft of this rule did exactly that, and the
 * Windows script's failure message caught it). `Write-Error "... $(curl ... <url>)"`
 * is a fetch, and that is what this finds.
 */
function substitutionBodies(line) {
	const bodies = [];
	for (let index = 0; index < line.length; index += 1) {
		if (line[index] === "$" && line[index + 1] === "(") {
			let depth = 0;
			for (let cursor = index + 1; cursor < line.length; cursor += 1) {
				if (line[cursor] === "(") depth += 1;
				else if (line[cursor] === ")") {
					depth -= 1;
					if (depth === 0) {
						bodies.push(line.slice(index + 2, cursor));
						index = cursor;
						break;
					}
				}
			}
		} else if (line[index] === "`") {
			const end = line.indexOf("`", index + 1);
			if (end !== -1) {
				bodies.push(line.slice(index + 1, end));
				index = end;
			}
		}
	}
	return bodies;
}

/**
 * Payload shapes that make a URL a third-party binary download.
 *
 * `releases/.../download` is checked against the WHOLE file, comments included:
 * no script has any business naming a release asset, and the string is the exact
 * shape this change deletes. GitHub serves the same class of asset under
 * `releases/latest/download/...`, which an earlier revision of this rule missed.
 * The rest are checked against CODE lines only (comments stripped), because the
 * comment recording WHY the fetch was deleted has to be able to name it - a rule
 * that reds on its own explanation is a rule people delete.
 */
const PAYLOAD_ANYWHERE = [
	[
		/releases\/(?:latest\/)?download/,
		"a GitHub release asset is a third-party binary payload - acquire it through the app's Console with the user's approval instead of at install time",
	],
];
const PAYLOAD_CODE = [
	[
		/ffmpeg/i,
		"the deleted FFmpeg block: the asset it asked for does not exist under that name, nothing consumes the binary, and its `[ -f ] && [ -x ]` verification passes on a 404 body",
	],
];

/**
 * URL literals that name a packaged binary or an archive.
 *
 * `.exe` is checked here rather than anywhere else because it is also the
 * correct suffix for files the Windows script creates locally
 * (`$VenvPath\Scripts\local-operator.exe`). An entry's `admittedPayload` field is
 * the only way past this rule, it is keyed to that URL, and the URL is in turn
 * admitted for named scripts only - so the exemption cannot be borrowed by another
 * installer or by a differently-named archive.
 */
const PAYLOAD_URL = [
	[
		/\.(?:exe|dmg|pkg|msi|deb|rpm|appimage|bin|zip|tgz|tar\.gz|tar\.xz|xz|gz)(?:$|[?#])/i,
		"names a packaged binary or an archive - the shapes a prebuilt tool actually arrives in, and the install has no business fetching one",
	],
];

/**
 * Paths under the app data directory that no script may name.
 *
 * `bin/` is where the deleted block put its download, and where the round-2
 * regression went when the same archive URL was fetched in the macOS script and
 * expanded there. The directory-subject CI assertion in
 * `.github/workflows/install-scripts-check.yml` covers the paths those jobs walk;
 * this covers the text, on any platform, for every script. A future feature that
 * legitimately needs a `bin/` under the app data directory has to change this
 * rule and that assertion deliberately - which is the point.
 */
const BANNED_APP_DATA_PATHS = [
	[
		/\$\{?APP_DATA_DIR\}?[\\/]bin\b/,
		"the app data directory's bin/ is where the deleted third-party download was cached, and nothing may be written or read there",
	],
	[
		/\$AppDataDir[\\/]bin\b/i,
		"the app data directory's bin/ is where the deleted third-party download was cached on Windows, and nothing may be written or read there",
	],
	[
		/\$\{?BIN_DIR\}?\b|\$BinDir\b/i,
		"BIN_DIR/$BinDir was the variable the deleted block created the download directory with",
	],
];

/**
 * Fetch clients whose bound this file can name, with the flag each requires.
 *
 * THE VALUE MUST BE POSITIVE (`[1-9]\d*`), and every client here treats `0` as
 * the opposite of a bound rather than as an instantaneous one: curl's manual,
 * "Setting the timeout to 0 disables it altogether"; wget's, "Setting a timeout
 * to 0 disables it altogether" and `-t 0` is "infinite retrying"; and
 * PowerShell's `-TimeoutSec`, whose own description of its 0 is "an indefinite
 * time-out". A rule that accepted `0` would enforce claim 2 with a spelling that
 * bounds nothing - the round-1 trailing-comment hole, one level down (agent
 * review round 2, R2-2; QA round 2, Q7).
 *
 * The short spellings are accepted in every form the clients accept them,
 * including ATTACHED values (`-m30`), because a rule that reds a correct spelling
 * teaches people to route around it (R1-6, R2-4, Q13).
 *
 * `-TimeoutSec` is listed for the shipped path and does not mean the same thing
 * on both PowerShells in play: Windows PowerShell 5.1 (what the app spawns, via
 * `powershell.exe`) takes it as the request's timeout, while 7.4+ renamed the
 * total to `-OperationTimeoutSeconds` and made `-TimeoutSec` an alias of
 * `-ConnectionTimeoutSeconds`. The spelling therefore has to stay, and the
 * asymmetry is stated where the call is rather than papered over (QA round 2,
 * Q14).
 */
const FETCH_CLIENTS = [
	{
		spellings: ["curl"],
		invocation: /\bcurl\s+(?=[-"'$]|https?:\/\/)/,
		bounds: [
			[
				"--connect-timeout",
				/--connect-timeout(?:=|[ \t]+)[1-9]\d*/,
				"a connect that never completes is what a black-hole network looks like, and no other flag ends it (and 0 disables the bound rather than making it immediate)",
			],
			[
				"--max-time (or -m)",
				/(?:--max-time(?:=|[ \t]+)[1-9]\d*)|(?:(?:^|[ \t])-m=?[1-9]\d*)/,
				"a connected-but-stalled peer needs a total bound; without one this hangs behind the spinner indefinitely (and 0 disables the bound)",
			],
		],
	},
	{
		spellings: ["wget"],
		invocation: /\bwget\s+(?=[-"'$]|https?:\/\/)/,
		bounds: [
			[
				"--timeout (or -T)",
				/(?:--timeout(?:=|[ \t]+)[1-9]\d*)|(?:(?:^|[ \t])-T=?[1-9]\d*)/,
				"wget's timeout covers connect and read, which is all the bound it offers (and 0 disables it)",
			],
			[
				"--tries (or -t)",
				/(?:--tries(?:=|[ \t]+)[1-9]\d*)|(?:(?:^|[ \t])-t=?[1-9]\d*)/,
				"the default retry count turns one stalled host into a long silence, and 0 means retry forever",
			],
		],
	},
	{
		spellings: ["Invoke-WebRequest", "iwr"],
		invocation: /\b(?:Invoke-WebRequest|iwr)\s+(?=[-"'$]|https?:\/\/)/,
		bounds: [
			[
				"-TimeoutSec",
				/-TimeoutSec(?:[ \t]+|=)[1-9]\d*/,
				"PowerShell's bound on the request; without it the call waits indefinitely, and 0 is documented as an indefinite time-out",
			],
		],
	},
	{
		spellings: ["Invoke-RestMethod", "irm"],
		invocation: /\b(?:Invoke-RestMethod|irm)\s+(?=[-"'$]|https?:\/\/)/,
		bounds: [
			[
				"-TimeoutSec",
				/-TimeoutSec(?:[ \t]+|=)[1-9]\d*/,
				"PowerShell's bound on the request; without it the call waits indefinitely, and 0 is documented as an indefinite time-out",
			],
		],
	},
];

/**
 * Fetch clients whose bound is not expressible as one flag this file can assert,
 * with the reason. Each is a named hole rather than a silent pass: the URL rule
 * still applies to whatever it fetches - the client is recognised so its line is
 * examined - and a bound for it is a review question rather than a pattern.
 */
const UNBOUNDED_BY_DESIGN = [
	{
		name: "Start-BitsTransfer",
		invocation: /\bStart-BitsTransfer\b/,
		why: "its own transfer/job lifecycle carries the bound (priority, retry interval, job polling), so no single flag is the answer",
	},
	{
		name: "System.Net.WebClient",
		invocation: /(?:\bSystem\.Net\.)?\bWebClient\b/,
		why: "the bound is a property on the object (`Timeout`), not an argument on the call",
	},
	{
		name: "python urllib",
		invocation: /\burl(?:retrieve|open)\b/,
		why: "the bound is the `timeout=` argument, which is not reliably present in a one-liner; a Python fetch belongs in the app instead",
	},
];

/**
 * Each spelling a client claims, with a call that carries no bound, so the
 * self-check can prove the invocation pattern fires on every one of them.
 */
const CLIENT_SPELLINGS = [
	["curl", "curl -sL https://pypi.org/pypi/local-operator/json -o /dev/null"],
	["wget", "wget -q --spider https://pypi.org/pypi/local-operator/json"],
	[
		"Invoke-WebRequest",
		'Invoke-WebRequest -Uri https://pypi.org/pypi/local-operator/json -OutFile "$x"',
	],
	["iwr", 'iwr https://pypi.org/pypi/local-operator/json -OutFile "$x"'],
	[
		"Invoke-RestMethod",
		'Invoke-RestMethod -Uri https://pypi.org/pypi/local-operator/json -OutFile "$x"',
	],
	["irm", 'irm https://pypi.org/pypi/local-operator/json -OutFile "$x"'],
];

const URL_LITERAL = /https?:\/\/[^\s"'`)]+/g;
const URL_HOST = /[/:?#]/;
const SERVERS_ARRAY = /servers=\(([^)]*)\)/;
const SERVERS_ENTRY = /"([^"]+)"/g;
/** A `$name` or `${name}` inside a URL - the identifier whose value becomes the host. */
const URL_INTERPOLATION =
	/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
/** A statement continued onto the next line, in either dialect's spelling. */
const CONTINUATION = /(?:\\|`)\s*$/;
/** The punctuation a URL can pick up from the sentence around it. */
const TRAILING_PUNCTUATION = /[.,;:]+$/;

function text(script) {
	return readFileSync(script, "utf8");
}

/**
 * A script's CODE lines, with comments removed and continuations joined.
 *
 * Three things this has to get right, each of them a hole an earlier revision
 * left open:
 *
 *  - whole-line comments are dropped, because the comment recording why the
 *    FFmpeg download was deleted names FFmpeg;
 *  - a TRAILING comment is stripped from each line, because the bound rule was a
 *    substring test over the raw line and a fetch carrying `--max-time` in a
 *    comment beside it passed while curl received no bound at all;
 *  - a statement continued with a backslash (shell) or a backtick (PowerShell) is
 *    ONE logical line, so a bound written on the continuation counts, and a cut
 *    line cannot split a fetch from its bound.
 *
 * The comment stripper is quote-aware: it takes the first `#` outside a quoted
 * string.
 */
function codeLines(script) {
	const joined = [];
	let pending = null;
	for (const [index, raw] of text(script).split("\n").entries()) {
		const number = pending?.number ?? index + 1;
		const line = pending ? `${pending.text} ${raw.trim()}` : raw;
		const continued = CONTINUATION.test(line);
		const text_ = continued ? line.replace(CONTINUATION, "") : line;
		if (continued) {
			pending = { text: text_, number };
			continue;
		}
		pending = null;
		const code = stripTrailingComment(text_).trim();
		if (code === "" || code.startsWith("#")) continue;
		joined.push({ text: code, number });
	}
	return joined;
}

/** The first `#` outside a quoted string ends the code; everything after it is prose. */
function stripTrailingComment(line) {
	let quote = null;
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (quote) {
			if (character === quote && line[index - 1] !== "\\") quote = null;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (character === "#") return line.slice(0, index);
	}
	return line;
}

/** The script's code as one string, for the rules that count occurrences. */
function codeText(script) {
	return codeLines(script)
		.map(({ text: line }) => line)
		.join("\n");
}

/** Every code line that invokes one of the clients this file knows. */
function fetchLines(script) {
	const found = [];
	for (const { text: line, number } of codeLines(script)) {
		for (const client of FETCH_CLIENTS) {
			if (client.invocation.test(line)) found.push({ line, number, client });
		}
		for (const { name, invocation } of UNBOUNDED_BY_DESIGN) {
			if (invocation.test(line)) {
				found.push({ line, number, client: { spellings: [name], bounds: [] } });
			}
		}
	}
	return found;
}

test("every entry under the installers' directory is one this file examines", () => {
	const entries = directoryEntries();
	assert.ok(
		entries.length > 0,
		`no file found under ${SCRIPTS_DIR} - this file examines nothing`,
	);
	assert.deepEqual(
		entries,
		[...EXPECTED_SCRIPTS, ...EXPECTED_OTHER_ENTRIES].sort(),
		`${SCRIPTS_DIR} holds something this file does not account for. Add it to EXPECTED_SCRIPTS (and check it against every rule below) or to EXPECTED_OTHER_ENTRIES with the reason it is not an installer - deliberately, rather than shipping it unguarded.`,
	);
});

test("no install script fetches a third-party binary payload", () => {
	for (const script of SCRIPTS) {
		for (const [pattern, why] of PAYLOAD_ANYWHERE) {
			const hit = text(script)
				.split("\n")
				.findIndex((line) => pattern.test(line));
			assert.equal(hit, -1, `${script}:${hit + 1} matches ${pattern} - ${why}`);
		}
		for (const [pattern, why] of PAYLOAD_CODE) {
			const hit = codeLines(script).find(({ text: line }) =>
				pattern.test(line),
			);
			assert.ok(!hit, `${script}:${hit?.number} matches ${pattern} - ${why}`);
		}
		for (const { text: line, number } of codeLines(script)) {
			for (const url of urlsOn(line)) {
				// The single way past the payload-shape ban is an entry's own
				// `admittedPayload`, and that entry is admitted for named scripts
				// only - which the per-script rule below asserts separately.
				if (URL_USE.get(url)?.admittedPayload) continue;
				for (const [pattern, why] of PAYLOAD_URL) {
					assert.ok(
						!pattern.test(url),
						`${script}:${number} names ${url}, which ${why}`,
					);
				}
			}
		}
	}
});

test("nothing names a path under the app data directory's bin", () => {
	for (const script of SCRIPTS) {
		for (const { text: line, number } of codeLines(script)) {
			for (const [pattern, why] of BANNED_APP_DATA_PATHS) {
				assert.ok(
					!pattern.test(line),
					`${script}:${number} names a path ${pattern} matches: ${why}. The installer fetches nothing into the app data directory, and the CI job asserts that directory's bin/ is absent: ${line}`,
				);
			}
		}
	}
});

test("every URL a code line names is admitted, for THAT script", () => {
	for (const script of SCRIPTS) {
		for (const { text: line, number } of codeLines(script)) {
			const urls = urlsOn(line);
			if (urls.length === 0) continue;
			if (MESSAGE_LINE.test(line)) {
				// A message may repeat a URL the allowlist already justifies (the
				// pyenv-win failure names what failed with), or name a declared
				// prose host - and nothing else. A URL INSIDE a command substitution
				// makes the line a fetch wearing a message, so it is red rather than
				// relaxed: that is where an undeclared fetch would hide, since the URL
				// rule is the one relaxed here (QA round 2, Q9).
				for (const body of substitutionBodies(line)) {
					assert.deepEqual(
						urlsOn(body),
						[],
						`${script}:${number} is a print-only line whose command substitution fetches a URL, so this is a fetch and not a message: ${line}`,
					);
				}
				for (const url of urls) {
					if (URL_USE.has(url)) continue;
					const host = hostOf(url);
					assert.ok(
						host !== null && PROSE_HOSTS.has(host),
						`${script}:${number} names ${url} on a print-only line, and ${host ?? "that URL"} is neither on the URL allowlist nor a declared prose host - declare it with its reason, or move it off the message: ${line}`,
					);
				}
				continue;
			}
			for (const url of urls) {
				const entry = URL_USE.get(url);
				assert.ok(
					entry,
					`${script}:${number} names ${url}, which is not on the allowlist. Every URL in these scripts needs a reason in URL_USE - the point of this file is that the list is a handful of lines a reviewer can read: ${line}`,
				);
				assert.ok(
					entry.scripts.includes(script),
					`${script}:${number} names ${url}, which is admitted for ${entry.scripts.join(", ")} and NOT for this script. An admission is per script, because reusing one installer's URL in another is how the deleted regression comes back: ${line}`,
				);
				const host = hostOf(url);
				// A URL built from a variable (`https://${server}`) names no host
				// here; the identifier's bindings and the array beside it are asserted
				// by their own tests.
				if (host === null) continue;
				assert.ok(
					HOSTS.has(host),
					`${script}:${number} names ${host}, which is not on the host allowlist`,
				);
			}
		}
	}
});

test("the scripts naming a URL are exactly the ones its entry admits", () => {
	// A dead entry - one nothing names - would sit in the list looking like a
	// justification, and an entry's reason is prose no machine can weigh; its
	// `scripts` IS checked, against the scripts that actually name the URL.
	for (const [url, entry] of URL_USE) {
		const naming = SCRIPTS.filter((script) =>
			codeLines(script).some(({ text: line }) => urlsOn(line).includes(url)),
		);
		assert.deepEqual(
			naming.sort(),
			[...entry.scripts].sort(),
			`${url} is declared for ${entry.scripts.join(", ") || "nothing"} but named by ${naming.join(", ") || "nothing"} - a dead entry, a stale list, or a fetch that borrowed another script's admission. Keep them equal.`,
		);
	}
});

test("every code line naming a URL invokes a client this file can bound", () => {
	// The bound rule is per client, so a URL carried by a command this file does
	// not recognise would be exempt from it by omission - the escape QA round 2
	// opened with `FETCH_BIN="$(command -v curl)"` and then `"$FETCH_BIN" -sL
	// <url>` (Q8). Refusing an unclassifiable line is the honest answer: either
	// the client is named on the line, or the line is not a fetch.
	for (const script of SCRIPTS) {
		for (const { text: line, number } of codeLines(script)) {
			if (urlsOn(line).length === 0 || MESSAGE_LINE.test(line)) continue;
			assert.ok(
				fetchLines(script).some(
					(candidate) => candidate.number === number && candidate.line === line,
				),
				`${script}:${number} names a URL but invokes no fetch client this file knows (${FETCH_CLIENTS.map((client) => client.spellings.join("/")).join(", ")}), so no bound rule reaches it. Name the client on this line, teach the table about it, or take the URL off the line: ${line}`,
			);
		}
	}
});

test("an interpolated URL's identifier is bound exactly once", () => {
	// `https://${server}` is admitted as a literal, and the identifier is the whole
	// of what decides the host it can hold: the round-2 mutation reassigned
	// `server="evil.example.com"` after the array and fetched that instead, which
	// the array assertion could not see because it reads the file's first match
	// (QA round 2, Q10). One binding site is what makes the hosts the array names
	// the only hosts reachable. A PowerShell `$env:NAME` inside a URL would be read
	// as the identifier `env` and fail this count - red rather than silent, which
	// is the direction to fail, and no URL here uses one.
	for (const script of SCRIPTS) {
		for (const { text: line, number } of codeLines(script)) {
			for (const url of urlsOn(line)) {
				for (const identifier of new Set(
					[...url.matchAll(URL_INTERPOLATION)].map(
						([, braced, bare]) => braced ?? bare,
					),
				)) {
					const bindings = [
						...codeText(script).matchAll(bindingPattern(identifier)),
					].length;
					assert.equal(
						bindings,
						1,
						`${script}:${number} builds a URL from $${identifier}, which is bound ${bindings} times in this file. Exactly one binding site is what keeps the hosts the array beside it names the only hosts it can hold, and 0 means the value comes from somewhere this file cannot see.`,
					);
				}
			}
		}
	}
});

test("the Linux connectivity check's own host list is on the allowlist", () => {
	// `check_connectivity` spells its probes as `https://${server}` over an
	// array, so the hosts never appear next to a fetcher. Reading the array is
	// what keeps that indirection from being a hole in the rule above.
	const script = "src/main/backend/scripts/linux-install-script.sh";
	const array = text(script).match(SERVERS_ARRAY);
	assert.ok(array, `${script} no longer declares a servers array`);
	const hosts = [...array[1].matchAll(SERVERS_ENTRY)].map(([, host]) => host);
	assert.ok(hosts.length > 0, "the connectivity check names no hosts");
	for (const host of hosts) {
		assert.ok(
			HOSTS.has(host),
			`${script}'s connectivity check probes ${host}, which is not on the host allowlist`,
		);
	}
});

test("every fetch the scripts make carries a bound, in the code rather than a comment", () => {
	for (const script of SCRIPTS) {
		for (const { line, number, client } of fetchLines(script)) {
			for (const [flag, pattern, why] of client.bounds) {
				assert.ok(
					pattern.test(line),
					`${script}:${number} invokes ${client.spellings.join("/")} without a ${flag} bound - ${why}. Bounds have to be in the command, not in a comment beside it: ${line}`,
				);
			}
		}
	}
});

test("the fetcher vocabulary fires on every spelling this file claims to bound", () => {
	// Same shape as `scripts/window-mode.test.mjs`'s SPELLINGS self-check: a
	// vocabulary that silently stops matching is a guard nobody notices has
	// stopped, and each of these calls carries no bound, so a spelling the table
	// claims must also trip the bound rule.
	for (const [spelling, call] of CLIENT_SPELLINGS) {
		const client = FETCH_CLIENTS.find(({ spellings }) =>
			spellings.includes(spelling),
		);
		assert.ok(client, `${spelling} is not a client this file lists`);
		assert.ok(
			client.invocation.test(call),
			`the ${spelling} invocation pattern does not fire on ${call}`,
		);
		assert.ok(
			client.bounds.some(([, pattern]) => !pattern.test(call)),
			`the ${spelling} bound rule accepts an unbounded call, so it bounds nothing: ${call}`,
		);
	}
});

test("the allowlist entries are well formed", () => {
	for (const [url, entry] of URL_USE) {
		assert.ok(
			entry.reason.length > 40,
			`${url} needs a reason a reviewer can weigh, not a label`,
		);
		assert.ok(
			entry.scripts.length > 0,
			`${url} is admitted for no script - say which installers may name it`,
		);
		for (const script of entry.scripts) {
			assert.ok(
				EXPECTED_SCRIPTS.includes(script),
				`${url} is admitted for ${script}, which is not one of the installers`,
			);
		}
		const host = hostOf(url);
		if (host !== null) {
			assert.ok(
				HOSTS.has(host),
				`${url} is admitted but its host is not on the host list`,
			);
		}
		// An entry admits a payload SHAPE only where the shape ban would bite, and
		// it says why. An `admittedPayload` on a URL no pattern matches is a claim
		// about nothing.
		const shapeBanned = PAYLOAD_URL.some(([pattern]) => pattern.test(url));
		assert.equal(
			Boolean(entry.admittedPayload),
			shapeBanned,
			shapeBanned
				? `${url} matches a banned payload shape and must say in admittedPayload why it is exempt`
				: `${url} carries an admittedPayload reason but matches no banned payload shape`,
		);
	}
	for (const { name, why } of UNBOUNDED_BY_DESIGN) {
		assert.ok(
			why.length > 40,
			`${name} is exempt from the bound rule and needs a real reason`,
		);
	}
});

test("the shell install scripts still parse", () => {
	for (const script of SHELL_SCRIPTS) {
		const { status, stderr } = spawnSync("bash", ["-n", script], {
			encoding: "utf8",
		});
		assert.equal(status, 0, `${script} does not parse: ${stderr}`);
	}
});

/**
 * The PowerShell parser, if this machine has one.
 *
 * `pwsh` is not installed on the macOS dev machines this repository is worked
 * on, and the honest answer there is to say so rather than to substitute a model
 * of the script - the text rules above cover the Windows script from any
 * platform, and `install-scripts-check.yml` parses and runs it on a real
 * `windows-latest` runner.
 */
const POWERSHELL = ["pwsh", "powershell"].find((candidate) => {
	const probe = spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"]);
	return probe.status === 0;
});

test("the PowerShell install scripts still parse", (t) => {
	if (!POWERSHELL) {
		t.skip(
			"no pwsh/powershell on PATH on this machine: the Windows script is parsed and run by `install-scripts-check.yml` on a windows-latest runner, and the text and bound rules above cover it from any platform",
		);
		return;
	}
	for (const script of POWERSHELL_SCRIPTS) {
		const { status, stderr } = spawnSync(
			POWERSHELL,
			[
				"-NoProfile",
				"-Command",
				`[void][ScriptBlock]::Create((Get-Content -Raw '${script}'))`,
			],
			{ encoding: "utf8" },
		);
		assert.equal(status, 0, `${script} does not parse: ${stderr}`);
	}
});

/** Every URL literal on a line, with the trailing punctuation shaved off. */
function urlsOn(line) {
	return (line.match(URL_LITERAL) ?? []).map((url) =>
		url.replace(TRAILING_PUNCTUATION, ""),
	);
}

/** A URL's host, or null when it is built from a variable. */
function hostOf(url) {
	const afterScheme = url.slice(url.indexOf("//") + 2);
	const host = afterScheme.split(URL_HOST)[0];
	return host.includes("$") ? null : host;
}

/**
 * Where an identifier can take its value: an assignment, or a `for … in` binding.
 *
 * Deliberately narrow. It is not trying to be a shell parser - it is counting the
 * sites at which the value a URL interpolates could be set, so that "exactly one"
 * means the array beside the check is the only thing that decides the host.
 */
function bindingPattern(identifier) {
	return new RegExp(
		`(?:^|[\\s;&|(])(?:local[ \\t]+|export[ \\t]+|declare[ \\t]+)?${identifier}=|\\bfor[ \\t]+${identifier}[ \\t]+in\\b`,
		"g",
	);
}
