import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHEBANG = /^#!([^\r\n]+)\r?\n/;
const PYTHON_NAME = /[/\\]python(?:\d+(?:\.\d+)*)?$/;
export const SERVE_ENTRYPOINT = "from local_operator.cli import main; main()";

/** Console wrappers and Windows venv redirectors may wait for another process.
 * Owning the wrapper does not own serve. Probe only an explicit interpreter and
 * reject opaque launchers rather than broadening cleanup to their descendants. */
export async function ownedServeLaunch(
	python: string,
	port: number,
	env: NodeJS.ProcessEnv,
	platform = process.platform,
): Promise<{ command: string; args: string[] }> {
	if (!isAbsolute(python))
		throw new Error("Backend interpreter must be absolute");
	const { stdout } = await execFileAsync(
		python,
		[
			"-c",
			"import json, sys; from local_operator.cli import main; print(json.dumps([sys.executable, getattr(sys, '_base_executable', sys.executable), callable(main)]))",
		],
		{ env, timeout: 5000, windowsHide: true },
	);
	const [executable, baseExecutable, callable] = JSON.parse(stdout.trim());
	if (!callable || !isAbsolute(executable))
		throw new Error("Backend CLI entrypoint is unavailable");
	if (
		platform === "win32" &&
		executable.toLowerCase() !== baseExecutable.toLowerCase()
	) {
		throw new Error(
			"Cannot safely own a Windows venv redirector; use a directly paired external backend",
		);
	}
	const args = ["-c", SERVE_ENTRYPOINT, "serve", "--port", String(port)];
	if (platform === "win32") return { command: executable, args };
	// Positional arguments preserve spaces/metacharacters. Final exec replaces
	// bash with the interpreter; no intermediate launcher survives to own a PID.
	return {
		command: "bash",
		args: ["-c", 'exec "$@"', "owned-serve", executable, ...args],
	};
}

/** Accept the installed Python console entrypoint, not arbitrary shell shims.
 * Keep the existing PATH resolver authoritative; this only proves its identity. */
export function consoleInterpreter(consolePath: string): string {
	const script = readFileSync(consolePath, "utf8");
	const shebang = SHEBANG.exec(script)?.[1];
	if (
		!shebang ||
		!isAbsolute(shebang) ||
		!PYTHON_NAME.test(shebang) ||
		!script.includes("from local_operator.cli import main")
	) {
		throw new Error(
			"Cannot safely own this backend launcher; use a directly paired external backend",
		);
	}
	return shebang;
}
