#!/usr/bin/env bash
# ExpenseFlow integration checks through the nginx gateway (README sec 12 "Gateway" + key API rules).
# Usage: bash tests/integration.sh            (BASE_URL defaults to http://localhost:8080)
# Needs: curl. Works in Git Bash and Linux CI. Prints PASS/FAIL per check, exits 1 on any FAIL.
# Note: creates one small claim per run (reset with scripts/reset-demo.ps1). The rate-limit check runs last.
set -u
BASE_URL="${BASE_URL:-http://localhost:8080}"
PASSWORD="${DEMO_PASSWORD:-Demo@123}"
PASS=0; FAIL=0
BODY=""; CODE=""; HEADERS=""

pass() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL  %s  (%s)\n' "$1" "${2:-}"; }
expect_code() { if [ "$CODE" = "$2" ]; then pass "$1"; else fail "$1" "expected $2, got $CODE: ${BODY:0:200}"; fi; }

uuid() {
  cat /proc/sys/kernel/random/uuid 2>/dev/null \
    || uuidgen 2>/dev/null \
    || powershell.exe -NoProfile -Command "[guid]::NewGuid().ToString()" 2>/dev/null | tr -d '\r'
}

# req METHOD PATH [TOKEN] [JSON_BODY] [EXTRA_HEADER]
req() {
  local method="$1" path="$2" token="${3:-}" body="${4:-}" extra="${5:-}"
  local hfile; hfile="$(mktemp)"
  local args=(-s -o /tmp/ef_body.$$ -D "$hfile" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data "$body")
  [ -n "$extra" ] && args+=(-H "$extra")
  CODE="$(curl "${args[@]}")"
  BODY="$(cat /tmp/ef_body.$$ 2>/dev/null)"; rm -f /tmp/ef_body.$$
  HEADERS="$(tr -d '\r' < "$hfile")"; rm -f "$hfile"
}

json_str() { printf '%s' "$BODY" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | sed -E "s/\"$1\":\"([^\"]*)\"/\1/"; }
json_num() { printf '%s' "$BODY" | grep -o "\"$1\":[0-9]*" | head -1 | sed -E "s/\"$1\"://"; }

login() {  # login EMAIL -> echoes token
  req POST /api/auth/login "" "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}"
  json_str token
}

echo "== Gateway ($BASE_URL)"
req GET /healthz;                 expect_code "gateway /healthz" 200
req GET /;                        expect_code "frontend served at /" 200
req GET /claims/12345;            expect_code "SPA fallback for deep link /claims/12345" 200
req GET /actuator/health;         expect_code "/actuator not routed" 404
req GET /actuator/prometheus;     expect_code "/actuator/prometheus not routed" 404
req GET /healthz
for h in 'X-Content-Type-Options: nosniff' 'X-Frame-Options: SAMEORIGIN' 'Content-Security-Policy:' 'Referrer-Policy:'; do
  if printf '%s' "$HEADERS" | grep -qi "^$h"; then pass "security header ${h%%:*}"; else fail "security header ${h%%:*}" "missing"; fi
done
if printf '%s' "$HEADERS" | grep -qi '^X-Request-ID: .\+'; then pass "X-Request-ID on every response"; else fail "X-Request-ID" "missing"; fi
req GET /api/auth/login "" "" "X-Request-ID: it-fixed-id-123"
if printf '%s' "$HEADERS" | grep -qi '^X-Request-ID: it-fixed-id-123'; then pass "client X-Request-ID is kept"; else fail "client X-Request-ID is kept" "$(printf '%s' "$HEADERS" | grep -i x-request-id)"; fi
if printf '%s' "$HEADERS" | grep -qi '^Server: nginx/'; then fail "nginx version hidden" "version visible"; else pass "nginx version hidden"; fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' -L "$BASE_URL/api/swagger-ui.html")"; BODY=""
expect_code "Swagger UI at /api/swagger-ui.html" 200
req GET /v3/api-docs;             expect_code "OpenAPI document" 200

echo "== Auth and access (R13, R15)"
req GET /api/claims;              expect_code "no token -> 401" 401
req POST /api/auth/login "" "{\"email\":\"emp.demo@expenseflow.test\",\"password\":\"wrong-password\"}"
expect_code "wrong password -> 401" 401
if printf '%s' "$BODY" | grep -q '"trace"\|Exception'; then fail "no stack trace in errors"; else pass "no stack trace in errors"; fi

