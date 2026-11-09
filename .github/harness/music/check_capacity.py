"""Read real hosted macOS page availability; never relax the runtime guard."""
import json
import re
import subprocess
import sys
from pathlib import Path


def available_mib(text):
    page_size = int(re.search(r'page size of (\d+) bytes', text).group(1))
    counts = dict(re.findall(r'^(Pages (?:free|inactive|speculative)):\s+(\d+)\.', text, re.M))
    if len(counts) != 3:
        raise ValueError('Host vm_stat availability is incomplete; refusing admission')
    return sum(int(value) for value in counts.values()) * page_size / (1024 * 1024)


if __name__ == '__main__':
    measured = available_mib(subprocess.check_output(['vm_stat'], text=True))
    receipt = {'source': 'host vm_stat free+inactive+speculative pages',
               'available_mib': measured, 'owned_group_grant_mib': 1536,
               'required_margin_mib': 512, 'admitted': measured >= 1536 + 512}
    Path(sys.argv[1]).write_text(json.dumps(receipt, indent=2) + '\n')
    if not receipt['admitted']:
        raise SystemExit('Hosted capacity below explicit1536MiB grant+512MiB margin; no native launch')
