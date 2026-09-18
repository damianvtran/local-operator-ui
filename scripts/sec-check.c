/*
 * sec-check.c - time Squirrel.Mac's own code-signature call against a bundle,
 * at normal priority and under the background scheduling class.
 *
 * WHY THIS EXISTS. An in-app update on this machine spends minutes with the app
 * closed - 4 min 27 s of one install sat in the single phase between `Beginning
 * installation` and the bundle move - and the standing explanation was "macOS is
 * validating the bundle". A `sample` of the blocked ShipIt process says the shape
 * of it: 100% of samples were in
 *
 *   SecStaticCodeCheckValidityWithErrors
 *     -> Security::CodeSigning::SecStaticCode::staticValidate
 *       -> Security::Dispatch::Group::wait
 *         -> __ulock_wait
 *
 * at 4.3% CPU over 4.5 minutes (~11 s of CPU). The process was BLOCKED on the
 * system's code-signing path, not computing.
 *
 * THE FINDING THIS PROGRAM EXISTS FOR: the same call, on the same content, costs
 * seconds from an ordinary process and MINUTES in the context an install runs it
 * in. Measured on 2026-09-18 on this machine, load 119-300, same bundle:
 *
 *   foreground, Squirrel's flags (8 runs today)         0.25 - 3.85 s
 *   submitted as a launchd job (`--via-launchd`)        33.3 s
 *     - same bundle, same minute as a 3.45 s shell run
 *   background class (`taskpolicy -b`), same content    331, 351, 556, 597, 777 s
 *                                                       (0.7-1.1 s of user CPU)
 *   ShipIt, during the 11:59 install                    4 min 27 s inside this call
 *                                                       at 4.3% of a core
 *
 * A warm-up explains nothing: validating the same content twice at foreground
 * first (0.34 s, 0.40 s) still left a background run at 351 s. So this is not a
 * cold cache and not validation work.
 *
 * WHAT THE DIFFERENCE IS, STATED NO FURTHER THAN THE EVIDENCE GOES (review R1).
 * The install's cost was attributed to launchd's SCHEDULING CLASS, and the machine
 * does not support that attribution: the app's own job carries `nice = -1` with no
 * background process type (`grep -c ProcessType` on Squirrel's binary: 0), and the
 * capture of the running ShipIt printed a priority that reads as the ordinary
 * class. What reproduces is the CONTEXT, not the class: a job submission inflates
 * the same call ~10x on the same content in the same minute, and the background
 * class ~100-300x. WHICH part of that context costs the time - launchd's
 * scheduling, the Security framework's own worker threads, or this machine's
 * contention - IS NOT ESTABLISHED, and this tool does not claim it. What it does
 * claim, and what the next change has to move, is the two numbers above: seconds
 * from a shell, minutes in the installer's context.
 *
 * WHAT IT IS NOT, measured rather than assumed: file COUNT is not the lever. A
 * `ditto` of the full 1808-file bundle produced 19-21 Gatekeeper scans, and the
 * same write with the Python seed removed (269 files) produced 32 and 17 - a
 * 6x smaller write with no fewer scans. The earlier reading that the stall queues
 * behind the install's own file flood is refuted by that, and by the numbers
 * above it is not a plausible mechanism anyway.
 *
 * WHAT IT RUNS - Squirrel's call and Squirrel's flags, verbatim
 * (Squirrel/SQRLCodeSignature.m, `verifyBundleAtURL:`):
 *
 *   SecStaticCodeCreateWithPath(url, kSecCSDefaultFlags, &staticCode)
 *   SecCodeCopyDesignatedRequirement(staticCode, kSecCSDefaultFlags, &requirement)
 *   SecStaticCodeCheckValidityWithErrors(staticCode,
 *       kSecCSCheckNestedCode | kSecCSStrictValidate | kSecCSCheckAllArchitectures,
 *       requirement, &validityError)
 *
 * The requirement is the code's OWN designated requirement, exactly as Squirrel
 * gets it from `SecCodeCopyDesignatedRequirement`; passing NULL instead would
 * measure a different question.
 *
 * WHAT IT DOES NOT MEASURE, said out loud: it does not run an install, so it cannot
 * measure the closed window itself - that is `scripts/update-window-report.mjs`'s
 * job, and the two together are the whole picture (how long the window was, and
 * what fills it). It says nothing about the app's own health.
 *
 * BUILD AND RUN (macOS only; no build system, one line):
 *
 *   clang -O2 -o /tmp/lo-sec-check scripts/sec-check.c \
 *     -framework Security -framework CoreFoundation
 *   /tmp/lo-sec-check "/Applications/Local Operator.app"
 *   /tmp/lo-sec-check --via-launchd "/Applications/Local Operator.app"
 *   /tmp/lo-sec-check --repeat 3 --background "/Applications/Local Operator.app"
 *
 * or, through the repository's package script:
 *
 *   pnpm sec-check "/Applications/Local Operator.app"
 *   pnpm sec-check --via-launchd "/Applications/Local Operator.app"
 *   pnpm sec-check --background "/Applications/Local Operator.app"
 *
 * `--via-launchd` re-runs the same measurement in a CHILD SUBMITTED TO LAUNCHD,
 * which is the context Squirrel's installer runs in (`SMJobSubmit`,
 * `SQRLUpdater.m:406`), and prints it beside the foreground number. The label is
 * synthetic and carries this process's pid, so it can never collide with or replace
 * an app's own `<bundle id>.ShipIt` job, and the job is removed before the program
 * returns - a probe must not leave a submission behind in the user's domain.
 *
 * `--background` re-runs the same measurement in a child of this process under
 * `/usr/bin/taskpolicy -b` and prints both numbers side by side. Both modes TAKE
 * MINUTES - that is the finding, not a defect of the tool - so they are opt-in.
 *
 * On a host that is not macOS there is no Security.framework to link and no
 * code-signing database to ask, so the program compiles to a single line that
 * says so and exits 0 rather than failing a build on a machine where the
 * measurement is meaningless.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <mach/mach_time.h>

/**
 * Where the scheduling-class tool lives.
 *
 * It measures the BACKGROUND CLASS, which is what `--background` reproduces - not
 * a claim about which class the installer itself runs in (see the header: that is
 * not established, and the machine's own evidence points away from it).
 *
 * `/usr/sbin` on this macOS (measured), with `/usr/bin` kept as the other spelling
 * the tool has shipped under - the program reports plainly when neither is there
 * rather than failing the measurement it can still take.
 */
