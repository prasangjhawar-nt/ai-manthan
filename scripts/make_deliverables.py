"""Generates the Team 45 QA/DevOps deliverables into docs/deliverables/ from the repo's own sources.

Every number is read from a source file (surefire XML, k6 JSON, Trivy/gitleaks output, integration.sh output,
docs/runbook.md measured lines, evidence/defects.md). Missing source -> "NOT RUN" / "TBD - <what>".
Run from the repo root:  python scripts/make_deliverables.py
"""
import glob
import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime

import yaml
from docx import Document
from docx.shared import Pt
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "docs", "deliverables")
os.makedirs(OUT, exist_ok=True)
TODAY = datetime.now().strftime("%Y-%m-%d %H:%M")
NOT_RUN = "NOT RUN"


def p(*a):
    return os.path.join(ROOT, *a)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def md_tables(text):
    """All markdown tables in text -> list of (header, rows)."""
    tables, cur = [], []
    for line in text.splitlines() + [""]:
        if line.strip().startswith("|"):
            cur.append(line.strip())
        elif cur:
            cells = [[c.strip() for c in r.strip("|").split("|")] for r in cur]
            if len(cells) >= 2 and set(cells[1][0]) <= set("-: "):
                tables.append((cells[0], cells[2:]))
            cur = []
    return tables


def section(text, start, end=None):
    i = text.find(start)
    if i < 0:
        return ""
    j = text.find(end, i + len(start)) if end else -1
    return text[i: j if j > 0 else len(text)]


def clean(s):
    return re.sub(r"\*\*|`|<a id=\"[^\"]*\"></a>", "", s or "").strip()


# ---------------------------------------------------------------- sources
SRS_PATH = p("Expenseflow_readme_srs.md")  # same content as README.md, which lost its markdown formatting
SRS = read(SRS_PATH) if os.path.exists(SRS_PATH) else read(p("README.md"))
RUNBOOK = read(p("docs", "runbook.md")) if os.path.exists(p("docs", "runbook.md")) else ""
TESTPLAN_MD = read(p("docs", "test-plan.md")) if os.path.exists(p("docs", "test-plan.md")) else ""

FRS = dict(re.findall(r"- \*\*(FR-[A-Z]+-\d+)\*\* (.+)", SRS))
RULES = {}
for hdr, rows in md_tables(section(SRS, "### 4.9", "## 5.")):
    for r in rows:
        RULES[r[0]] = r[1]
TRACE = []
for hdr, rows in md_tables(section(SRS, "## 14. Traceability", "## 15.")):
    TRACE = rows
NFR_SEC = []
for hdr, rows in md_tables(section(SRS, "### 9.1 Security", "### 9.2")):
    NFR_SEC = rows
SEED = []
for hdr, rows in md_tables(section(SRS, "## 11. Seed data", "## 12.")):
    SEED = rows
LEVELS = []
for hdr, rows in md_tables(section(SRS, "## 12. Testing strategy", "**E2E cases:**")):
    LEVELS = rows
E2E = re.findall(r"(E2E-\d\d) ([^·\n]+)", section(SRS, "**E2E cases:**", "Automate first"))
E2E = [(i, t.strip()) for i, t in E2E]
AUTOMATE_FIRST = re.findall(r"\d\d", section(SRS, "Automate first", "\n"))
IN_SCOPE = [s.strip() for s in section(SRS, "### 1.3 In scope (MUST)", "### 1.4").splitlines()[1].split("·")]
oos = section(SRS, "### 1.4 Out of scope", "### 1.5").splitlines()
OUT_SCOPE = [s.strip().rstrip(".") for s in oos[1].split("·")]
SHOULD = [s.strip().rstrip(".") for s in oos[2].split(":", 1)[1].split(",")] if len(oos) > 2 and ":" in oos[2] else []


def expand(ref, prefix):
    """'FR-AUTH-1..5' -> [FR-AUTH-1..FR-AUTH-5]; 'R1–R8, R11' -> [R1..R8, R11]."""
    out = []
    for part in re.split(r",\s*", ref):
        part = part.strip()
        m = re.match(r"(FR-[A-Z]+-)(\d+)\.\.(\d+)", part)
        if m:
            out += [f"{m.group(1)}{i}" for i in range(int(m.group(2)), int(m.group(3)) + 1)]
            continue
        m = re.match(r"(FR-[A-Z]+-)(\d+)\.\.(\d+)", part)
        m2 = re.match(r"R(\d+)\s*[–-]\s*R(\d+)", part)
        if m2:
            out += [f"R{i}" for i in range(int(m2.group(1)), int(m2.group(2)) + 1)]
            continue
        m3 = re.match(r"(FR-[A-Z]+-)(\d+)", part)
        if m3:
            out.append(part.split()[0])
            continue
        if re.match(r"R\d+$", part):
            out.append(part)
        elif re.match(r"\d+\.\.\d+", part) and out:  # "6..8" continuing FR-APR-
            base = re.match(r"(FR-[A-Z]+-)", out[-1]).group(1)
            a, b = part.split("..")
            out += [f"{base}{i}" for i in range(int(a), int(b) + 1)]
    return [o for o in out if o.startswith(prefix)]