EMP="$(login emp.demo@expenseflow.test)";        [ -n "$EMP" ] && pass "login EMPLOYEE" || fail "login EMPLOYEE" "$CODE"
COL="$(login colleague.demo@expenseflow.test)";  [ -n "$COL" ] && pass "login colleague" || fail "login colleague" "$CODE"
MGR="$(login mgr.demo@expenseflow.test)";        [ -n "$MGR" ] && pass "login MANAGER" || fail "login MANAGER" "$CODE"
AUD="$(login auditor.demo@expenseflow.test)";    [ -n "$AUD" ] && pass "login AUDITOR" || fail "login AUDITOR" "$CODE"
HEAD="$(login head.demo@expenseflow.test)";      [ -n "$HEAD" ] && pass "login HEAD" || fail "login HEAD" "$CODE"

req GET /api/me "$EMP";                            expect_code "GET /api/me" 200
req GET /api/approvals/queue "$EMP";               expect_code "EMPLOYEE -> approver queue 403" 403
req GET /api/dashboard/summary "$EMP";             expect_code "EMPLOYEE -> dashboard 403" 403
req GET /api/payout/eligible "$MGR";               expect_code "MANAGER -> payouts 403" 403
req GET /api/approvals/queue "$MGR";               expect_code "MANAGER queue" 200
req GET /api/dashboard/summary "$HEAD";            expect_code "HEAD dashboard" 200

req GET "/api/claims?status=PENDING_MANAGER" "$COL"; COL_CLAIM="$(json_num id)"
req GET "/api/claims/$COL_CLAIM" "$EMP";           expect_code "EMPLOYEE opens colleague's claim -> 404 (R13)" 404
req GET "/api/claims/$COL_CLAIM/audit" "$EMP";     expect_code "...and its audit timeline -> 404" 404

req GET "/api/claims?status=PENDING_MANAGER" "$MGR"; OWN="$(json_num id)"
req POST "/api/claims/$OWN/approve" "$MGR" '{"comment":"self"}'
expect_code "MANAGER approves own claim -> 403 (R15)" 403

echo "== Claim flow: create, idempotent submit, approve, pay (R12)"
TODAY="$(date -u +%Y-%m-%d)"
KEY="$(uuid)"
req POST /api/claims "$EMP" "{\"title\":\"IT check $KEY\",\"lines\":[{\"category\":\"TRAIN\",\"expenseDate\":\"$TODAY\",\"amount\":420.00,\"vendor\":\"IRCTC\"}]}" "Idempotency-Key: $KEY"
expect_code "create draft" 201
CLAIM="$(json_num id)"
SUBMIT_KEY="$(uuid)"
req POST "/api/claims/$CLAIM/submit" "$EMP" "" "Idempotency-Key: $SUBMIT_KEY"; FIRST="$BODY"; FIRST_CODE="$CODE"
[ "$FIRST_CODE" = "200" ] && pass "submit" || fail "submit" "$FIRST_CODE ${BODY:0:200}"
req POST "/api/claims/$CLAIM/submit" "$EMP" "" "Idempotency-Key: $SUBMIT_KEY"
if [ "$CODE" = "$FIRST_CODE" ] && [ "$BODY" = "$FIRST" ]; then pass "same Idempotency-Key -> same response"; else fail "idempotent submit" "$CODE"; fi
BODY="$FIRST"
STATUS="$(json_str status)"
[ "$STATUS" = "PENDING_MANAGER" ] && pass "TRAIN line (no policy) routed -> PENDING_MANAGER" || fail "routed to manager" "$STATUS"
req POST "/api/claims/$CLAIM/approve" "$EMP" '{}'; expect_code "employee cannot approve" 403
req POST "/api/claims/$CLAIM/approve" "$MGR" '{"comment":"ok"}'; expect_code "manager approves" 200
[ "$(json_str status)" = "APPROVED" ] && pass "total <= 25,000 -> APPROVED (R9)" || fail "APPROVED after manager" "$(json_str status)"
req POST "/api/claims/$CLAIM/approve" "$MGR" '{}'; expect_code "approve twice -> 409" 409

req POST /api/payout-batches "$HEAD" "{\"claimIds\":[$CLAIM]}" "Idempotency-Key: $(uuid)"
expect_code "HEAD creates payout batch" 201
BATCH="$(json_num id)"
BSTATUS="$(json_str status)"
if [ "$BSTATUS" = "SENT" ]; then pass "bank accepted -> batch SENT"; else fail "batch SENT (is wiremock up?)" "$BSTATUS"; fi
req GET "/api/claims/$CLAIM" "$EMP"
[ "$(json_str status)" = "PAID" ] && pass "claim PAID only after bank accepted (R12)" || fail "claim PAID" "$(json_str status)"
req GET "/api/payout-batches/$BATCH/file" "$HEAD"; expect_code "download payout CSV" 200
if printf '%s' "$BODY" | head -1 | grep -q '^batch_ref,claim_number,employee_code'; then pass "CSV header"; else fail "CSV header" "${BODY:0:80}"; fi
req GET "/api/claims/$CLAIM/audit" "$EMP";        expect_code "audit timeline" 200
N="$(printf '%s' "$BODY" | grep -o '"action"' | wc -l | tr -d ' ')"
[ "$N" -ge 5 ] && pass "audit has $N events (create, submit, policy, approve, paid)" || fail "audit events" "$N"

