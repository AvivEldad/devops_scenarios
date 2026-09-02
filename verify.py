#!/usr/bin/env python3
"""Check catalog integrity and that every scenario has the sections the viewer needs.

Run from the project root:  python3 verify.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
REQUIRED = ["briefing", "your task", "starter files", "hints", "solution"]
OUTCOME_ALIASES = ["expected outcome", "expected outcome (when fixed)", "definition of done"]
FAILURE_ALIASES = ["expected failure", "what you should see", "the failure"]


def split_sections(text, marker):
    """Split on headings of the given level, ignoring headings inside code fences."""
    out, current, in_fence = [], {"title": None, "body": []}, False
    pattern = re.compile(r"^%s\s+(.*)$" % marker)
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        m = None if in_fence else pattern.match(line)
        if m:
            out.append(current)
            current = {"title": m.group(1).strip(), "body": []}
        else:
            current["body"].append(line)
    out.append(current)
    return [{"title": s["title"], "body": "\n".join(s["body"]).strip()} for s in out]


TARGET_PER_LEVEL = 10
LEVELS = ("beginner", "intermediate", "expert")


def build_coverage(catalog, per_topic):
    """Render a table of scenarios per topic per level against the target."""
    names = {t["id"]: t["name"] for t in catalog["topics"]}
    width = max(len(n) for n in names.values())
    lines = ["%-*s  %-6s %-6s %-6s  %s" % (width, "topic", "begin", "inter", "exprt", "total")]
    lines.append("-" * (width + 30))

    grand = 0
    for tid in [t["id"] for t in catalog["topics"]]:
        levels = per_topic.get(tid, [])
        cells, total = [], 0
        for lvl in LEVELS:
            n = levels.count(lvl)
            total += n
            cells.append("%d/%d" % (n, TARGET_PER_LEVEL))
        grand += total
        lines.append("%-*s  %-6s %-6s %-6s  %d/%d"
                     % (width, names[tid], cells[0], cells[1], cells[2],
                        total, TARGET_PER_LEVEL * len(LEVELS)))

    target = TARGET_PER_LEVEL * len(LEVELS) * len(catalog["topics"])
    lines.append("-" * (width + 30))
    lines.append("%-*s  %-6s %-6s %-6s  %d/%d  (%d%%)"
                 % (width, "TOTAL", "", "", "", grand, target,
                    round(100 * grand / target) if target else 0))
    return "\n".join(lines)


def main():
    errors, warnings = [], []

    catalog_path = os.path.join(ROOT, "data", "scenarios.json")
    with open(catalog_path) as fh:
        catalog = json.load(fh)

    topic_ids = {t["id"] for t in catalog["topics"]}
    seen_ids = set()
    per_topic = {}

    for s in catalog["scenarios"]:
        sid = s["id"]
        if sid in seen_ids:
            errors.append("duplicate scenario id: %s" % sid)
        seen_ids.add(sid)

        if s["topic"] not in topic_ids:
            errors.append("%s: unknown topic %r" % (sid, s["topic"]))
        if s["level"] not in ("beginner", "intermediate", "expert"):
            errors.append("%s: unknown level %r" % (sid, s["level"]))
        per_topic.setdefault(s["topic"], []).append(s["level"])

        path = os.path.join(ROOT, s["path"])
        if not os.path.isfile(path):
            errors.append("%s: missing file %s" % (sid, s["path"]))
            continue

        with open(path) as fh:
            text = fh.read()

        if text.count("```") % 2 != 0:
            errors.append("%s: unbalanced code fences (%d backtick fences)"
                          % (sid, text.count("```")))

        parts = split_sections(text, "##")
        preamble = parts.pop(0)
        if not re.search(r"^#\s+\S", preamble["body"], re.M):
            errors.append("%s: no H1 title" % sid)

        titles = [p["title"].lower() for p in parts if p["title"]]

        for need in REQUIRED:
            if not any(t.startswith(need) for t in titles):
                errors.append("%s: missing section %r" % (sid, need))

        if not any(t in OUTCOME_ALIASES for t in titles):
            errors.append("%s: missing an 'Expected Outcome' section" % sid)
        if not any(t in FAILURE_ALIASES for t in titles):
            warnings.append("%s: no 'Expected Failure' section" % sid)

        # starter files must contain at least one parseable file block
        starter = next((p for p in parts if p["title"].lower().startswith("starter files")), None)
        if starter:
            files = [f for f in split_sections(starter["body"], "###") if f["title"]]
            if not files:
                errors.append("%s: 'Starter Files' contains no '### file:' blocks" % sid)
            for f in files:
                if not f["title"].lower().startswith("file:"):
                    errors.append("%s: starter block %r should start with 'file:'"
                                  % (sid, f["title"]))
                if not re.search(r"```(\S*)\n[\s\S]*?```", f["body"]):
                    errors.append("%s: starter file %r has no code fence" % (sid, f["title"]))

        hints = next((p for p in parts if p["title"].lower().startswith("hints")), None)
        if hints:
            hs = [h for h in split_sections(hints["body"], "###") if h["title"]]
            if len(hs) < 2:
                warnings.append("%s: only %d hint(s)" % (sid, len(hs)))

    for topic in sorted(topic_ids):
        levels = per_topic.get(topic, [])
        for lvl in ("beginner", "intermediate", "expert"):
            if lvl not in levels:
                warnings.append("topic %s has no %s scenario" % (topic, lvl))

    coverage = build_coverage(catalog, per_topic)

    # every scenario file on disk must be in the catalog
    catalog_paths = {s["path"] for s in catalog["scenarios"]}
    for dirpath, _, filenames in os.walk(os.path.join(ROOT, "scenarios")):
        for fn in filenames:
            if not fn.endswith(".md"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), ROOT)
            if rel not in catalog_paths:
                warnings.append("orphan file not in catalog: %s" % rel)

    print("scenarios in catalog: %d" % len(catalog["scenarios"]))
    print("topics: %d" % len(catalog["topics"]))
    print()
    print(coverage)

    for w in warnings:
        print("WARN  %s" % w)
    for e in errors:
        print("FAIL  %s" % e)

    if errors:
        print("\n%d error(s)" % len(errors))
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
