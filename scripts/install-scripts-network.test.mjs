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
 * this file going red, whatever fetches it.** That is enforced by requiring
 * every URL-shaped literal on every CODE line to be a key of `URL_USE` (or, on
 * a line whose whole job is printing text, of `PROSE_HOSTS`) - a new fetch has
 * to name its URL somewhere, so the rule does not depend on which client
 * performs it, or on its being a client we have heard of. Three earlier shapes
 * failed exactly here and are the reason for this one: a vocabulary of client
 * names (`Invoke-RestMethod`, `urllib.request.urlretrieve` and a fetcher held
 * in a shell variable all walked through it), a hardcoded script list (a fourth
 * installer script was covered by nothing, and no other test in the tree
 * enumerates that directory), and a bound check by substring over the raw line
 * (a fetch could carry `--max-time` in a trailing comment).
 *
 * WHAT IS PINNED
 *
 *  - the set of scripts is DISCOVERED, not listed: `src/main/backend/scripts/`
 *    is globbed and asserted against `EXPECTED_SCRIPTS`, so a new platform
 *    script fails here until it is added deliberately;
 *  - no release asset (`releases/download` and GitHub's `releases/latest/
 *    download` alias), no binary or archive payload, and no FFmpeg token on any
 *    code line;
 *  - every URL on a code line is in `URL_USE` with its reason, and its host in
 *    `HOSTS`; a URL on a print-only line must at least name a declared prose
 *    host;
 *  - every fetch carries a bound, checked against the CODE with trailing
 *    comments stripped and with equivalent spellings accepted (`-m 10` bounds
 *    like `--max-time 10`), and a fetch whose bound this table cannot express is
 *    named as such rather than passing silently;
 *  - the shell scripts still parse (`bash -n`), and the PowerShell one is parsed
 *    where a parser exists.
 *
 * WHERE THIS FILE STOPS, said plainly rather than promised away: a URL
 * assembled at runtime from pieces that never appear whole on one line (a scheme
 * built by concatenation, a host read from the environment) is not visible to
 * any rule here - that is the shape no textual guard can see. Everything a
 * fetch must name literally to work is covered.
 *
 * The scripts are read from the tree as text, because text is what ships; the
 * parse checks are the only executable part, and they cannot use a model of the
 * scripts in place of them.
 */

const SCRIPTS_DIR = "src/main/backend/scripts";

/** The installers this repository ships. Discovered set must equal this. */
const EXPECTED_SCRIPTS = [
	"src/main/backend/scripts/linux-install-script.sh",
	"src/main/backend/scripts/macos-install-script.sh",
	"src/main/backend/scripts/windows-install-script.ps1",
];

/** Discovered, sorted, for the comparison against EXPECTED_SCRIPTS. */
function discoveredScripts() {
	return readdirSync(SCRIPTS_DIR)
		.filter((name) => name.endsWith(".sh") || name.endsWith(".ps1"))
		.map((name) => `${SCRIPTS_DIR}/${name}`)
		.sort();
}

const SCRIPTS = discoveredScripts();
const SHELL_SCRIPTS = SCRIPTS.filter((script) => script.endsWith(".sh"));
const POWERSHELL_SCRIPTS = SCRIPTS.filter((script) => script.endsWith(".ps1"));

/**
 * Every URL these scripts may name on a code line, with the reason it remains.
 * This is the whole allowlist: a URL that is not a key here fails, whether or
 * not its host is familiar, and whether a recognised client fetches it or not.
 */
const URL_USE = new Map([
	[
		"https://pypi.org/pypi/local-operator/json",
		"the PyPI reachability probe on macOS and Linux - a bounded, warning-only diagnostic that stands in front of the install so a broken network is named before pip fails, and that checks the answer's content type so a captive portal's HTML page cannot read as reachable",
	],
	[
		"https://pypi.org",
		"the macOS install-failure path's PyPI diagnosis, which runs only after pip has already failed",
	],
	[
		"https://bootstrap.pypa.io/get-pip.py",
		"pip's own bootstrap script, fetched only when a venv came up with no pip at all (the Linux script's last-resort fallback)",
	],
	[
		"https://github.com/pyenv-win/pyenv-win/archive/master.zip",
		"Windows' Python provisioning. A SOURCE archive rather than a binary payload - the one admitted archive, because a prebuilt tool this install cannot run on Windows must wait for the app's Console instead - and the fetch the Windows install genuinely cannot do without",
	],
	[
		"https://${server}",
		"the Linux connectivity check's two hosts, spelled in its own `servers` array (asserted below) rather than as literals",
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
 * Print-only lines are excluded from the fetch rules - a message that names the
 * Python download page is guidance, not a fetch - but not from having to declare
 * its host, so a URL cannot be smuggled in behind an `echo` without appearing
 * here. The residual limit, stated rather than implied: a fetch performed BY a
 * print-only line (`echo "$(curl ...)"`) would not be bound-checked. Nothing in
 * these scripts does that, and the URL it would name still has to be declared.
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
 * (`$VenvPath\Scripts\local-operator.exe`). `ADMITTED_ARCHIVES` is the one
 * exemption, keyed by the exact URL so a differently-named archive cannot ride
 * in under it.
 */
const PAYLOAD_URL = [
	[
		/\.(?:exe|dmg|pkg|msi|deb|rpm|appimage|bin|zip|tgz|tar\.gz|tar\.xz|xz|gz)(?:$|[?#])/i,
		"names a packaged binary or an archive - the shapes a prebuilt tool actually arrives in, and the install has no business fetching one",
	],
];
const ADMITTED_ARCHIVES = new Map([
	[
		"https://github.com/pyenv-win/pyenv-win/archive/master.zip",
		"pyenv-win's SOURCE archive, which the Windows install cannot do without",
	],
]);

/**
 * Fetch clients whose bound this file can name, with the flag each requires.
 *
 * `-m`/`-T`/`-t` are accepted beside the long spellings because reding a correct
 * short form teaches people to route around the rule, and the value is required
 * to be present so `--max-time ""` or a bare flag is not a bound.
 *
 * A client whose bound is not one flag is listed in `UNBOUNDED_BY_DESIGN` with
 * its reason instead of being given a guess here: the URL rule still covers it,
 * since whatever it fetches has to be declared, and the honest statement is that
 * its bound is a review question rather than a pattern.
 */
const FETCH_CLIENTS = [
	{
		spellings: ["curl"],
		invocation: /\bcurl\s+(?=[-"'$]|https?:\/\/)/,
		bounds: [
			[
				"--connect-timeout",
				/--connect-timeout(?:=|\s+)\d/,
				"a connect that never completes is what a black-hole network looks like, and no other flag ends it",
			],
			[
				"--max-time (or -m)",
				/(?:--max-time(?:=|\s+)\d)|(?:^|\s)-m(?:\s|=)\d/,
				"a connected-but-stalled peer needs a total bound; without one this hangs behind the spinner indefinitely",
			],
		],
	},
	{
		spellings: ["wget"],
		invocation: /\bwget\s+(?=[-"'$]|https?:\/\/)/,
		bounds: [
			[
				"--timeout (or -T)",
				/(?:--timeout(?:=|\s+)\d)|(?:^|\s)-T(?:\s|=)\d/,
				"wget's timeout covers connect and read, which is all the bound it offers",
			],
			[
				"--tries (or -t)",
				/(?:--tries(?:=|\s+)\d)|(?:^|\s)-t(?:\s|=)\d/,
				"the default retry count turns one stalled host into a long silence",
			],
		],
	},
	{
		spellings: ["Invoke-WebRequest", "iwr"],
		invocation: /\b(?:Invoke-WebRequest|iwr)\s+(?=[-"'$]|https?:\/\/)/,
		bounds: [
			[
				"-TimeoutSec",
				/-TimeoutSec(?:\s+|=)\d/,
				"PowerShell's bound on the request; without it the call waits indefinitely",
			],
		],
	},
	{
		spellings: ["Invoke-RestMethod", "irm"],
		invocation: /\b(?:Invoke-RestMethod|irm)\s+(?=[-"'$]|https?:\/\/)/,
		bounds: [
			[
				"-TimeoutSec",
				/-TimeoutSec(?:\s+|=)\d/,
				"PowerShell's bound on the request; without it the call waits indefinitely",
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

test("every install script in the directory is one this file examines", () => {
	const discovered = discoveredScripts();
	assert.ok(
		discovered.length > 0,
		`no install script found under ${SCRIPTS_DIR} - this file examines nothing`,
	);
	assert.deepEqual(
		discovered,
		EXPECTED_SCRIPTS,
		`${SCRIPTS_DIR} carries a script this file does not examine. Add it to EXPECTED_SCRIPTS deliberately (and check it against every rule below) rather than letting it ship unguarded.`,
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
				if (ADMITTED_ARCHIVES.has(url)) continue;
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

test("every URL a code line names is on the justified list, host and all", () => {
	for (const script of SCRIPTS) {
		for (const { text: line, number } of codeLines(script)) {
			const urls = urlsOn(line);
			if (urls.length === 0) continue;
			if (MESSAGE_LINE.test(line)) {
				for (const url of urls) {
					// A message may repeat a URL the allowlist already justifies (the
					// pyenv-win failure names what failed with). Anything else needs a
					// declared prose host, so a URL cannot be smuggled in behind an
					// `echo`.
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
				assert.ok(
					URL_USE.has(url),
					`${script}:${number} names ${url}, which is not on the allowlist. Every URL in these scripts needs a reason in URL_USE - the point of this file is that the list is a handful of lines a reviewer can read: ${line}`,
				);
				const host = hostOf(url);
				// A URL built from a variable (`https://${server}`) names no host
				// here; the hosts it interpolates are asserted from its own array.
				if (host === null) continue;
				assert.ok(
					HOSTS.has(host),
					`${script}:${number} names ${host}, which is not on the host allowlist`,
				);
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
	for (const [url, reason] of URL_USE) {
		assert.ok(
			reason.length > 40,
			`${url} needs a reason a reviewer can weigh, not a label`,
		);
		const host = hostOf(url);
		if (host !== null) {
			assert.ok(
				HOSTS.has(host),
				`${url} is admitted but its host is not on the host list`,
			);
		}
	}
	for (const [url, reason] of ADMITTED_ARCHIVES) {
		assert.ok(
			URL_USE.has(url),
			`${url} is admitted as an archive but is not on the URL allowlist`,
		);
		assert.ok(reason.length > 20, `${url} needs a reason`);
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