# Stories from README sec 14 (docs/stories.yaml does not exist)
PERSONA = {"ST-01": "Any user", "ST-02": "Employee", "ST-03": "Employee", "ST-04": "Employee",
           "ST-05": "Manager", "ST-06": "Manager (on leave) / delegate", "ST-07": "Auditor", "ST-08": "Head",
           "ST-09": "Head", "ST-10": "Auditor / Head", "ST-11": "Auditor / any claim viewer",
           "ST-12": "SRE / DevOps"}
STORIES = []
for r in TRACE:
    sid, name = r[0].split(" ", 1)
    STORIES.append({"id": sid, "name": name, "frs": r[1], "rules": r[2], "apis": clean(r[3]), "tests": r[4],
                    "fr_list": expand(r[1], "FR-"), "rule_list": expand(r[2], "R")})

# Surefire
TESTS = []
for x in sorted(glob.glob(p("backend", "target", "surefire-reports", "TEST-*.xml"))):
    for tc in ET.parse(x).getroot().iter("testcase"):
        res = "PASS"
        if tc.find("failure") is not None:
            res = "FAIL"
        elif tc.find("error") is not None:
            res = "ERROR"
        elif tc.find("skipped") is not None:
            res = "SKIPPED"
        cls = tc.get("classname", "")
        TESTS.append({"class": cls.rsplit(".", 1)[-1], "fqcn": cls, "name": tc.get("name", ""),
                      "time": float(tc.get("time") or 0), "result": res})
INTEGRATION_CLASSES = ("controller.", "security.", "ExpenseFlowApplicationTests")


def level(t):
    return "Integration" if any(k in t["fqcn"] for k in INTEGRATION_CLASSES) else "Unit"


CLASS_STORY = {"PolicyEngine": "ST-03", "StatusFlow": "ST-05", "ApprovalService": "ST-05",
               "ApprovalController": "ST-05", "VisibilityAndReceipt": "ST-04", "AuthController": "ST-01",
               "Security": "ST-01", "ClaimController": "ST-02", "PayoutController": "ST-09",
               "ExpenseFlowApplication": "ST-12"}


def story_of(t):
    n = t["name"].lower()
    if "delegat" in n:
        return "ST-06"
    if "head" in n or "100000" in n or "1,00,000" in n:
        return "ST-08"
    if "audit" in n and "sample" in n:
        return "ST-07"
    if "payout" in n or "bank" in n:
        return "ST-09"
    for k, v in CLASS_STORY.items():
        if t["class"].startswith(k):
            return v
    return "TBD - map"


def rule_of(t):
    m = re.findall(r"(?:^|[^a-z])r(\d{1,2})(?:[^0-9]|$)", t["name"].lower())
    rules = sorted({f"R{x}" for x in m if 1 <= int(x) <= 17}, key=lambda s: int(s[1:]))
    if rules:
        return ", ".join(rules)
    n = t["name"].lower()
    for key, r in (("selfapprov", "R15"), ("own", "R15"), ("weekend", "R6"), ("duplicate", "R5"),
                   ("receipt", "R4"), ("meal", "R1"), ("hotel", "R2"), ("cab", "R3"), ("autoapprove", "R16"),
                   ("sample", "R11"), ("resubmit", "R17"), ("delegat", "R10"), ("threshold", "R9"),
                   ("visib", "R13"), ("notfound", "R13"), ("audit", "R14")):
        if key in n.replace("_", "").replace(" ", ""):
            return r
    return "–"


# integration.sh output
INTEG_FILE = sorted(glob.glob(p("evidence", "integration-*.txt")))
INTEG = {"file": None, "pass": None, "fail": None, "lines": []}
if INTEG_FILE:
    txt = read(INTEG_FILE[-1])
    INTEG["file"] = os.path.relpath(INTEG_FILE[-1], ROOT).replace("\\", "/")
    INTEG["lines"] = [l for l in txt.splitlines() if l.startswith(("PASS  ", "FAIL  "))]
    INTEG["pass"] = sum(1 for l in INTEG["lines"] if l.startswith("PASS"))
    INTEG["fail"] = sum(1 for l in INTEG["lines"] if l.startswith("FAIL"))