static const char *TASKPOLICY_PATHS[] = {"/usr/sbin/taskpolicy",
                                        "/usr/bin/taskpolicy"};
static const char *taskpolicy_path(void) {
	for (size_t index = 0;
	     index < sizeof(TASKPOLICY_PATHS) / sizeof(TASKPOLICY_PATHS[0]); index++) {
		FILE *probe = fopen(TASKPOLICY_PATHS[index], "r");
		if (probe != NULL) {
			fclose(probe);
			return TASKPOLICY_PATHS[index];
		}
	}
	return NULL;
}

/* Seconds from a monotonic clock, which is the only clock a duration may use. */
static double monotonic_seconds(void) {
	static mach_timebase_info_data_t timebase;
	if (timebase.denom == 0) {
		(void)mach_timebase_info(&timebase);
	}
	return (double)mach_absolute_time() * (double)timebase.numer /
	       (double)timebase.denom / 1e9;
}

/*
 * The message macOS has for an OSStatus, written into `buffer`, or the bare
 * number when it has none. `SecCopyErrorMessageString` answers NULL for statuses
 * it does not know, and a caller that read it without checking would print a null
 * into the verdict.
 */
static void status_text(OSStatus status, char *buffer, size_t size) {
	if (status == noErr) {
		snprintf(buffer, size, "status 0 (no error)");
		return;
	}
	CFStringRef message = SecCopyErrorMessageString(status, NULL);
	char text[512] = "";
	if (message != NULL) {
		CFStringGetCString(message, text, sizeof(text), kCFStringEncodingUTF8);
		CFRelease(message);
	}
	snprintf(buffer, size, "status %d (%s)", (int)status,
	         text[0] != '\0' ? text : "no message for this status");
}

/* The `CFError` a failing check hands back: its domain, code and description. */
static void print_validity_error(CFErrorRef error) {
	if (error == NULL) {
		printf("validity error: none reported\n");
		return;
	}
	CFStringRef description = (CFStringRef)CFErrorCopyDescription(error);
	CFStringRef domain = CFErrorGetDomain(error);
	char domainBuffer[256] = "";
	char descriptionBuffer[1024] = "";
	if (domain != NULL) {
		CFStringGetCString(domain, domainBuffer, sizeof(domainBuffer),
		                   kCFStringEncodingUTF8);
	}
	if (description != NULL) {
		CFStringGetCString(description, descriptionBuffer,
		                   sizeof(descriptionBuffer), kCFStringEncodingUTF8);
		CFRelease(description);
	}
	printf("validity error: %s %ld: %s\n", domainBuffer,
	       (long)CFErrorGetCode(error), descriptionBuffer);
}

