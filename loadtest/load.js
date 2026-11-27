// ExpenseFlow load test (README 9.2, devops.md 13, playbook P14).
// Mix: 70% reads / 30% writes, unique Idempotency-Keys, one login per role in setup().
// TARGET=http://backend:8080 -> real backend capacity (DNS round-robin over replicas)
// TARGET=http://gateway:8080 (default) -> through nginx, 429s from the rate limit are expected, not errors.
// Run: docker compose --profile loadtest run --rm k6        (env: TARGET, VUS, DURATION, NAME)
// Writes create real claims for emp.demo (pending in mgr.demo's queue): run scripts/reset-demo.ps1 before a demo.
import http from 'k6/http';
import { check, group } from 'k6';
import { Trend } from 'k6/metrics';

const TARGET = __ENV.TARGET || 'http://gateway:8080';
const VUS = parseInt(__ENV.VUS || '50', 10);
const DURATION = __ENV.DURATION || '1m';
const NAME = __ENV.NAME || (TARGET.includes('backend') ? 'backend' : 'gateway');
const PASSWORD = __ENV.DEMO_PASSWORD || 'Demo@123';

const listTrend = new Trend('ef_claim_list', true);
const detailTrend = new Trend('ef_claim_detail', true);
const queueTrend = new Trend('ef_queue', true);
const submitTrend = new Trend('ef_create_submit', true);

// 429 from the gateway rate limit is expected behaviour, not a failure
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

export const options = {
  scenarios: {
    golden_mix: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '15s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{expected_response:true}': ['p(95)<500'],
    ef_claim_list: ['p(95)<500'],
    ef_claim_detail: ['p(95)<500'],
    ef_queue: ['p(95)<500'],
    ef_create_submit: ['p(95)<500'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function uuid() {
  // RFC 4122 v4 from Math.random – fine for idempotency keys in a load test
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function login(email) {
  const res = http.post(`${TARGET}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'login' },
  });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${res.body}`);
  return res.json('token');
}

export function setup() {
  const tokens = {
    employee: login('emp.demo@expenseflow.test'),
    manager: login('mgr.demo@expenseflow.test'),
    auditor: login('auditor.demo@expenseflow.test'),
  };
  const list = http.get(`${TARGET}/api/claims?size=20`, { headers: auth(tokens.employee) });
  const ids = (list.json('content') || []).map((c) => c.id);
  return { tokens, ids };
}

function auth(token, extra) {
  return Object.assign({ Authorization: `Bearer ${token}` }, extra || {});
}

// 80 days back (still inside the 90-day window), weekday: never the golden-flow dates, so the demo claim's
// R1 (daily meals) and R5 (duplicates) checks are not affected. TRAIN has no daily-sum rule either.
function writeDateIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 80);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function (data) {
  const r = Math.random();
  if (r < 0.30) {
    group('read: my claims', () => {
      const res = http.get(`${TARGET}/api/claims?page=0&size=20`, { headers: auth(data.tokens.employee), tags: { name: 'GET /api/claims' } });
      listTrend.add(res.timings.duration);
      check(res, { 'list 200': (x) => x.status === 200 || x.status === 429 });
    });
  } else if (r < 0.50) {
    group('read: claim detail', () => {
      const id = data.ids.length ? data.ids[Math.floor(Math.random() * data.ids.length)] : 0;
      const res = http.get(`${TARGET}/api/claims/${id}`, { headers: auth(data.tokens.employee), tags: { name: 'GET /api/claims/{id}' } });
      detailTrend.add(res.timings.duration);
      check(res, { 'detail 200': (x) => x.status === 200 || x.status === 429 });
    });
  } else if (r < 0.70) {
    group('read: approver queue', () => {
      const token = Math.random() < 0.5 ? data.tokens.manager : data.tokens.auditor;
      const res = http.get(`${TARGET}/api/approvals/queue?page=0&size=20`, { headers: auth(token), tags: { name: 'GET /api/approvals/queue' } });
      queueTrend.add(res.timings.duration);
      check(res, { 'queue 200': (x) => x.status === 200 || x.status === 429 });
    });
  } else {
    group('write: create + submit', () => {
      const body = JSON.stringify({
        title: `k6 ${uuid().slice(0, 8)}`,
        lines: [{ category: 'TRAIN', expenseDate: writeDateIso(), amount: 120 + Math.round(Math.random() * 300), vendor: `k6 vendor ${uuid().slice(0, 6)}` }],
      });
      const created = http.post(`${TARGET}/api/claims`, body, {
        headers: auth(data.tokens.employee, { 'Content-Type': 'application/json', 'Idempotency-Key': uuid() }),
        tags: { name: 'POST /api/claims' },
      });
      submitTrend.add(created.timings.duration);
      if (!check(created, { 'create 201': (x) => x.status === 201 || x.status === 429 }) || created.status !== 201) return;
      const id = created.json('id');
      const sub = http.post(`${TARGET}/api/claims/${id}/submit`, null, {
        headers: auth(data.tokens.employee, { 'Idempotency-Key': uuid() }),
        tags: { name: 'POST /api/claims/{id}/submit' },
      });
      submitTrend.add(sub.timings.duration);
      check(sub, { 'submit 200': (x) => x.status === 200 || x.status === 429 });
    });
  }
}

export function handleSummary(data) {
  const m = data.metrics;
  const p = (name) => (m[name] && m[name].values['p(95)'] !== undefined ? m[name].values['p(95)'].toFixed(1) : 'n/a');
  const lines = [
    `ExpenseFlow k6 – ${NAME} – target ${TARGET} – ${VUS} VUs`,
    `requests: ${m.http_reqs.values.count}  rate: ${m.http_reqs.values.rate.toFixed(1)}/s  failed: ${(m.http_req_failed.values.rate * 100).toFixed(2)}%`,
    `p95 ms – all: ${p('http_req_duration')}  list: ${p('ef_claim_list')}  detail: ${p('ef_claim_detail')}  queue: ${p('ef_queue')}  create/submit: ${p('ef_create_submit')}`,
    `thresholds: ${Object.entries(m).filter(([, v]) => v.thresholds).map(([k, v]) => `${k}=${Object.values(v.thresholds).every((t) => t.ok) ? 'ok' : 'FAILED'}`).join(', ')}`,
  ];
  return {
    stdout: lines.join('\n') + '\n',
    // setup_data holds bearer tokens: never write them to evidence/ (committed)
    [`/evidence/k6-${NAME}.json`]: JSON.stringify(Object.assign({}, data, { setup_data: undefined }), null, 2),
  };
}