echo "== Edit, validation, errors, delegation, queues"
KEY="$(uuid)"
req POST /api/claims "$EMP" "{\"title\":\"IT edit $KEY\",\"lines\":[{\"category\":\"TRAIN\",\"expenseDate\":\"$TODAY\",\"amount\":100.00,\"vendor\":\"IRCTC\"}]}" "Idempotency-Key: $KEY"
EDIT_ID="$(json_num id)"; VER="$(json_num version)"
req PUT "/api/claims/$EDIT_ID" "$EMP" "{\"title\":\"IT edited\",\"version\":$VER,\"lines\":[{\"category\":\"TRAIN\",\"expenseDate\":\"$TODAY\",\"amount\":150.00,\"vendor\":\"IRCTC\"},{\"category\":\"OTHER\",\"expenseDate\":\"$TODAY\",\"amount\":50.00,\"vendor\":\"Staples\"}]}"
expect_code "edit draft (replace lines) – FR-CLM-5" 200
NEWVER="$(json_num version)"
[ -n "$NEWVER" ] && [ "$NEWVER" != "$VER" ] && pass "edit returns the new version" || fail "edit returns the new version" "$VER -> $NEWVER"
req PUT "/api/claims/$EDIT_ID" "$EMP" "{\"title\":\"stale\",\"version\":$VER,\"lines\":[{\"category\":\"TRAIN\",\"expenseDate\":\"$TODAY\",\"amount\":1.00,\"vendor\":\"IRCTC\"}]}"
expect_code "stale version -> 409" 409
req POST /api/claims "$EMP" '{"title":"","lines":[{"category":"MEALS","amount":-5,"vendor":""}]}' "Idempotency-Key: $(uuid)"
expect_code "invalid body -> 400" 400
if printf '%s' "$BODY" | grep -q '"errors"' && printf '%s' "$BODY" | grep -q '"correlationId":"'; then pass "400 has errors[] and correlationId"; else fail "400 body" "${BODY:0:200}"; fi
req GET "/api/claims?page=-1" "$EMP";               expect_code "page=-1 -> 400 (not 500)" 400
req GET "/api/claims?page=abc" "$EMP";              expect_code "page=abc -> 400" 400
if printf '%s' "$BODY" | grep -q '"correlationId":"'; then pass "framework 400 has correlationId"; else fail "framework 400 correlationId" "${BODY:0:200}"; fi
req POST /api/payout-batches "$HEAD" "{\"claimIds\":[$CLAIM,$CLAIM]}" "Idempotency-Key: $(uuid)"
expect_code "duplicate claimIds in a payout -> 400" 400
req GET /api/me "$EMP"
N_RID="$(printf '%s' "$HEADERS" | grep -ci '^X-Request-ID:')"
[ "$N_RID" = "1" ] && pass "exactly one X-Request-ID header on /api" || fail "X-Request-ID count" "$N_RID"
req GET "/api/approvals/queue?size=1" "$MGR";       DELEG_CLAIM="$(json_num id)"   # oldest = seeded stuck claim of mgr.leave's team
req GET "/api/claims/$DELEG_CLAIM" "$MGR";          expect_code "active delegate (mgr.demo for mgr.leave) can open the claim – R10" 200
req GET "/api/approvals/queue?size=100" "$HEAD"
if printf '%s' "$BODY" | grep -q '"status":"PENDING_MANAGER"'; then pass "HEAD queue shows claims where HEAD is the manager"; else fail "HEAD queue manager-level claims" "${BODY:0:150}"; fi
req GET "/api/approvals/queue?size=100" "$AUD"
if printf '%s' "$BODY" | grep -q "\"employeeName\":\"Kavya Reddy\""; then fail "auditor queue hides own claims" "own claim listed"; else pass "auditor queue hides own claims"; fi

echo "== Rate limit (last: it throttles this IP for a minute)"
GOT429=0
for _ in $(seq 1 45); do
  c="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' --data '{"email":"x@expenseflow.test","password":"x"}')"
  [ "$c" = "429" ] && GOT429=1 && break
done
[ "$GOT429" = 1 ] && pass "login rate limit -> 429" || fail "login rate limit" "no 429 in 45 tries"

echo "== Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
