import json, sys

DS = {"type": "prometheus", "uid": "prometheus"}
panels, pid, y = [], 1, 0


def row(title):
    global pid, y
    panels.append({"type": "row", "title": title, "id": pid, "collapsed": False,
                   "gridPos": {"h": 1, "w": 24, "x": 0, "y": y}, "panels": []})
    pid += 1
    y += 1


def panel(kind, title, exprs, x, w, h=8, unit=None, thresholds=None, legend=None):
    global pid
    targets = []
    for i, e in enumerate(exprs):
        expr, fmt = (e if isinstance(e, tuple) else (e, legend))
        t = {"datasource": DS, "expr": expr, "refId": chr(65 + i)}
        if fmt:
            t["legendFormat"] = fmt
        targets.append(t)
    defaults = {}
    if unit:
        defaults["unit"] = unit
    if thresholds:
        defaults["thresholds"] = {"mode": "absolute", "steps": [
            {"color": c, "value": v} for v, c in thresholds]}
        defaults["color"] = {"mode": "thresholds"}
    p = {"type": kind, "title": title, "id": pid, "datasource": DS, "targets": targets,
         "gridPos": {"h": h, "w": w, "x": x, "y": y},
         "fieldConfig": {"defaults": defaults, "overrides": []}, "options": {}}
    if kind == "stat":
        p["options"] = {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                        "colorMode": "background", "graphMode": "area", "textMode": "auto"}
    pid += 1
    panels.append(p)


API = 'uri!~"/actuator.*"'

row("ExpenseFlow")
panel("bargauge", "Pending approvals by level", ["max by (level) (expenseflow_pending_claims)"], 0, 6, legend="{{level}}")
panel("stat", "Oldest pending approval (h)", ["max(expenseflow_oldest_pending_seconds) / 3600"], 6, 6,
      unit="h", thresholds=[(None, "green"), (48, "red")])
panel("stat", "Payout batches waiting for bank", ["max(expenseflow_payout_pending_batches)"], 12, 6,
      thresholds=[(None, "green"), (1, "red")])
panel("stat", "Duplicate submits caught", ["sum(expenseflow_idempotent_replays_total)"], 18, 6)
y += 8
panel("timeseries", "Policy outcomes (5m)", ["sum by (outcome) (increase(expenseflow_policy_outcomes_total[5m]))"], 0, 8, legend="{{outcome}}")
panel("timeseries", "Status transitions (5m)", ["sum by (to) (increase(expenseflow_claim_transitions_total[5m]))"], 8, 8, legend="{{to}}")
panel("timeseries", "Bank call p95 / errors", [
    ("histogram_quantile(0.95, sum by (le) (rate(expenseflow_bank_call_seconds_bucket[1m])))", "p95 (s)"),
    ('sum(rate(expenseflow_bank_call_seconds_count{outcome="FAILURE"}[1m]))', "errors/s")], 16, 8)
y += 8
panel("timeseries", "API p95 by endpoint", [
    f"histogram_quantile(0.95, sum by (le, uri) (rate(http_server_requests_seconds_bucket{{{API}}}[2m])))"], 0, 24,
    unit="s", legend="{{uri}}")
y += 8

row("Availability")
panel("stat", "Backend replicas up", ['sum(up{job="backend"})'], 0, 6,
      thresholds=[(None, "red"), (1, "orange"), (2, "green")])
panel("timeseries", "Requests per replica", [
    f"sum by (instance) (rate(http_server_requests_seconds_count{{{API}}}[1m]))"], 6, 6, unit="reqps", legend="{{instance}}")
panel("state-timeline", "Synthetic check", ['probe_success{job="blackbox"}'], 12, 6, legend="{{instance}}")
panel("timeseries", "Synthetic latency", ['probe_duration_seconds{job="blackbox"}'], 18, 6, unit="s", legend="{{instance}}")
y += 8

row("SLOs (1 h window)")
AVAIL = (f'1 - (sum(rate(http_server_requests_seconds_count{{{API},status=~"5.."}}[1h])) '
         f'/ clamp_min(sum(rate(http_server_requests_seconds_count{{{API}}}[1h])), 1e-9))')
panel("stat", "API availability (target 99.5%)", [AVAIL], 0, 6, unit="percentunit",
      thresholds=[(None, "red"), (0.995, "green")])
panel("stat", "API latency < 500 ms (target 95%)", [
    f'sum(rate(http_server_requests_seconds_bucket{{{API},le="0.5"}}[1h])) '
    f'/ clamp_min(sum(rate(http_server_requests_seconds_count{{{API}}}[1h])), 1e-9)'], 6, 6,
      unit="percentunit", thresholds=[(None, "red"), (0.95, "green")])
panel("gauge", "Availability error budget left", [f"1 - ((1 - ({AVAIL})) / (1 - 0.995))"], 12, 6,
      unit="percentunit", thresholds=[(None, "red"), (0, "orange"), (0.5, "green")])
panel("stat", "Approval freshness: oldest pending (h, target < 48)", ["max(expenseflow_oldest_pending_seconds) / 3600"], 18, 6,
      unit="h", thresholds=[(None, "green"), (48, "red")])
y += 8

row("Traffic & errors (gateway + backend)")
panel("timeseries", "Gateway requests/s", ["sum(rate(nginx_http_requests_total[1m]))"], 0, 8, unit="reqps", legend="req/s")
panel("timeseries", "Backend 5xx ratio", [
    'sum(rate(http_server_requests_seconds_count{status=~"5.."}[1m])) / clamp_min(sum(rate(http_server_requests_seconds_count[1m])), 1)'],
    8, 8, unit="percentunit", legend="5xx")
panel("timeseries", "JVM heap used", ['sum by (instance) (jvm_memory_used_bytes{area="heap"})'], 16, 8, unit="bytes", legend="{{instance}}")
y += 8

dash = {"uid": "expenseflow", "title": "Hackathon – Overview", "tags": ["expenseflow"],
        "timezone": "browser", "schemaVersion": 39, "version": 1, "refresh": "5s",
        "time": {"from": "now-30m", "to": "now"}, "editable": True, "panels": panels,
        "templating": {"list": []}, "annotations": {"list": []}}
with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as f:
    json.dump(dash, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(len(panels), "panels")
