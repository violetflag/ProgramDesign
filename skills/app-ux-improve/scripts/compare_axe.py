#!/usr/bin/env python3
"""Before/after table from two results.json files written by axe_capture.js.

    python3 compare_axe.py shots-before/results.json shots/results.json

Prints a Markdown table per screen (violating nodes before → after) and a rule-level summary, which goes
straight into the "수정 결과" section of the review and into the PR body.
"""
import json
import signal
import sys

signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # `| head` must not raise


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f).get("axe", {})


def nodes(v):
    return sum(x.get("count", len(x.get("nodes", []))) for x in v)


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    before, after = load(sys.argv[1]), load(sys.argv[2])
    screens = sorted(set(before) | set(after))
    print("| 화면 | 이전 | 이후 |\n|---|---|---|")
    tb = ta = 0
    for s in screens:
        b, a = nodes(before.get(s, [])), nodes(after.get(s, []))
        tb += b
        ta += a
        mark = "✅" if a == 0 else ("🟡" if a < b else "❌")
        print(f"| {s} | {b} | {a} {mark} |")
    print(f"| **합계** | **{tb}** | **{ta}** |\n")

    rules_b, rules_a = {}, {}
    for src, acc in ((before, rules_b), (after, rules_a)):
        for v in src.values():
            for x in v:
                acc[x["id"]] = acc.get(x["id"], 0) + x.get("count", len(x.get("nodes", [])))
    print("| 규칙 | 이전 | 이후 |\n|---|---|---|")
    for r in sorted(set(rules_b) | set(rules_a), key=lambda k: -rules_b.get(k, 0)):
        print(f"| {r} | {rules_b.get(r, 0)} | {rules_a.get(r, 0)} |")
    left = [(s, x) for s, v in after.items() for x in v]
    if left:
        print("\n남은 항목:")
        for s, x in left:
            for n in x.get("nodes", [])[:3]:
                print(f"- {s} · {x['id']} · `{n.get('target', '')[:80]}` · {n.get('html', '')[:100]}")


if __name__ == "__main__":
    main()
