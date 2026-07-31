"""What the example box prints when it runs.

Deliberately standard-library only: the example declares no dependencies, so everything
reported here comes from the packed environment itself and not from the host. `sys.prefix` is
the line that matters — it points inside the extracted box, which is the whole claim the tool
makes about relocation.
"""

import platform
import sys


def main() -> int:
    print(f"python      {sys.version.split()[0]}")
    print(f"platform    {platform.system().lower()} / {platform.machine()}")
    print(f"executable  {sys.executable}")
    print(f"prefix      {sys.prefix}")
    print()
    print("This interpreter was packed on another machine and relocated here.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