/**
 * One full measurement of one path: create, the designated requirement, then
 * Squirrel's validate.
 *
 * `verbose` prints the human block; without it the only output is the single
 * machine-readable `SECONDS` line, which is what the background child emits so
 * the parent can read a number back without parsing a paragraph a future edit
 * would reword.
 *
 * Answers the validate seconds, or a negative number when the measurement could
 * not be taken (the caller decides what that means).
 */
static double measure(const char *path, int verbose) {
	CFStringRef pathString = CFStringCreateWithFileSystemRepresentation(NULL, path);
	if (pathString == NULL) {
		fprintf(stderr, "sec-check: cannot read %s as a path\n", path);
		return -1.0;
	}
	CFURLRef url =
	    CFURLCreateWithFileSystemPath(NULL, pathString, kCFURLPOSIXPathStyle, true);
	CFRelease(pathString);
	if (url == NULL) {
		fprintf(stderr, "sec-check: cannot build a URL for %s\n", path);
		return -1.0;
	}

	char status[600];
	SecStaticCodeRef code = NULL;
	double start = monotonic_seconds();
	OSStatus createStatus =
	    SecStaticCodeCreateWithPath(url, kSecCSDefaultFlags, &code);
	double createSeconds = monotonic_seconds() - start;
	CFRelease(url);
	if (createStatus != noErr || code == NULL) {
		status_text(createStatus, status, sizeof(status));
		if (verbose) {
			printf("  create   (SecStaticCodeCreateWithPath)          %.4f s   %s\n",
			       createSeconds, status);
			printf("VERDICT: could not create a static code object\n");
		}
		return -1.0;
	}

	SecRequirementRef requirement = NULL;
	start = monotonic_seconds();
	OSStatus requirementStatus =
	    SecCodeCopyDesignatedRequirement(code, kSecCSDefaultFlags, &requirement);
	double requirementSeconds = monotonic_seconds() - start;
	if (requirementStatus != noErr) {
		requirement = NULL;
	}

	CFErrorRef validityError = NULL;
	start = monotonic_seconds();
	OSStatus validateStatus = SecStaticCodeCheckValidityWithErrors(
	    code,
	    kSecCSCheckNestedCode | kSecCSStrictValidate | kSecCSCheckAllArchitectures,
	    requirement, &validityError);
	double validateSeconds = monotonic_seconds() - start;

	if (verbose) {
		status_text(createStatus, status, sizeof(status));
		printf("  create   (SecStaticCodeCreateWithPath)          %.4f s   %s\n",
		       createSeconds, status);
		status_text(requirementStatus, status, sizeof(status));
		printf("  require  (SecCodeCopyDesignatedRequirement)     %.4f s   %s\n",
		       requirementSeconds, status);
		status_text(validateStatus, status, sizeof(status));
		printf("  validate (SecStaticCodeCheckValidityWithErrors) %.4f s   %s\n",
		       validateSeconds, status);
		if (validateStatus != noErr) {
			print_validity_error(validityError);
			printf("VERDICT: INVALID\n");
		} else {
			printf("VERDICT: valid\n");
		}
	} else {
		/* Read back by the parent, and by nothing else. */
		printf("SECONDS %.4f %.4f\n", createSeconds, validateSeconds);
		fflush(stdout);
	}

	if (validityError != NULL) {
		CFRelease(validityError);
	}
	if (requirement != NULL) {
		CFRelease(requirement);
	}
	CFRelease(code);
	/*
	 * A check that ran and refused the bundle is a measurement the caller must not
	 * average into a timing: the seconds are real, but the verdict is a failure and
	 * the caller's report has to say so rather than print a fast number beside it.
	 */
	return validateStatus == noErr ? validateSeconds : -1.0;
}

/**
 * How long a submitted job is waited for before the probe gives up on it.
 *
 * Generous on purpose: the whole finding is that this context is slow, and a
 * deadline that fired during a legitimately slow run would report a failure where
 * the measurement is the answer. 15 minutes is far past every number measured here
 * (33 s - 777 s) and still bounded, because a probe that hangs forever is not a
 * measurement.
 */