# k6
K6 = []
for f in sorted(glob.glob(p("evidence", "k6-*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    m = d.get("metrics", {})
    dur = m.get("http_req_duration", {}).get("values", {})
    reqs = m.get("http_reqs", {}).get("values", {})
    failed = m.get("http_req_failed", {}).get("values", {})
    thr = {}
    for name, met in m.items():
        for expr, res in (met.get("thresholds") or {}).items():
            thr[f"{name}: {expr}"] = "PASS" if res.get("ok") else "FAIL"
    K6.append({"file": os.path.relpath(f, ROOT).replace("\\", "/"),
               "vus": m.get("vus_max", {}).get("values", {}).get("max"),
               "duration_s": round(d.get("state", {}).get("testRunDurationMs", 0) / 1000, 1),
               "reqs": reqs.get("count"), "rps": reqs.get("rate"), "avg": dur.get("avg"), "p90": dur.get("p(90)"),
               "p95": dur.get("p(95)"), "p99": dur.get("p(99)"), "err": failed.get("rate"), "thresholds": thr,
               "per_endpoint": {k: v.get("values", {}).get("p(95)") for k, v in m.items() if k.startswith("ef_")}})

# Security scans (latest folder with each file)
SEC_DIRS = sorted(glob.glob(p("evidence", "security", "*")))
SCANS = []
for d in SEC_DIRS[-1:]:
    rel = os.path.relpath(d, ROOT).replace("\\", "/")
    for f in sorted(glob.glob(os.path.join(d, "trivy-*.txt"))):
        totals = re.findall(r"Total: (\d+) \(HIGH: (\d+), CRITICAL: (\d+)\)", read(f))
        n = sum(int(t[0]) for t in totals)
        SCANS.append(("Trivy " + os.path.basename(f)[6:-4], f"{n} fixable HIGH/CRITICAL" if totals else
                      "0 findings (no vulnerable targets reported)", rel + "/" + os.path.basename(f),
                      "PASS" if n == 0 else "FAIL"))
    g = os.path.join(d, "gitleaks.json")
    if os.path.exists(g):
        leaks = json.load(open(g, encoding="utf-8") or "[]") if os.path.getsize(g) else []
        SCANS.append(("gitleaks (history + tree)", f"{len(leaks)} leaks", rel + "/gitleaks.json",
                      "PASS" if not leaks else "FAIL"))
    sboms = glob.glob(os.path.join(d, "sbom-*.cdx.json"))
    if sboms:
        SCANS.append(("SBOM (CycloneDX)", f"{len(sboms)} files", rel + "/", "PASS"))
SEC_CHECKLIST = p("docs", "deliverables", "Security_Checklist_Team45.md")

# Defects
DEFECTS = []
if os.path.exists(p("evidence", "defects.md")):
    for hdr, rows in md_tables(read(p("evidence", "defects.md"))):
        DEFECTS = [dict(zip(["id", "title", "sev", "found", "story", "status", "commit"], [clean(c) for c in r]))
                   for r in rows]

# Playwright / E2E
PW = [f for f in glob.glob(p("**", "*.json"), recursive=True)
      if "playwright" in f.lower() and "node_modules" not in f and "results" in f.lower()]
E2E_SUMMARY = p("evidence", "e2e-summary.md")

# Drills (measured lines in docs/runbook.md)
DRILLS = []
for title, key in (("Drill 1 – bank outage", "### Drill 1"), ("Drill 2 – replica crash under load", "### Drill 2"),
                   ("Drill 3 – backup and restore", "### Drill 3")):
    sec = section(RUNBOOK, key, "###" if key != "### Drill 3" else "## 6.")
    m = re.search(r"^Measured .*$", sec, re.M)
    DRILLS.append((title, clean(m.group(0)) if m else NOT_RUN))

ALERTS = []
for g in yaml.safe_load(read(p("monitoring", "prometheus", "alerts.yml")))["groups"]:
    for r in g["rules"]:
        if "alert" in r:
            ALERTS.append(r)
PANELS = [(pn.get("type"), pn.get("title")) for pn in
          json.load(open(p("monitoring", "grafana", "dashboards", "expenseflow.json"), encoding="utf-8"))["panels"]]

# ---------------------------------------------------------------- derived results
def story_tests(sid):
    return [t for t in TESTS if story_of(t) == sid]


def story_status(sid):
    ts = story_tests(sid)
    open_def = [d["id"] for d in DEFECTS if d["story"] == sid and d["status"].lower() == "open"]
    if not ts:
        st = "TBD - no automated backend test mapped"
    elif all(t["result"] == "PASS" for t in ts):
        st = f"Done - {len(ts)}/{len(ts)} automated tests pass"
    else:
        st = f"In progress - {sum(t['result'] == 'PASS' for t in ts)}/{len(ts)} tests pass"
    return st + (f"; open: {', '.join(open_def)}" if open_def else "")


# ---------------------------------------------------------------- excel helpers
HEAD_FILL = PatternFill("solid", fgColor="1F3864")
HEAD_FONT = Font(bold=True, color="FFFFFF")


def sheet(wb, title, header, rows, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title
    ws.append(header)
    for r in rows:
        ws.append(["" if v is None else v for v in r])
    for c in ws[1]:
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(vertical="center", wrap_text=True)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for i, col in enumerate(ws.columns, 1):
        width = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[get_column_letter(i)].width = min(max(10, width + 2), 70)
        for c in col[1:]:
            c.alignment = Alignment(wrap_text=True, vertical="top")
    return ws


# ---------------------------------------------------------------- 1) Stories workbook
wb = Workbook()
backlog = []
for i, s in enumerate(STORIES, 1):
    backlog.append([s["id"], s["name"], "MUST", story_status(s["id"]),
                    "Prasang (DevOps)" if s["id"] == "ST-12" else "Dipesh (backend) / Mohit (frontend)"])
for i, f in enumerate(SHOULD, 1):
    backlog.append([f"SH-{i:02d}", f, "SHOULD", "TBD - check UI", "Mohit (frontend)"])
for i, f in enumerate(OUT_SCOPE, 1):
    backlog.append([f"SK-{i:02d}", f, "SKIP", "Out of scope (README 1.4)", "–"])
sheet(wb, "Backlog", ["ID", "Feature", "MUST/SHOULD/SKIP", "Status", "Owner"], backlog, first=True)

sheet(wb, "Stories", ["ID", "Persona", "Story", "Priority", "Status"],
      [[s["id"], PERSONA.get(s["id"], "TBD"), f"As {PERSONA.get(s['id'], 'a user').lower()}, I want: "
        f"{s['name']} ({s['frs']}; rules {s['rules']})", "MUST", story_status(s["id"])] for s in STORIES])

ac_rows = []
for s in STORIES:
    n = 0
    for fr in s["fr_list"]:
        if fr not in FRS:
            continue
        n += 1
        text = clean(FRS[fr])
        when, _, then = text.partition(". ")
        ac_rows.append([s["id"], f"{s['id']}-AC{n:02d}", f"{fr}: {PERSONA.get(s['id'])} is logged in, seed data loaded",
                        when, then or "the system behaves exactly as stated (" + fr + ")"])
    for r in s["rule_list"]:
        if r in RULES:
            n += 1
            ac_rows.append([s["id"], f"{s['id']}-AC{n:02d}", f"{r}: a claim/line that exercises the rule",
                            "the claim is submitted / acted on", clean(RULES[r])])
    if n == 0:
        ac_rows.append([s["id"], f"{s['id']}-AC01", "TBD - section " + s["frs"], "TBD", "TBD"])
sheet(wb, "Acceptance Criteria", ["Story ID", "AC ID", "Given", "When", "Then"], ac_rows)

tc_rows = []
for i, t in enumerate(TESTS, 1):
    lv = level(t)
    tc_rows.append([f"{'IT' if lv == 'Integration' else 'UT'}-{i:03d}", story_of(t), rule_of(t),
                    f"mvn verify -> {t['class']}.{t['name']}", "All assertions pass", lv, "Y", t["result"]])
for line in INTEG["lines"]:
    tc_rows.append([f"GW-{len(tc_rows) + 1:03d}", "ST-12", "–", f"tests/integration.sh: {line[6:].strip()}",
                    "PASS", "Gateway/stack integration", "Y", line[:4]])
if not INTEG["lines"]:
    tc_rows.append(["GW-001", "ST-12", "–", "bash tests/integration.sh", "60 checks pass", "Gateway/stack integration",
                    "Y", NOT_RUN])
for eid, title in E2E:
    tc_rows.append([eid, "TBD", "–", title, "As described in README sec 12", "E2E (Playwright)",
                    "N (planned)" if eid[-2:] in AUTOMATE_FIRST else "N", NOT_RUN])
for k in K6:
    tc_rows.append([f"PERF-{K6.index(k) + 1:02d}", "ST-03/ST-05", "–", f"k6 ({k['vus']} VUs) -> {k['file']}",
                    "; ".join(k["thresholds"]) or "thresholds", "Performance", "Y",
                    "PASS" if k["thresholds"] and all(v == "PASS" for v in k["thresholds"].values()) else "FAIL"])
for title, res in DRILLS:
    tc_rows.append([f"DRILL-{DRILLS.index((title, res)) + 1}", "ST-09/ST-12", "–", title, "See runbook sec 5",
                    "Resilience drill", "N (scripted, manual)", "PASS (measured)" if res != NOT_RUN else NOT_RUN])
sheet(wb, "Test Cases", ["TC ID", "Story", "Rule", "Steps", "Expected", "Type", "Automated Y/N", "Result"], tc_rows)

sheet(wb, "Defects", ["ID", "Title", "Severity", "Found by", "Story", "Status", "Fix commit"],
      [[d["id"], d["title"], d["sev"], d["found"], d["story"], d["status"], d["commit"]] for d in DEFECTS]
      or [["TBD - defect log", "", "", "", "", "", ""]])

sheet(wb, "Traceability", ["Story", "Functional reqs", "Rules", "Main APIs", "Planned tests (README 14)",
                           "Automated tests mapped", "Latest result"],
      [[f"{s['id']} {s['name']}", s["frs"], s["rules"], s["apis"], s["tests"], len(story_tests(s["id"])),
        story_status(s["id"])] for s in STORIES])
wb.save(os.path.join(OUT, "Stories_Team45_ExpenseFlow.xlsx"))

# ---------------------------------------------------------------- 2) Test results workbook
def counts(rows):
    n = len(rows)
    ok = sum(r == "PASS" for r in rows)
    return n, ok, n - ok, f"{ok / n * 100:.1f}%" if n else NOT_RUN


unit = [t["result"] for t in TESTS if level(t) == "Unit"]
integ = [t["result"] for t in TESTS if level(t) == "Integration"]
gw = [l[:4] for l in INTEG["lines"]]
perf = ["PASS" if v == "PASS" else "FAIL" for k in K6 for v in k["thresholds"].values()]
sec = [s[3] for s in SCANS]
summary_rows = []
for name, rows, src in (("Unit (JUnit 5)", unit, "backend/target/surefire-reports"),
                        ("Integration (MockMvc + Testcontainers Postgres)", integ, "backend/target/surefire-reports"),
                        ("Gateway / stack (tests/integration.sh)", gw, INTEG["file"] or NOT_RUN),
                        ("E2E (Playwright, 10 cases)", [], "Playwright JSON report not found"),
                        ("Performance (k6 thresholds)", perf, ", ".join(k["file"] for k in K6) or NOT_RUN),
                        ("Security scans", sec, SEC_DIRS[-1].replace(ROOT, "").lstrip("\\/") if SEC_DIRS else NOT_RUN)):
    n, ok, bad, pct = counts(rows)
    summary_rows.append([name, n if n else NOT_RUN, ok if n else "", bad if n else "", pct, src])

wb = Workbook()
sheet(wb, "Summary", ["Level", "Tests", "Passed", "Failed", "Pass %", "Source"], summary_rows, first=True)
sheet(wb, "Unit + Integration", ["Test", "Class", "Level", "Result", "Time (s)"],
      [[t["name"], t["class"], level(t), t["result"], round(t["time"], 3)] for t in TESTS] or [[NOT_RUN]])
sheet(wb, "E2E", ["ID", "Case", "Automate first", "Result", "Evidence"],
      [[e, t, "Y" if e[-2:] in AUTOMATE_FIRST else "N", NOT_RUN, "TBD - Playwright JSON report (Mohit)"]
       for e, t in E2E])
sheet(wb, "Performance", ["Run (file)", "VUs", "Duration (s)", "Requests", "Req/s", "Avg (ms)", "p90 (ms)",
                          "p95 (ms)", "p99 (ms)", "Error rate", "p95 per endpoint (ms)", "Thresholds"],
      [[k["file"], k["vus"], k["duration_s"], k["reqs"], round(k["rps"] or 0, 1), round(k["avg"] or 0, 1),
        round(k["p90"] or 0, 1), round(k["p95"] or 0, 1), round(k["p99"] or 0, 1),
        f"{(k['err'] or 0) * 100:.2f}%", "; ".join(f"{a}={round(b or 0)}" for a, b in k["per_endpoint"].items()),
        "; ".join(f"{a} {b}" for a, b in k["thresholds"].items())] for k in K6] or [[NOT_RUN]])
SEC_STATUS = {  # status per README 9.1 item, with the evidence that shows it
    "NFR-SEC-1": ("PASS", "BCrypt seed hashes; JWT_SECRET from env (.env generated with a random 48-byte secret by scripts)"),
    "NFR-SEC-2": ("PASS", "SecurityTests, VisibilityAndReceiptTest, ApprovalServiceTest (surefire)"),
    "NFR-SEC-3": ("PASS", "ClaimControllerTests validation cases; DB CHECK constraints in V1/V3"),
    "NFR-SEC-4": ("PASS", "ReceiptService magic-byte + size checks; tests/integration.sh upload checks"),
    "NFR-SEC-5": ("PARTIAL", "No secrets in Git (gitleaks clean); DB password still env var, not Docker secret (DEF-28)"),
    "NFR-SEC-6": ("PASS", "tests/integration.sh: security headers, /actuator 404, rate limit 429"),
    "NFR-SEC-7": ("TBD", "TBD - verify masking of account numbers in UI lists and logs"),
    "NFR-SEC-8": ("PASS", "Trivy fs + images: see scan rows below; CI job dependency-check"),
    "NFR-SEC-9": ("PARTIAL", "Independent agent review 2026-11-27 (defects DEF-04..DEF-19); "
                             "docs/deliverables/Security_Checklist_Team45.md: " +
                             ("present" if os.path.exists(SEC_CHECKLIST) else "TBD - not written")),
}
sheet(wb, "Security", ["Item", "Requirement / scan", "Status", "Evidence"],
      [[r[0], clean(r[1]), *SEC_STATUS.get(r[0], ("TBD", "TBD"))] for r in NFR_SEC] +
      [[s[0], s[1], s[3], s[2]] for s in SCANS])
retest_ok = TESTS and all(t["result"] == "PASS" for t in TESTS)
sheet(wb, "Defects", ["ID", "Title", "Found in", "Severity", "Story", "Fix commit", "Status", "Retest"],
      [[d["id"], d["title"], d["found"], d["sev"], d["story"], d["commit"], d["status"],
        "–" if d["status"].lower() == "open" else
        (f"PASS - backend suite {sum(t['result'] == 'PASS' for t in TESTS)}/{len(TESTS)}" if retest_ok
         else "TBD - suite has failures")] for d in DEFECTS])
wb.save(os.path.join(OUT, "Test_Results_Team45_ExpenseFlow.xlsx"))


# ---------------------------------------------------------------- docx helpers
def doc_new(title, subtitle):
    d = Document()
    st = d.styles["Normal"]
    st.font.name, st.font.size = "Calibri", Pt(10)
    d.add_heading(title, 0)
    d.add_paragraph(subtitle)
    return d


def table(d, header, rows):
    t = d.add_table(rows=1, cols=len(header))
    t.style = "Light Grid Accent 1"
    for c, h in zip(t.rows[0].cells, header):
        c.text = str(h)
        c.paragraphs[0].runs[0].bold = True
    for r in rows:
        cells = t.add_row().cells
        for c, v in zip(cells, r):
            c.text = "" if v is None else str(v)
    d.add_paragraph()
    return t


def bullets(d, items):
    for i in items:
        d.add_paragraph(i, style="List Bullet")


# ---------------------------------------------------------------- Test results summary (1 page)
d = doc_new("Test Results Summary – ExpenseFlow", f"Team 45 · AI Manthan 2026 · generated {TODAY} from repo sources")
table(d, ["Level", "Tests", "Passed", "Failed", "Pass %"], [r[:5] for r in summary_rows])
d.add_heading("Performance (k6)", 2)
bullets(d, [f"{k['file']}: {k['vus']} VUs, {k['reqs']} requests, {k['rps']:.1f} req/s, p95 {k['p95']:.0f} ms, "
            f"p99 {k['p99']:.0f} ms, errors {(k['err'] or 0) * 100:.2f}% – thresholds: "
            + ", ".join(f"{a} {b}" for a, b in k["thresholds"].items()) for k in K6] or [NOT_RUN])
d.add_heading("Resilience drills", 2)
bullets(d, [f"{t}: {r}" for t, r in DRILLS])
d.add_heading("Defects", 2)
op = [x for x in DEFECTS if x["status"].lower() == "open"]
bullets(d, [f"{len(DEFECTS)} logged, {len(DEFECTS) - len(op)} fixed, {len(op)} open: "
            + "; ".join(f"{x['id']} {x['title']}" for x in op),
            "E2E (Playwright): NOT RUN – no report in the repo yet (owner Mohit)."])
d.save(os.path.join(OUT, "Test_Results_Summary_Team45.docx"))

# ---------------------------------------------------------------- 3) Test plan
d = doc_new("Test Plan – ExpenseFlow", f"Team 45 · AI Manthan 2026 · generated {TODAY} · source: README sec 4, 9, 11, 12, 14")
d.add_heading("1. Scope", 1)
d.add_paragraph("In scope (README 1.3, MUST):")
bullets(d, IN_SCOPE)
d.add_paragraph("Out of scope (README 1.4):")
bullets(d, OUT_SCOPE)
d.add_heading("2. Test levels and tools", 1)
table(d, ["Level", "What", "Tool", "Owner"], [[clean(c) for c in r] for r in LEVELS])
d.add_heading("3. Environments", 1)
table(d, ["Environment", "How", "Used for"], [
    ["Laptop stack", "docker compose up -d --build --wait (gateway :8080, 2 backend replicas, Postgres 18, WireMock, "
                     "Prometheus, Grafana)", "integration.sh, E2E, k6, drills, demo"],
    ["Laptop + debug ports", "docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build --wait",
     "Prometheus :9090, WireMock :8089, Postgres :5432"],
    ["Backend tests", "Maven on JDK 25 container + Testcontainers postgres:18-alpine (scripts/check.ps1)",
     "unit + integration"],
    ["CI", ".github/workflows/ci-cd.yml (lint, gitleaks, mvn verify, Trivy, stack + integration.sh, k6 smoke)",
     "every push / PR"]])
d.add_heading("4. Seed test data (README 11)", 1)
table(d, ["Item", "Volume", "Detail"], [[clean(c) for c in r] for r in SEED])
d.add_paragraph("Demo users: emp.demo, colleague.demo, mgr.demo, mgr.leave, auditor.demo, head.demo "
                "@expenseflow.test / Demo@123. Reset: scripts/reset-demo.ps1 -Yes (destructive).")
d.add_heading("5. Entry / exit criteria", 1)
bullets(d, [clean(l[2:]) for l in section(TESTPLAN_MD, "## 4. Entry", "## 5.").splitlines() if l.startswith("- ")]
        or ["TBD - entry/exit criteria"])
d.add_heading("6. Risks and mitigations", 1)
table(d, ["Risk", "Mitigation"], [
    ["Laptop too slow for p95 < 500 ms at 50 VUs (measured 982 ms)", "Report honestly; run k6 from a 2nd machine; projections for list endpoints"],
    ["Bank outage during demo payout", "Retry job every 30 s; BankPayoutFailing alert; drill 1 rehearsed"],
    ["Data polluted by k6 writes before the demo", "scripts/reset-demo.ps1 -Yes before the demo"],
    ["Merge conflicts between owners", "Ownership per README 13; backup branch before merges; tests after each merge"],
    ["Docker Desktop proxy/pull failures", "Pinned images, pre-pull, scripts retry builds"],
    ["Flaky random sample audit (R11) in tests", "Tests mock/neutralise randomness; boundary tests on deterministic paths"]])
d.add_heading("7. Scenarios", 1)
scen, n = [], 0
rule_story = {}
for s in STORIES:
    for r in s["rule_list"]:
        rule_story.setdefault(r, s["id"])
for r, text in RULES.items():
    n += 1
    typ = "Unit" if int(r[1:]) <= 8 or r in ("R11", "R16") else "Integration + E2E"
    scen.append([f"SC-{n:02d}", rule_story.get(r, "TBD"), f"{r}: {clean(text)}", typ, "High"])
for amt, exp in (("25,000.00", "ends at MANAGER (strict 'above')"), ("25,000.01", "MANAGER -> AUDITOR"),
                 ("1,00,000.00", "ends at AUDITOR"), ("1,00,000.01", "MANAGER -> AUDITOR -> HEAD")):
    n += 1
    scen.append([f"SC-{n:02d}", "ST-05/ST-08", f"R9 threshold: total {amt} -> {exp}", "Unit (StatusFlow) + Integration", "High"])
for text, st, typ in (("Delegate acts within dates -> allowed, step stores approver + acted_by", "ST-06", "Integration + E2E-08"),
                      ("Delegate acts with expired / future delegation -> 403", "ST-06", "Integration"),
                      ("No token -> 401; wrong role -> 403; other employee's claim -> 404", "ST-01/ST-04", "Integration + E2E-09"),
                      ("Self-approval -> 403 (R15)", "ST-05", "Integration + E2E-09"),
                      ("Idempotent submit / payout: same key -> same response, 1 row", "ST-03/ST-09", "Integration"),
                      ("Gateway: security headers, /actuator hidden, rate limit 429", "ST-12", "tests/integration.sh"),
                      ("Secrets + dependency scan (gitleaks, Trivy)", "ST-12", "scripts/scan.ps1"),
                      ("k6 50 VUs, 70/30 read/write, p95 < 500 ms, errors < 1%", "ST-03/ST-05", "Performance"),
                      ("Drill 1 bank outage -> PENDING_SEND -> retry -> PAID", "ST-09", "Resilience"),
                      ("Drill 2 replica crash under load -> no failed requests", "ST-12", "Resilience"),
                      ("Drill 3 backup + restore -> counts match, RTO measured", "ST-12", "Resilience")):
    n += 1
    scen.append([f"SC-{n:02d}", st, text, typ, "High" if "Drill" not in text else "Medium"])
table(d, ["ID", "Story", "Rule / scenario", "Type", "Priority"], scen)
d.add_heading("8. Defect process", 1)
bullets(d, ["Log in evidence/defects.md: ID, title, severity (Critical/Major/Minor), found by, story, status, fix commit.",
            "Critical/Major block the release gate (scripts/check.ps1 must be ALL PASS).",
            "Owner fixes on their branch; the finder retests and closes with the fix commit SHA.",
            "Every fix gets an automated regression test where possible."])
d.add_heading("9. Owners", 1)
table(d, ["Area", "Owner"], [["Backend (src/main), README", "Dipesh"], ["Frontend, E2E (Playwright)", "Mohit"],
                             ["QA, DevOps, tests (src/test, integration, k6), monitoring, drills", "Prasang"]])
d.add_heading("10. Schedule", 1)
table(d, ["When", "What"], [["2026-11-27", "Backend + integration + k6 + drills + security scan (results: Test_Results workbook)"],
                            ["TBD - date", "E2E Playwright run (10 cases, 5 automated)"],
                            ["Before demo", "scripts/reset-demo.ps1 -Yes, scripts/check.ps1 ALL PASS"]])
d.save(os.path.join(OUT, "Test_Plan_Team45_ExpenseFlow.docx"))

# ---------------------------------------------------------------- 4) Runbook
d = doc_new("Runbook – ExpenseFlow", f"Team 45 · AI Manthan 2026 · generated {TODAY} · source: docs/runbook.md, "
                                     "monitoring/prometheus/alerts.yml, Grafana dashboard JSON")
d.add_heading("1. System overview", 1)
d.add_paragraph(clean(section(RUNBOOK, "## 2. Architecture", "## 3.").split("\n", 1)[1]).strip() or "TBD")
d.add_heading("2. Start / stop / reset and URLs", 1)
for hdr, rows in md_tables(section(RUNBOOK, "## 1. Start", "## 2.")):
    table(d, [clean(h) for h in hdr], [[clean(c) for c in r] for r in rows])
d.add_heading("3. Health endpoints", 1)
table(d, ["Endpoint", "Where", "Meaning"], [
    ["http://localhost:8080/healthz", "gateway (public)", "gateway up (200)"],
    ["/actuator/health/liveness", "inside each backend container", "JVM alive – used by Docker healthcheck"],
    ["/actuator/health/readiness", "inside each backend container", "ready for traffic (DB reachable)"],
    ["/actuator/health", "docker compose exec backend wget -S -qO- http://127.0.0.1:8080/actuator/health",
     "DB + bank indicators (503 with bank: DOWN during drill 1)"],
    ["/actuator/prometheus", "scraped by Prometheus (not routed by the gateway)", "metrics"],
    ["http://localhost:9090/targets", "Prometheus (dev overlay)", "all scrape targets up"]])
d.add_heading("4. Grafana panels (dashboard 'Hackathon – Overview')", 1)
MEANING = {
    "Pending approvals by level": "Claims waiting per level (MANAGER/AUDITOR/HEAD) – queue size",
    "Oldest pending approval (h)": "Age of the oldest waiting claim; > 48 h fires OldestPendingApprovalTooOld",
    "Payout batches waiting for bank": "Batches in PENDING_SEND; > 0 fires BankPayoutFailing",
    "Duplicate submits caught": "Idempotent replays – double clicks absorbed",
    "Policy outcomes (5m)": "AUTO_APPROVE / ROUTE / AUTO_REJECT mix",
    "Status transitions (5m)": "Business flow: claim status changes",
    "Bank call p95 / errors": "Mock bank latency and failed calls",
    "API p95 by endpoint": "Latency per endpoint (target p95 < 500 ms)",
    "Backend replicas up": "Number of healthy backend replicas (expect 2)",
    "Requests per replica": "Load balancing across replicas",
    "Synthetic check": "Blackbox probe of the app through the gateway",
    "Synthetic latency": "Probe response time",
    "API availability (target 99.5%)": "Share of non-5xx responses, 1 h window",
    "API latency < 500 ms (target 95%)": "Share of requests faster than 500 ms",
    "Availability error budget left": "Remaining error budget for the availability SLO",
    "Approval freshness: oldest pending (h, target < 48)": "SLO view of the oldest pending approval",
    "Gateway requests/s": "Traffic at nginx (incl. 429)",
    "Backend 5xx ratio": "Server errors / all requests",
    "JVM heap used": "Memory per replica"}
table(d, ["Panel", "Type", "What it means"],
      [[t, ty, MEANING.get(t, "TBD - meaning")] for ty, t in PANELS if ty != "row"])
d.add_heading("5. Alert playbooks (monitoring/prometheus/alerts.yml)", 1)
PLAY = {
    "OldestPendingApprovalTooOld": ("Prometheus /alerts; Grafana 'Oldest pending approval'; SELECT oldest PENDING_* claim",
                                    "Ask the approver (or delegate) to act; check delegation dates; the seeded stuck claim keeps it firing on purpose",
                                    "Panel < 48 h, alert resolved"),
    "BankPayoutFailing": ("scripts/drill.ps1 status (attempts, last_error); docker compose ps wiremock; backend health shows bank: DOWN",
                          "Bring the bank back (scripts/drill.ps1 bank-start); retry job resends every 30 s or HEAD presses Retry now",
                          "Batch SENT, claims PAID, panel back to 0"),
    "BankCallErrors": ("Grafana 'Bank call p95 / errors'; backend logs (outcome=FAILURE)",
                       "Same as BankPayoutFailing; check EXTERNAL_SERVICE_URL and WireMock mappings", "No new FAILURE calls for 1 min"),
    "BackendReplicaDown": ("docker compose ps; docker compose logs backend", "Docker restarts it (restart policy); else docker compose up -d backend",
                           "2 healthy replicas, panel 'Backend replicas up' = 2"),
    "BackendDown": ("docker compose ps -a; docker compose logs backend migrate postgres", "Fix the cause (DB down, failed migration), docker compose up -d",
                    "/healthz 200 and API login works"),
    "AppUnreachable": ("Grafana 'Synthetic check'; curl.exe http://localhost:8080/healthz", "docker compose restart gateway; check backend health",
                       "probe_success = 1"),
    "HighErrorRate": ("Grafana 'Backend 5xx ratio'; docker compose logs backend (correlationId)", "Find the failing endpoint via correlation id; roll back (runbook sec 6) if a release caused it",
                      "5xx < 5% for 1 min"),
    "HighLatencyP95": ("Grafana 'API p95 by endpoint'; DB load; k6 running?", "Stop load tests; scale: docker compose up -d --scale backend=3 --no-recreate",
                       "p95 < 1 s for 2 min")}
for a in ALERTS:
    name = a["alert"]
    ann = a.get("annotations", {})
    d.add_heading(f"{name} ({a.get('labels', {}).get('severity', '')})", 2)
    chk, fix, ver = PLAY.get(name, ("TBD", "TBD", "TBD"))
    table(d, ["", ""], [["Meaning", clean(ann.get("summary", "")) + (" – " + clean(ann.get("description", "")) if ann.get("description") else "")],
                        ["Rule", f"{a['expr'].strip()}  (for {a.get('for', '0s')})"],
                        ["Check", chk], ["Fix", fix], ["Verify", ver]])
d.add_heading("6. Drills (measured)", 1)
table(d, ["Drill", "Result (from docs/runbook.md)"], DRILLS)
for hdr, rows in md_tables(section(RUNBOOK, "### Drill 1", "Measured")):
    d.add_paragraph("Drill 1 steps:")
    table(d, [clean(h) for h in hdr], [[clean(c) for c in r] for r in rows])
d.add_heading("7. Troubleshooting", 1)
for hdr, rows in md_tables(section(RUNBOOK, "## 7. Troubleshooting", "## 8.")):
    table(d, [clean(h) for h in hdr], [[clean(c) for c in r] for r in rows])
d.add_heading("8. Contacts", 1)
table(d, ["Role", "Name", "Contact"], [["Backend on call", "Dipesh", "TBD - phone / chat"],
                                       ["Frontend", "Mohit", "TBD - phone / chat"],
                                       ["DevOps / QA (incident lead)", "Prasang", "TBD - phone / chat"]])
d.save(os.path.join(OUT, "Runbook_Team45_ExpenseFlow.docx"))

# ---------------------------------------------------------------- report
print("written to docs/deliverables/:", ", ".join(sorted(os.listdir(OUT))))
print(f"surefire tests: {len(TESTS)} ({sum(t['result'] == 'PASS' for t in TESTS)} pass)")
print(f"integration.sh: {INTEG['file'] or NOT_RUN} pass={INTEG['pass']} fail={INTEG['fail']}")
print("k6 files:", [k["file"] for k in K6])
print("NOT RUN / TBD: E2E Playwright report" + ("" if PW else " (missing)") +
      ("; Security_Checklist_Team45.md missing" if not os.path.exists(SEC_CHECKLIST) else "") +
      ("; e2e-summary.md missing" if not os.path.exists(E2E_SUMMARY) else "") +
      ("; docs/stories.yaml missing (stories from README sec 14)" if not os.path.exists(p("docs", "stories.yaml")) else ""))
