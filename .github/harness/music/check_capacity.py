"""Read real hosted macOS page availability; never relax the runtime guard.

The owned-group grant is a required argument so each workflow step admits
exactly the run_bounded --memory-mb it is about to spend: the preflight runs
under 1536 MiB, while the native acceptance (Core graph + desktop app) needs
2560 MiB after run 42690842897 was reaped at 1,537 MiB ~11 s after launch.
There is deliberately no default grant, so an omitted value refuses rather
than silently admitting against a smaller number. The 512 MiB host margin is
fixed and never shrinks with the grant.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

REQUIRED_MARGIN_MIB = 512


def available_mib(text):
    page_size = int(re.search(r'page size of (\d+) bytes', text).group(1))
    counts = dict(re.findall(r'^(Pages (?:free|inactive|speculative)):\s+(\d+)\.', text, re.M))
    if len(counts) != 3:
        raise ValueError('Host vm_stat availability is incomplete; refusing admission')
    return sum(int(value) for value in counts.values()) * page_size / (1024 * 1024)


def admission(measured, grant_mib):
    if grant_mib <= 0:
        raise ValueError('Owned-group grant must be a positive MiB value')
    return {'source': 'host vm_stat free+inactive+speculative pages',
            'available_mib': measured, 'owned_group_grant_mib': grant_mib,
            'required_margin_mib': REQUIRED_MARGIN_MIB,
            'required_mib': grant_mib + REQUIRED_MARGIN_MIB,
            'admitted': measured >= grant_mib + REQUIRED_MARGIN_MIB}


def main(argv=None, measure=lambda: available_mib(subprocess.check_output(['vm_stat'], text=True))):
    parser = argparse.ArgumentParser()
    parser.add_argument('receipt')
    parser.add_argument('--grant-mib', type=int, required=True,
                        help="must equal the step's run_bounded --memory-mb")
    args = parser.parse_args(argv)
    receipt = admission(measure(), args.grant_mib)
    Path(args.receipt).write_text(json.dumps(receipt, indent=2) + '\n')
    if not receipt['admitted']:
        raise SystemExit(
            f"Hosted capacity {receipt['available_mib']:.0f}MiB below explicit "
            f"{args.grant_mib}MiB grant+{REQUIRED_MARGIN_MIB}MiB margin "
            f"({receipt['required_mib']}MiB); no launch")
    return receipt


if __name__ == '__main__':
    main()