static const int LAUNCHD_DEADLINE_SECONDS = 900;

/**
 * Measure the same call the way an install runs it: submitted to launchd.
 *
 * WHY THIS MODE EXISTS (review R1). The install's cost had been attributed to
 * launchd's scheduling class, and the machine does not support that attribution -
 * the app's job carries `nice = -1` with no background process type, and the live
 * capture printed a priority that reads as the ordinary class. What DOES reproduce
 * is the context: the same bundle measured in the same minute cost 3.45 s from a
 * shell and 33.3 s as a submitted job. This mode is that experiment, re-runnable
 * from the repository, so the number can be checked rather than quoted - and so a
 * later change can show it moved.
 *
 * The job's label is synthetic and carries this process's pid, so it can never
 * collide with, or replace, an app's own `<bundle id>.ShipIt` job; the job is
 * removed before this function returns, whatever happened.
 */
static int measure_via_launchd(const char *self, const char *path, int repeat,
                               double *secondsOut) {
	char label[128];
	char outPath[4096];
	char errPath[4096];
	const char *tmpDir = getenv("TMPDIR");
	if (tmpDir == NULL || tmpDir[0] == '\0') {
		tmpDir = "/tmp";
	}
	snprintf(label, sizeof(label), "com.local-operator.sec-check.%d",
	         (int)getpid());
	snprintf(outPath, sizeof(outPath), "%s/lo-sec-check-launchd-%d.out", tmpDir,
	         (int)getpid());
	snprintf(errPath, sizeof(errPath), "%s/lo-sec-check-launchd-%d.err", tmpDir,
	         (int)getpid());
	remove(outPath);
	remove(errPath);

	/*
	 * ONE measurement per submission, whatever `--repeat` says: each submission IS
	 * the experiment, and polling for a second number from the same job would mean
	 * either killing it when the first arrives (which measures nothing) or waiting
	 * for the job to disappear (a second way of deciding the same thing).
	 */
	char command[8192];
	snprintf(command, sizeof(command),
	         "/bin/launchctl submit -l '%s' -o '%s' -e '%s' -- '%s' "
	         "--emit-seconds --repeat 1 '%s'",
	         label, outPath, errPath, self, path);
	(void)repeat;
	printf("\nlaunchd submission: %s\n", command);
	printf("waiting for the submitted job (this is the context being measured, "
	       "so it can take minutes)...\n");
	fflush(stdout);

	int submitStatus = system(command);
	if (submitStatus != 0) {
		fprintf(stderr,
		        "sec-check: `launchctl submit` exited %d; the job was not "
		        "submitted\n",
		        submitStatus);
		return 1;
	}

	double fastest = -1.0;
	for (int waited = 0; waited < LAUNCHD_DEADLINE_SECONDS; waited++) {
		FILE *out = fopen(outPath, "r");
		if (out != NULL) {
			char line[1024];
			while (fgets(line, sizeof(line), out) != NULL) {
				double createSeconds = 0.0;
				double validateSeconds = 0.0;
				if (sscanf(line, "SECONDS %lf %lf", &createSeconds,
				           &validateSeconds) == 2) {
					printf("launchd attempt: create %.4f s, validate %.4f s\n",
					       createSeconds, validateSeconds);
					if (fastest < 0.0 || validateSeconds < fastest) {
						fastest = validateSeconds;
					}
				}
			}
			fclose(out);
		}
		if (fastest >= 0.0) {
			break;
		}
		sleep(1);
	}

	/*
	 * Removed whatever happened: a probe that leaves a submission behind in the
	 * user's launchd domain is exactly the kind of thing this repository's rules
	 * exist to prevent, and a stale job would also make the next run's label
	 * ambiguous.
	 */
	char removeCommand[256];
	snprintf(removeCommand, sizeof(removeCommand), "/bin/launchctl remove '%s'",
	         label);
	(void)system(removeCommand);
	remove(outPath);
	remove(errPath);

	if (fastest < 0.0) {
		fprintf(stderr,
		        "sec-check: the submitted job reported no measurement within "
		        "%d s\n",
		        LAUNCHD_DEADLINE_SECONDS);
		return 1;
	}
	*secondsOut = fastest;
	return 0;
}

