/*
 * sec-check.c - time Squirrel.Mac's own code-signature call against a bundle.
 *
 * WHY THIS EXISTS. An in-app update on this machine spends minutes with the app
 * closed, and the standing explanation was "macOS is validating the bundle". A
 * `sample` of the blocked ShipIt process says otherwise: 100% of samples were in
 *
 *   SecStaticCodeCheckValidityWithErrors
 *     -> Security::CodeSigning::SecStaticCode::staticValidate
 *       -> Security::Dispatch::Group::wait
 *         -> __ulock_wait
 *
 * at 4.3% CPU over 4.5 minutes (~11 s of CPU): the process was BLOCKED on the
 * system's code-signing path, not computing. This program measures the same call
 * directly, so the next person can put a number on it in half a second instead of
 * waiting for another release to reproduce a four-minute stall.
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
 * MEASURED WITH IT (2026-09-18, this machine, on the 376 MB arm64 bundle at
 * `/Applications/Local Operator.app`):
 *
 *   validate (Squirrel's flags)   0.25 - 0.38 s, cold and warm alike
 *   codesign --verify --strict --deep   0.43 - 0.45 s
 *
 * Both were measured on the installed bundle and on a fresh extraction of the
 * update artifact - content that had never been validated at that path before -
 * and the two cost the same. So the multi-minute stall is NOT validation work and
 * NOT a cold cache; it is the system's code-signing/trust path queueing behind
 * the flood of files the install itself writes. The same windows in ShipIt's log
 * carry 127-162 Gatekeeper `GK performScan` calls and tens of thousands of
 * syspolicyd/trustd messages, and the machine was at load 140-520 with 7-17 GB of
 * 8-18 GB swap in use.
 *
 * WHAT IT DOES NOT MEASURE, said out loud: this asks the question on an IDLE
 * machine (whatever its load is now), so it is the floor, not the install. It
 * cannot reproduce the queue - only the install does that - and it says nothing
 * about the app's own health.
 *
 * BUILD AND RUN (macOS only; no build system, one line):
 *
 *   clang -O2 -o /tmp/lo-sec-check scripts/sec-check.c \
 *     -framework Security -framework CoreFoundation
 *   /tmp/lo-sec-check "/Applications/Local Operator.app"
 *   /tmp/lo-sec-check --repeat 5 /tmp/extracted/Local\ Operator.app
 *
 * or, through the repository's package script:
 *
 *   pnpm sec-check "/Applications/Local Operator.app"
 *
 * On a host that is not macOS there is no Security.framework to link and no
 * code-signing database to ask, so the program compiles to a single line that
 * says so and exits 0 rather than failing a build on a machine where the
 * measurement is meaningless.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <mach/mach_time.h>

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
		CFStringGetCString(message, text, sizeof(text),
		                   kCFStringEncodingUTF8);
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
	CFStringRef description =
	    (CFStringRef)CFErrorCopyDescription(error);
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

int main(int argc, char **argv) {
	const char *path = NULL;
	int repeat = 1;

	for (int index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--repeat") == 0 && index + 1 < argc) {
			repeat = atoi(argv[++index]);
			if (repeat < 1) {
				repeat = 1;
			}
			continue;
		}
		if (path == NULL) {
			path = argv[index];
		}
	}
	if (path == NULL) {
		fprintf(stderr,
		        "usage: sec-check [--repeat N] <path to an .app bundle>\n"
		        "\n"
		        "Times Squirrel.Mac's own code-signature call - "
		        "SecStaticCodeCreateWithPath then\n"
		        "SecStaticCodeCheckValidityWithErrors with "
		        "kSecCSCheckNestedCode | kSecCSStrictValidate |\n"
		        "kSecCSCheckAllArchitectures - against a bundle and prints "
		        "the timings and the verdict.\n");
		return 2;
	}

	/* The path check is shared by both builds: a path that is not there is a
	 * mistake worth reporting on any host, and "the bundle was missing rather
	 * than valid" must never be what the verdict says. */
	FILE *probe = fopen(path, "r");
	if (probe == NULL) {
		fprintf(stderr, "sec-check: cannot read %s\n", path);
		return 2;
	}
	fclose(probe);

	printf("path: %s\n", path);

	char status[600];
	double fastest = -1.0;
	for (int attempt = 0; attempt < repeat; attempt++) {
		CFStringRef pathString =
		    CFStringCreateWithFileSystemRepresentation(NULL, path);
		if (pathString == NULL) {
			fprintf(stderr, "sec-check: cannot read %s as a path\n", path);
			return 2;
		}
		CFURLRef url = CFURLCreateWithFileSystemPath(
		    NULL, pathString, kCFURLPOSIXPathStyle, true);
		CFRelease(pathString);
		if (url == NULL) {
			fprintf(stderr, "sec-check: cannot build a URL for %s\n", path);
			return 2;
		}

		SecStaticCodeRef code = NULL;
		double start = monotonic_seconds();
		OSStatus createStatus =
		    SecStaticCodeCreateWithPath(url, kSecCSDefaultFlags, &code);
		double createSeconds = monotonic_seconds() - start;
		CFRelease(url);

		status_text(createStatus, status, sizeof(status));
		printf("attempt %d\n", attempt + 1);
		printf("  create   (SecStaticCodeCreateWithPath)          %.4f s   %s\n",
		       createSeconds, status);
		if (createStatus != noErr || code == NULL) {
			printf("VERDICT: could not create a static code object\n");
			return 1;
		}

		SecRequirementRef requirement = NULL;
		start = monotonic_seconds();
		OSStatus requirementStatus = SecCodeCopyDesignatedRequirement(
		    code, kSecCSDefaultFlags, &requirement);
		double requirementSeconds = monotonic_seconds() - start;
		status_text(requirementStatus, status, sizeof(status));
		printf("  require  (SecCodeCopyDesignatedRequirement)     %.4f s   %s\n",
		       requirementSeconds, status);
		if (requirementStatus != noErr) {
			requirement = NULL;
		}

		CFErrorRef validityError = NULL;
		start = monotonic_seconds();
		OSStatus validateStatus = SecStaticCodeCheckValidityWithErrors(
		    code,
		    kSecCSCheckNestedCode | kSecCSStrictValidate |
		        kSecCSCheckAllArchitectures,
		    requirement, &validityError);
		double validateSeconds = monotonic_seconds() - start;
		status_text(validateStatus, status, sizeof(status));
		printf("  validate (SecStaticCodeCheckValidityWithErrors) %.4f s   %s\n",
		       validateSeconds, status);

		if (fastest < 0.0 || validateSeconds < fastest) {
			fastest = validateSeconds;
		}
		if (validateStatus != noErr) {
			print_validity_error(validityError);
			printf("VERDICT: INVALID\n");
			/*
			 * The first failure ends the run: the point of repeating is to see
			 * whether a PASS costs the same warm as cold, and repeating a failure
			 * only multiplies one verdict.
			 */
			if (validityError != NULL) {
				CFRelease(validityError);
			}
			if (requirement != NULL) {
				CFRelease(requirement);
			}
			CFRelease(code);
			return 1;
		}
		if (validityError != NULL) {
			CFRelease(validityError);
		}
		if (requirement != NULL) {
			CFRelease(requirement);
		}
		CFRelease(code);
	}

	printf("VERDICT: valid (%d/%d)\n", repeat, repeat);
	if (repeat > 1) {
		printf("fastest validate: %.4f s\n", fastest);
	}
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
