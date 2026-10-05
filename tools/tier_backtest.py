"""Back-test the user's three token tiers against the real dsh-usage ledger.

Two counting conventions are compared, because they decide whether the tiers
ever trigger:
  A. provider total     = input + output + cacheRead + cacheWrite
  B. fresh tokens only   = input + output                (cache reads excluded)
"""

import json
import os
from pathlib import Path

_HOME = Path(os.environ.get("DSH_HOME") or (Path(os.environ.get("USERPROFILE") or Path.home()) / ".dsh"))
LEDGER = _HOME / "dsh-usage" / "usage-ledger.json"
LOW_MAX = 50_000_000      # 5000w
MID_MAX = 100_000_000     # 1亿


def total(row: dict[str, float]) -> tuple[int, int]:
    provider_total = int(
        row.get("inputTokens", 0)
        + row.get("outputTokens", 0)
        + row.get("cacheReadTokens", 0)
        + row.get("cacheWriteTokens", 0)
    )
    fresh = int(row.get("inputTokens", 0) + row.get("outputTokens", 0))
    return provider_total, fresh


def tier(n: int) -> str:
    return "低" if n < LOW_MAX else ("中" if n <= MID_MAX else "高")


def main() -> int:
    data = json.loads(LEDGER.read_text(encoding="utf-8"))
    days = data["days"]

    print(f"{'day':<12}{'total':>14}{'fresh':>12}{'calls':>7}   tier(total) tier(fresh)")
    counts_a: dict[str, int] = {"低": 0, "中": 0, "高": 0}
    counts_b: dict[str, int] = {"低": 0, "中": 0, "高": 0}
    for day in sorted(days):
        ta = tb = calls = 0
        for _provider, models in days[day].items():
            for _model, row in models.items():
                a, b = total(row)
                ta += a
                tb += b
                calls += int(row.get("calls", 0))
        counts_a[tier(ta)] += 1
        counts_b[tier(tb)] += 1
        print(f"{day:<12}{ta:>14,}{tb:>12,}{calls:>7}   {tier(ta):<11}{tier(tb)}")

    print()
    print(f"tiers by provider total : {counts_a}")
    print(f"tiers by fresh tokens   : {counts_b}")
    peak = max(
        (sum(total(r)[0] for m in days[d].values() for r in m.values()), d) for d in days
    )
    print(f"peak day under A        : {peak[0]:,} on {peak[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


