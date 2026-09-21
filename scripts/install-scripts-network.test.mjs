import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * The three first-run install scripts must not fetch a third-party BINARY, and
 * every network operation they still perform must be bounded.
 *
 * WHY THIS EXISTS. All three scripts used to download FFmpeg from
 * `github.com/eugeneware/ffmpeg-static/releases/download/b6.0/` into
 * `$APP_DATA_DIR/bin/ffmpeg`. On macOS BOTH asset names were wrong
 * (`ffmpeg-mac-arm64` and `ffmpeg-mac-x64`; the release publishes
 * `ffmpeg-darwin-arm64`), and `curl` without `--fail` treats a 404 as a
 * successful transfer: the 9-byte `Not Found` body was written to the binary
 * path, `chmod +x` made it "executable", the `[ -f ] && [ -x ]` verification
 * passed, and the script logged `FFmpeg installation complete.` The next run's
 * own presence check then skipped the download, so the broken file was
 * permanent. Nothing in the app or in `local-operator` ever executed it, and
 * because both scripts run under `set -e`, a failed download was fatal BEFORE
 * the venv was created - so a user who can reach PyPI but not github.com could
 * not install at all.
 *
 * The fetch is therefore deleted rather than corrected, and this file is what
 * keeps it deleted.
 *
 * WHAT IS PINNED, and why two different shapes rather than one:
 *
 *  - No script may name a release asset, a binary payload or the word FFmpeg on
 *    any CODE line. That check runs over every code line rather than only over
 *    fetch lines, because a URL assembled into a variable and handed to a
 *    fetcher in a loop would otherwise slip past; comments are excluded, so the
 *    comment recording why the fetch was deleted can still name it.
 *  - Every URL a FETCHER (curl, wget, Invoke-WebRequest) is handed must appear
 *    in `URL_USE` below with the reason it remains, and its host must be in
 *    `HOSTS`. An exact-URL inventory rather than a hostname wildcard: the
 *    contract is a short list a reviewer can read, so ADDING a URL is red and a
 *    justification is the only way through.
 *  - Every fetcher invocation must carry a bound. An unbounded fetch sits on a
 *    black-hole network behind a spinner for minutes, and the PyPI probe in
 *    particular reads a captive portal's 200 portal page as "PyPI reachable" -
 *    a false negative exactly where the warning matters.
 *
 * The scripts are read from the tree as text, because text is what ships; a
 * parse check (`bash -n`) is the only executable part of this file, and it
 * cannot use a model of the scripts in place of them.
 */

/** The scripts that run on a user's machine before the app exists. */
const SHELL_SCRIPTS = [
	"src/main/backend/scripts/macos-install-script.sh",
	"src/main/backend/scripts/linux-install-script.sh",
];
const POWERSHELL_SCRIPT = "src/main/backend/scripts/windows-install-script.ps1";
const SCRIPTS = [...SHELL_SCRIPTS, POWERSHELL_SCRIPT];

/**
 * Every URL literal these scripts may hand to a fetcher, with the reason it
 * remains. This is the whole allowlist: a URL that is not a key here fails,
 * whether or not its host is familiar.
 */
const URL_USE = new Map([
	[
		"https://pypi.org/pypi/local-operator/json",
		"the PyPI reachability probe on macOS and Linux - a bounded, warning-only diagnostic that stands in front of the install so a broken network is named before pip fails",
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
		"Windows' Python provisioning. A SOURCE archive rather than a binary payload - which is why the ban above is on the payload's SHAPE and only this one github.com URL is admitted - and it is the fetch the Windows install genuinely cannot do without",
	],
	[
		"https://${server}",
		"the Linux connectivity check's two hosts, spelled in its own `servers` array (asserted below) rather than as literals",
	],
]);

/**
 * Hosts these scripts may talk to. `github.com` is here only for pyenv-win's
 * source archive; no release asset may be fetched from it, or from anywhere
 * else, and the payload-shape check above is what enforces that.
 */