/**
 * The path this program was run as, for the child that re-enters the class.
 *
 * `realpath` rather than the string as given, because a submitted job runs with
 * `cwd=/` (launchd's own working directory): a relative `argv[0]` that happens to
 * contain a slash - `./sec-check` - names a program that job cannot exec, so the
 * submission fails with exit 78 and leaves its registration behind. Measured
 * (review Q10): `./sec-check --via-launchd "<bundle>"` printed its submission line,
 * produced no measurement at all, and left `- 78 com.local-operator.sec-check.NNN`
 * in `launchctl list`; the same command by absolute path measured normally and left
 * no job. Resolving costs nothing and turns every invocation that named a real file
 * into an absolute path.
 */
static void self_path(const char *argv0, char *buffer, size_t size) {
	buffer[0] = '\0';
	if (argv0 == NULL || strchr(argv0, '/') == NULL) {
		return;
	}
	if (realpath(argv0, buffer) == NULL || buffer[0] != '/') {
		buffer[0] = '\0';
	}
}

int main(int argc, char **argv) {
	const char *path = NULL;
	const char *argv0 = argc > 0 ? argv[0] : NULL;
	int repeat = 1;
	int background = 0;
	int viaLaunchd = 0;
	int emit_seconds = 0;

	for (int index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--repeat") == 0 && index + 1 < argc) {
			repeat = atoi(argv[++index]);
			if (repeat < 1) {
				repeat = 1;
			}
			continue;
		}
		if (strcmp(argv[index], "--background") == 0) {
			background = 1;
			continue;
		}
		if (strcmp(argv[index], "--via-launchd") == 0) {
			viaLaunchd = 1;
			continue;
		}
		if (strcmp(argv[index], "--emit-seconds") == 0) {
			emit_seconds = 1;
			continue;
		}
		if (path == NULL) {
			path = argv[index];
		}
	}
	if (path == NULL) {
		fprintf(stderr,
		        "usage: sec-check [--repeat N] [--background] [--via-launchd] "
		        "<path to an .app bundle>\n"
		        "\n"
		        "Times Squirrel.Mac's own code-signature call - "
		        "SecStaticCodeCreateWithPath then\n"
		        "SecStaticCodeCheckValidityWithErrors with kSecCSCheckNestedCode | "
		        "kSecCSStrictValidate |\n"
		        "kSecCSCheckAllArchitectures - and prints the timings and the "
		        "verdict.\n"
		        "\n"
		        "  --repeat N    measure N times and report the fastest validate\n"
		        "  --background  also measure under `taskpolicy -b` (the "
		        "background class)\n"
		        "                and print both. TAKES MINUTES.\n"
		        "  --via-launchd also measure as a job SUBMITTED TO LAUNCHD, the "
		        "context\n"
		        "                Squirrel's installer runs in, and print both. "
		        "TAKES MINUTES.\n");
		return 2;
	}

	/* A path that is not there is a mistake on any host, and "the bundle was
	 * missing rather than valid" must never be what the verdict says. */
	FILE *probe = fopen(path, "r");
	if (probe == NULL) {
		fprintf(stderr, "sec-check: cannot read %s\n", path);
		return 2;
	}
	fclose(probe);

	printf("path: %s\n", path);

	double fastest = -1.0;
	int failures = 0;
	for (int attempt = 0; attempt < repeat; attempt++) {
		if (!emit_seconds) {
			printf("foreground attempt %d of %d (normal scheduling class)\n",
			       attempt + 1, repeat);
		}
		double seconds = measure(path, !emit_seconds);
		if (seconds < 0.0) {
			failures++;
			if (!emit_seconds) {
				fprintf(stderr, "sec-check: measurement %d did not pass\n",
				        attempt + 1);
			}
			continue;
		}
		if (fastest < 0.0 || seconds < fastest) {
			fastest = seconds;
		}
	}
	if (!emit_seconds) {
		if (failures == 0) {
			printf("VERDICT: valid (%d/%d)\n", repeat, repeat);
		} else {
			printf("VERDICT: %d of %d did not pass\n", failures, repeat);
		}
		if (repeat > 1) {
			printf("fastest foreground validate: %.4f s\n", fastest);
		}
	}
	if (failures == repeat) {
		return 1;
	}
	if (!background && !viaLaunchd) {
		return 0;
	}

	/*
	 * Both modes are re-entered rather than approximated - one as a submitted job,
	 * one through `taskpolicy -b` - because the whole finding is that the CONTEXT
	 * changes the number: the same content and the same call cost seconds from this
	 * process and minutes in either of those.
	 */
	char self[4096];
	self_path(argv0, self, sizeof(self));
	if (self[0] == '\0') {
		fprintf(stderr,
		        "sec-check: --background and --via-launchd need an absolute path "
		        "to this program, and argv[0] is not one (%s); run it by path, "
		        "absolute or resolvable - a submitted job runs with cwd=/ and "
		        "cannot exec a relative one\n",
		        argv0 != NULL ? argv0 : "(absent)");
		return 2;
	}

	if (viaLaunchd) {
		double launchdFastest = -1.0;
		if (measure_via_launchd(self, path, repeat, &launchdFastest) != 0) {
			return 1;
		}
		printf("\nlaunchd-submitted validate:         %.4f s\n", launchdFastest);
		if (fastest > 0.0) {
			printf("cost of the context alone:          %.0fx\n",
			       launchdFastest / fastest);
		}
		if (!background) {
			return 0;
		}
	}
	const char *taskpolicyPath = taskpolicy_path();
	if (taskpolicyPath == NULL) {
		printf("\nbackground: no taskpolicy on this host, so the background "
		       "scheduling class\ncannot be entered here.\n");
		return 0;
	}

	/*
	 * The child is THIS program with `--emit-seconds`, so the number the parent
	 * reads back is produced by the same code path that produced the foreground
	 * one - not by a second implementation of the measurement.
	 */
	char command[8192];
	snprintf(command, sizeof(command),
	         "%s -b '%s' --emit-seconds --repeat %d '%s' 2>&1", taskpolicyPath,
	         self, repeat, path);
	printf("\nbackground: %s\n", command);
	fflush(stdout);

	double backgroundFastest = -1.0;
	int backgroundRuns = 0;
	FILE *child = popen(command, "r");
	if (child == NULL) {
		fprintf(stderr, "sec-check: could not run %s\n", taskpolicyPath);
		return 1;
	}
	char line[1024];
	while (fgets(line, sizeof(line), child) != NULL) {
		double createSeconds = 0.0;
		double validateSeconds = 0.0;
		if (sscanf(line, "SECONDS %lf %lf", &createSeconds, &validateSeconds) == 2) {
			backgroundRuns++;
			printf("background attempt %d: create %.4f s, validate %.4f s\n",
			       backgroundRuns, createSeconds, validateSeconds);
			if (backgroundFastest < 0.0 || validateSeconds < backgroundFastest) {
				backgroundFastest = validateSeconds;
			}
			continue;
		}
		printf("%s", line);
	}
	int childStatus = pclose(child);
	if (backgroundRuns == 0 || backgroundFastest < 0.0) {
		fprintf(stderr,
		        "sec-check: the background child reported no measurement (exit "
		        "%d); the class was not measured\n",
		        childStatus);
		return 1;
	}

	printf("\nforeground validate (normal class):  %.4f s\n", fastest);
	printf("background validate (`taskpolicy -b`): %.4f s\n", backgroundFastest);
	printf("cost of the class alone:            %.0fx\n",
	       fastest > 0.0 ? backgroundFastest / fastest : 0.0);
	printf("\nThe install's context is what the extra numbers measure, and "
	       "seconds against\nminutes on identical content is the finding. Which "
	       "part of that context costs the\ntime is not established (review R1): "
	       "the installer's own job carries no background\nprocess type and a "
	       "priority that reads as the ordinary class, while both a submission\n"
	       "and the background class reproduce the inflation. Nothing about this "
	       "app's bundle\nmakes the call expensive, which is why a smaller "
	       "bundle does not shorten the window.\n");
	return 0;
}

#else /* !__APPLE__ */

int main(int argc, char **argv) {
	(void)argc;
	(void)argv;
	printf("sec-check times Squirrel.Mac's code-signature call, which is part "
	       "of macOS's\nSecurity.framework and its code-signing database; there "
	       "is nothing to measure\non this host. Build it on macOS:\n"
	       "\n  clang -O2 -o /tmp/lo-sec-check scripts/sec-check.c "
	       "-framework Security -framework CoreFoundation\n"
	       "  /tmp/lo-sec-check \"/Applications/Local Operator.app\"\n");
	return 0;
}

#endif /* __APPLE__ */
