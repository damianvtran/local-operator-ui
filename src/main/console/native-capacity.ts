import { type ChildProcess, execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

export interface NativeCapacity {
	fdLimit: number | null;
	fdUsed: number | null;
	ptyMax: number | null;
	ptyAvailable: number | null;
}

export interface NativeCapacityProbe {
	(): NativeCapacity;
	stop(): void;
}

/** Only a caller-verified Python executable may probe RLIMIT_NOFILE. The
 * isolated child inherits THIS main process's limit and uses -I/-S, without
 * importing user configuration. getconf/shell ulimit and backend-server limits
 * are not substitutes for the app's actual inherited process limit.
 * Probes are asynchronous, bounded and owned: startup never waits on a process,
 * missing prerequisites stay unknown, and rollback/stop reaps pending probes. */
export function nativeCapacityProbe(
	trustedPython?: string,
): NativeCapacityProbe {
	let fdLimit: number | null = null;
	let ptyMax: number | null = null;
	let stopped = false;
	const children = new Set<ChildProcess>();
	function readNumber(
		executable: string,
		args: string[],
		accept: (value: number) => void,
	): void {
		const child = execFile(
			executable,
			args,
			{
				timeout: 1000,
				maxBuffer: 1024,
				encoding: "utf8",
				env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
				windowsHide: true,
			},
			(error, stdout) => {
				children.delete(child);
				if (stopped || error) return;
				const value = Number(stdout.trim());
				if (Number.isSafeInteger(value) && value > 0) accept(value);
			},
		);
		children.add(child);
	}
	if (trustedPython && process.platform !== "win32") {
		readNumber(
			trustedPython,
			[
				"-I",
				"-S",
				"-c",
				"import resource; print(resource.getrlimit(resource.RLIMIT_NOFILE)[0])",
			],
			(value) => {
				fdLimit = value;
			},
		);
	}
	if (process.platform === "darwin") {
		readNumber("/usr/sbin/sysctl", ["-n", "kern.tty.ptmx_max"], (value) => {
			ptyMax = value;
		});
	}
	return Object.assign(
		(): NativeCapacity => {
			const result: NativeCapacity = {
				fdLimit,
				fdUsed: null,
				ptyMax,
				ptyAvailable: null,
			};
			try {
				// Count this process's descriptors only; never return names or paths.
				result.fdUsed = readdirSync(
					process.platform === "linux" ? "/proc/self/fd" : "/dev/fd",
				).length;
			} catch {
				/* Unsupported platform or unavailable procfs means unknown. */
			}
			if (process.platform === "linux") {
				try {
					const max = Number(
						readFileSync("/proc/sys/kernel/pty/max", "utf8").trim(),
					);
					const used = Number(
						readFileSync("/proc/sys/kernel/pty/nr", "utf8").trim(),
					);
					if (Number.isSafeInteger(max) && max > 0) result.ptyMax = max;
					if (result.ptyMax !== null && Number.isSafeInteger(used) && used >= 0)
						result.ptyAvailable = Math.max(0, max - used);
				} catch {
					/* Kernel versions differ; never infer foreign PTY state. */
				}
			}
			// Darwin does not reliably expose global occupancy. Maximum != available.
			return result;
		},
		{
			stop(): void {
				stopped = true;
				for (const child of children) {
					if (child.exitCode === null) child.kill();
				}
				children.clear();
			},
		},
	);
}