const HOSTS = new Map([
	["pypi.org", "the index the install installs from"],
	["bootstrap.pypa.io", "pip's bootstrap script"],
	["github.com", "pyenv-win's source archive on Windows only (see URL_USE)"],
]);

/**
 * Payload shapes that make a URL a third-party binary download.
 *
 * `releases/download` is checked against the WHOLE file, comments included: no
 * script has any business naming a release asset, and the string is the exact
 * shape this change deletes. The rest are checked against CODE lines only
 * (comments stripped), because the comment recording WHY the fetch was deleted
 * has to be able to name it - a rule that reds on its own explanation is a rule
 * people delete.
 *
 * Extensions are checked only against URL literals, because `.exe` is also the
 * correct suffix for files the Windows script creates locally
 * (`$VenvPath\Scripts\local-operator.exe`).
 */
const PAYLOAD_ANYWHERE = [
	[
		/releases\/download/,
		"a GitHub release asset is a third-party binary payload - acquire it through the app's Console with the user's approval instead of at install time",
	],
];
const PAYLOAD_CODE = [
	[
		/ffmpeg/i,
		"the deleted FFmpeg block: the asset it asked for does not exist under that name, nothing consumes the binary, and its `[ -f ] && [ -x ]` verification passes on a 404 body",
	],
];
const PAYLOAD_URL = [
	[
		/\.(?:exe|dmg|pkg|msi|deb|rpm|appimage)(?:$|[?#])/i,
		"names a packaged binary. Archives are deliberately not in this list - an archive holds sources or scripts (pyenv-win's own source archive is the admitted case), while these extensions are executable installers, which is the class the installer has no business fetching",
	],
];

/**
 * A line that HANDS something to a fetcher.
 *
 * The trailing lookahead is the load-bearing part: it requires the fetcher to be
 * followed by a flag, a quoted argument or a URL, which is what an invocation
 * looks like. A line that only MENTIONS one - `command -v curl`,
 * `command_exists wget`, or the message `Neither curl nor wget available` - is
 * not a fetch, and a rule that reds on those is a rule people route around.
 */
const FETCHER = /\b(curl|wget|Invoke-WebRequest)\s+(?=[-"'$]|https?:\/\/)/;

/**
 * The bound each fetcher's own spelling requires. Both halves matter: a connect
 * timeout alone still lets a socket that connected stall forever, and a total
 * alone can spend the whole budget on a DNS lookup that never resolves.
 */
const REQUIRED_BOUNDS = {
	curl: ["--connect-timeout", "--max-time"],
	wget: ["--timeout", "--tries"],
	"Invoke-WebRequest": ["-TimeoutSec"],
};

const URL_LITERAL = /https?:\/\/[^\s"'`)]+/g;

/** The host of a URL, up to its port, path, query or fragment. */
const URL_HOST = /[/:?#]/;

/** `check_connectivity`'s own `servers=(...)` array, for the host rule below. */
const SERVERS_ARRAY = /servers=\(([^)]*)\)/;
const SERVERS_ENTRY = /"([^"]+)"/g;

function text(script) {
	return readFileSync(script, "utf8");
}

/**
 * The script's executable lines, comments dropped.
 *
 * Both dialects mark a whole-line comment with `#`, and that is the only shape
 * either script uses. Stripping them is what keeps a fetch rule about fetches:
 * the comment that records why the FFmpeg download was deleted names FFmpeg.
 */
function codeLines(script) {
	return lines(script).filter(
		({ line }) => line.trim() !== "" && !line.trim().startsWith("#"),
	);
}

function code(script) {
	return codeLines(script)
		.map(({ line }) => line)
		.join("\n");
}

function lines(script) {
	return text(script)
		.split("\n")
		.map((line, index) => ({ line, number: index + 1 }));
}

/** Every line that hands a URL to a fetcher, with its numbers. */
function fetchLines(script) {
	return codeLines(script).filter(({ line }) => FETCHER.test(line));
}

test("no install script fetches a third-party binary payload", () => {
	for (const script of SCRIPTS) {
		for (const [pattern, why] of PAYLOAD_ANYWHERE) {
			const hit = text(script)
				.split("\n")
				.findIndex((line) => pattern.test(line));
			assert.equal(hit, -1, `${script}:${hit + 1} matches ${pattern} - ${why}`);
		}
		for (const [pattern, why] of PAYLOAD_CODE) {
			const hit = codeLines(script).find(({ line }) => pattern.test(line));
			assert.ok(!hit, `${script}:${hit?.number} matches ${pattern} - ${why}`);
		}
		for (const match of code(script).matchAll(URL_LITERAL)) {
			for (const [pattern, why] of PAYLOAD_URL) {
				assert.ok(
					!pattern.test(match[0]),
					`${script} names ${match[0]}, which ${why}`,
				);
			}
		}
	}
});

test("every URL a fetcher is handed is on the justified list, host and all", () => {
	for (const script of SCRIPTS) {
		const found = new Set();
		for (const { line, number } of fetchLines(script)) {
			const urls = line.match(URL_LITERAL) ?? [];
			assert.ok(
				urls.length > 0,
				`${script}:${number} invokes a fetcher with no URL on the line - a URL this file cannot see is a URL this file cannot justify. Fetch a literal, not a variable: ${line.trim()}`,
			);
			for (const url of urls) found.add(url);
		}
		for (const url of found) {
			assert.ok(
				URL_USE.has(url),
				`${script} fetches ${url}, which is not on the allowlist. Every remaining fetch needs a reason in URL_USE - the point of this file is that the list is short enough to read.`,
			);
			// A URL built from a variable (`https://${server}`) names no host
			// here; the hosts it interpolates are asserted from its own array.
			if (url.includes("$")) continue;
			const host = url.slice(url.indexOf("//") + 2).split(URL_HOST)[0];
			assert.ok(
				HOSTS.has(host),
				`${script} fetches from ${host}, which is not on the host allowlist`,
			);
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

test("every network operation the shell scripts perform is bounded", () => {
	for (const script of SHELL_SCRIPTS) {
		for (const { line, number } of fetchLines(script)) {
			const fetcher = line.match(FETCHER)[1];
			for (const flag of REQUIRED_BOUNDS[fetcher]) {
				assert.ok(
					line.includes(flag),
					`${script}:${number} runs \`${fetcher}\` without ${flag}, so a black-hole network can hold it open indefinitely: ${line.trim()}`,
				);
			}
		}
	}
});

test("the PowerShell install script's own fetches are bounded", () => {
	for (const { line, number } of fetchLines(POWERSHELL_SCRIPT)) {
		for (const flag of REQUIRED_BOUNDS["Invoke-WebRequest"]) {
			assert.ok(
				line.includes(flag),
				`${POWERSHELL_SCRIPT}:${number} runs Invoke-WebRequest without ${flag}: ${line.trim()}`,
			);
		}
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
 * on, and the honest answer there is to say so rather than to substitute a
 * model of the script - the text rules above cover the Windows script from any
 * platform, and `install-scripts-check.yml` parses and runs it on a real
 * `windows-latest` runner.
 */
const POWERSHELL = ["pwsh", "powershell"].find((candidate) => {
	const probe = spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"]);
	return probe.status === 0;
});

test("the PowerShell install script still parses", (t) => {
	if (!POWERSHELL) {
		t.skip(
			"no pwsh/powershell on PATH on this machine: the Windows script is parsed and run by `install-scripts-check.yml` on a windows-latest runner, and the text and bound rules above cover it from any platform",
		);
		return;
	}
	const { status, stderr } = spawnSync(
		POWERSHELL,
		[
			"-NoProfile",
			"-Command",
			`[void][ScriptBlock]::Create((Get-Content -Raw '${POWERSHELL_SCRIPT}'))`,
		],
		{ encoding: "utf8" },
	);
	assert.equal(status, 0, `${POWERSHELL_SCRIPT} does not parse: ${stderr}`);
});
