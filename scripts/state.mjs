#!/usr/bin/env node
// Single writer of workflows/<run-id>/workflow-state.json.
// Usage: node scripts/state.mjs <command> [args]   (run `node scripts/state.mjs help` for the list)
import {
  readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = process.env.GARAGE_WORKFLOWS_DIR
  ? resolve(process.env.GARAGE_WORKFLOWS_DIR)
  : join(ROOT, 'workflows');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config', 'workflow.json'), 'utf8'));
const RUN_ID_RE = new RegExp(CONFIG.run_id_pattern);

const WORKFLOW_TYPES = ['project-plan', 'purchase-decision', 'how-to'];
const AGENTS = [
  'requirements-formalizer', 'diy-researcher', 'product-researcher', 'project-planner',
  'cost-planner', 'evidence-validator', 'synthesizer', 'final-output-builder',
];
const RUN_STATUSES = [
  'intake', 'requirements', 'planning', 'executing', 'validating', 'synthesizing',
  'awaiting_approval', 'revision_requested', 'approved', 'rendering', 'completed', 'blocked',
];
const REQUIREMENTS_NODE = 'requirements-formalizer';
const REQUIREMENTS_ARTIFACT = 'artifacts/requirements.md';
const ARTIFACT_RE = /^(artifacts\/[a-z0-9-]+\.md|output\/garage-plan\.html)$/;
const NODE_ID_RE = /^[a-z0-9-]+$/;

function die(msg) {
  console.error(`state: ${msg}`);
  process.exit(1);
}

const now = () => new Date().toISOString();

function runDir(runId) {
  if (!RUN_ID_RE.test(runId || '')) die(`invalid run id: ${runId}`);
  return join(WORKFLOWS, runId);
}

const statePath = (runId) => join(runDir(runId), 'workflow-state.json');

function loadState(runId) {
  const p = statePath(runId);
  if (!existsSync(p)) die(`run not found: ${runId}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function saveState(state) {
  state.updated_at = now();
  const p = statePath(state.run_id);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, p);
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const fileHash = (path) => sha256(readFileSync(path));

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'run';
}

function newRunId(slug) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `${stamp}-${slugify(slug)}`;
}

// ---------- graph helpers ----------

function getNode(state, id) {
  const node = state.plan.nodes.find((n) => n.id === id);
  if (!node) die(`unknown node: ${id}`);
  return node;
}

// Transitive dependents of a node, in plan order.
function dependentsOf(state, id) {
  const found = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of state.plan.nodes) {
      if (found.has(n.id)) continue;
      if (n.depends_on.some((d) => d === id || found.has(d))) {
        found.add(n.id);
        grew = true;
      }
    }
  }
  return state.plan.nodes.filter((n) => found.has(n.id));
}

function assertAcyclic(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') die(`dependency cycle: ${[...trail, id].join(' -> ')}`);
    state.set(id, 'visiting');
    for (const d of byId.get(id).depends_on) visit(d, [...trail, id]);
    state.set(id, 'done');
  };
  for (const n of nodes) visit(n.id, []);
}

function markStale(node, reason) {
  node.status = 'stale';
  node.last_error = reason;
}

// Counts a failure against the node's retry budget, then marks it for a re-run or blocks it.
function failNode(state, node, reason) {
  node.last_error = reason;
  node.stage_gate = { result: 'fail', at: now(), findings: reason };
  const downstream = dependentsOf(state, node.id);
  if (node.retries >= state.config.max_retries) {
    node.status = 'blocked';
    for (const d of downstream) {
      d.status = 'skipped';
      d.last_error = `skipped: upstream ${node.id} is blocked`;
    }
    state.status = 'blocked';
    return `${node.id}: BLOCKED after ${node.retries} retries; skipped ${downstream.map((d) => d.id).join(', ') || 'nothing'}`;
  }
  node.retries += 1;
  markStale(node, reason);
  const reset = [];
  for (const d of downstream) {
    if (['created', 'validated', 'running'].includes(d.status)) {
      markStale(d, `upstream ${node.id} is being re-run`);
      reset.push(d.id);
    }
  }
  return `${node.id}: retry ${node.retries}/${state.config.max_retries}; downstream marked stale: ${reset.join(', ') || 'none'}`;
}

function usage() {
  return `commands: ${Object.keys(commands).join(', ')}`;
}

// ---------- commands ----------

const commands = {
  // init <slug> -> creates run folders and initial state, prints the run id
  init([slug]) {
    if (!slug) die('usage: init <english-slug>');
    mkdirSync(WORKFLOWS, { recursive: true });
    let runId = newRunId(slug);
    let n = 2;
    while (existsSync(runDir(runId))) runId = `${newRunId(slug)}-${n++}`;
    const dir = runDir(runId);
    mkdirSync(join(dir, 'artifacts'), { recursive: true });
    mkdirSync(join(dir, 'output'), { recursive: true });
    saveState({
      schema_version: 1,
      run_id: runId,
      created_at: now(),
      updated_at: now(),
      status: 'intake',
      workflow_type: null,
      request_file: 'request.md',
      requirements: { confirmed: false, confirmed_at: null, artifact_sha256: null },
      config: { max_retries: CONFIG.max_retries },
      plan: { nodes: [] },
      domain_gates: { attempt: 0, results: [], result: null, processed_sha256: null },
      approval: { status: 'not_requested', round: 0, history: [] },
      memory_writeback: { status: 'not_started' },
      final_output: { status: 'not_started', path: null },
    });
    console.log(runId);
  },

  // confirm-requirements <run-id> -> records the confirmed requirements hash, moves run to planning
  'confirm-requirements'([runId]) {
    const s = loadState(runId);
    const file = join(runDir(runId), REQUIREMENTS_ARTIFACT);
    if (!existsSync(file)) die(`${REQUIREMENTS_ARTIFACT} does not exist`);
    const text = readFileSync(file, 'utf8');
    if (!/^status:\s*ready\s*$/m.test(text)) die('requirements.md is not status: ready');
    const type = text.match(/^workflow_type:\s*(\S+)\s*$/m)?.[1];
    if (!WORKFLOW_TYPES.includes(type)) die(`requirements.md has invalid workflow_type: ${type}`);
    s.workflow_type = type;
    s.requirements = { confirmed: true, confirmed_at: now(), artifact_sha256: sha256(text) };
    const reqNode = s.plan.nodes.find((n) => n.id === REQUIREMENTS_NODE);
    if (reqNode) {
      reqNode.status = 'validated';
      reqNode.artifact_sha256 = s.requirements.artifact_sha256;
      reqNode.stage_gate = { result: 'pass', at: s.requirements.confirmed_at };
      reqNode.last_error = null;
    }
    s.status = s.plan.nodes.length > 1 ? 'executing' : 'planning';
    saveState(s);
    console.log(`${runId}: requirements confirmed, workflow_type=${type}`);
  },

  // set-plan <run-id> <plan.json>
  // plan.json: {"nodes":[{"id","agent","artifact","depends_on":[],"gate":"approval"?}]}
  // The requirements-formalizer node is added automatically as already validated.
  'set-plan'([runId, planFile]) {
    const s = loadState(runId);
    if (!s.requirements.confirmed) die('requirements are not confirmed');
    if (s.plan.nodes.some((n) => n.id !== REQUIREMENTS_NODE && n.status !== 'pending')) {
      die('plan already in execution; use invalidate instead of re-planning');
    }
    const file = resolve(planFile || '');
    if (!planFile || !existsSync(file)) die(`plan file not found: ${planFile}`);
    let plan;
    try {
      plan = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      die(`plan file is not valid JSON: ${e.message}`);
    }
    if (!Array.isArray(plan.nodes) || plan.nodes.length === 0) die('plan.nodes must be a non-empty array');

    const ids = new Set([REQUIREMENTS_NODE]);
    const artifacts = new Set([REQUIREMENTS_ARTIFACT]);
    const nodes = [{
      id: REQUIREMENTS_NODE,
      agent: REQUIREMENTS_NODE,
      artifact: REQUIREMENTS_ARTIFACT,
      depends_on: [],
      gate: null,
      status: 'validated',
      attempts: 1,
      retries: 0,
      artifact_sha256: s.requirements.artifact_sha256,
      stage_gate: { result: 'pass', at: s.requirements.confirmed_at },
      last_error: null,
    }];
    for (const n of plan.nodes) {
      if (!NODE_ID_RE.test(n.id || '')) die(`invalid node id: ${n.id}`);
      if (ids.has(n.id)) die(`duplicate or reserved node id: ${n.id}`);
      if (!AGENTS.includes(n.agent) || n.agent === REQUIREMENTS_NODE) die(`invalid agent for node ${n.id}: ${n.agent}`);
      if (!ARTIFACT_RE.test(n.artifact || '')) die(`invalid artifact path for node ${n.id}: ${n.artifact}`);
      if (artifacts.has(n.artifact)) die(`artifact owned by two nodes: ${n.artifact}`);
      if (n.gate && n.gate !== 'approval') die(`invalid gate for node ${n.id}: ${n.gate}`);
      ids.add(n.id);
      artifacts.add(n.artifact);
      nodes.push({
        id: n.id,
        agent: n.agent,
        artifact: n.artifact,
        depends_on: n.depends_on?.length ? [...n.depends_on] : [REQUIREMENTS_NODE],
        gate: n.gate || null,
        status: 'pending',
        attempts: 0,
        retries: 0,
        artifact_sha256: null,
        stage_gate: null,
        last_error: null,
      });
    }
    for (const n of nodes) {
      for (const d of n.depends_on) if (!ids.has(d)) die(`node ${n.id} depends on unknown node ${d}`);
    }
    assertAcyclic(nodes);
    s.plan.nodes = nodes;
    s.status = 'executing';
    saveState(s);
    console.log(`${runId}: plan set with ${nodes.length - 1} nodes (+ requirements)`);
  },

  // add-nodes <run-id> <nodes.json> -> appends new pending nodes to a plan that is already in execution
  // (e.g. the validator for a run planned before it existed). Same rules as set-plan; dependencies may
  // point at existing nodes. Existing nodes are not touched.
  'add-nodes'([runId, nodesFile]) {
    const s = loadState(runId);
    if (s.plan.nodes.length === 0) die('no plan yet; use set-plan');
    const file = resolve(nodesFile || '');
    if (!nodesFile || !existsSync(file)) die(`nodes file not found: ${nodesFile}`);
    let plan;
    try {
      plan = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      die(`nodes file is not valid JSON: ${e.message}`);
    }
    if (!Array.isArray(plan.nodes) || plan.nodes.length === 0) die('nodes must be a non-empty array');
    const ids = new Set(s.plan.nodes.map((n) => n.id));
    const artifacts = new Set(s.plan.nodes.map((n) => n.artifact));
    const added = [];
    for (const n of plan.nodes) {
      if (!NODE_ID_RE.test(n.id || '')) die(`invalid node id: ${n.id}`);
      if (ids.has(n.id)) die(`node already exists: ${n.id}`);
      if (!AGENTS.includes(n.agent) || n.agent === REQUIREMENTS_NODE) die(`invalid agent for node ${n.id}: ${n.agent}`);
      if (!ARTIFACT_RE.test(n.artifact || '')) die(`invalid artifact path for node ${n.id}: ${n.artifact}`);
      if (artifacts.has(n.artifact)) die(`artifact owned by two nodes: ${n.artifact}`);
      if (n.gate && n.gate !== 'approval') die(`invalid gate for node ${n.id}: ${n.gate}`);
      ids.add(n.id);
      artifacts.add(n.artifact);
      added.push({
        id: n.id,
        agent: n.agent,
        artifact: n.artifact,
        depends_on: n.depends_on?.length ? [...n.depends_on] : [REQUIREMENTS_NODE],
        gate: n.gate || null,
        status: 'pending',
        attempts: 0,
        retries: 0,
        artifact_sha256: null,
        stage_gate: null,
        last_error: null,
      });
    }
    for (const n of added) {
      for (const d of n.depends_on) if (!ids.has(d)) die(`node ${n.id} depends on unknown node ${d}`);
    }
    const all = [...s.plan.nodes, ...added];
    assertAcyclic(all);
    s.plan.nodes = all;
    if (['completed', 'blocked'].includes(s.status)) s.status = 'executing';
    saveState(s);
    console.log(`${runId}: added ${added.map((n) => n.id).join(', ')}`);
  },

  // reset-plan <run-id> -> drops the plan and moves produced artifacts aside (requirements are kept)
  'reset-plan'([runId]) {
    const s = loadState(runId);
    if (!s.requirements.confirmed) die('requirements are not confirmed; nothing to re-plan');
    if (s.approval.status === 'approved') die('run is approved; start a new run instead');
    const dir = join(runDir(runId), 'artifacts');
    const stamp = now().replace(/[-:.TZ]/g, '').slice(0, 14);
    const aside = join(dir, `_superseded-${stamp}`);
    const moved = [];
    for (const name of readdirSync(dir)) {
      if (name === 'requirements.md' || name.startsWith('_superseded-')) continue;
      mkdirSync(aside, { recursive: true });
      renameSync(join(dir, name), join(aside, name));
      moved.push(name);
    }
    const req = s.plan.nodes.find((n) => n.id === REQUIREMENTS_NODE);
    s.plan.nodes = req ? [req] : [];
    s.status = 'planning';
    s.domain_gates = { attempt: 0, results: [], result: null, processed_sha256: null };
    saveState(s);
    console.log(`${runId}: plan reset; moved aside: ${moved.join(', ') || 'nothing'}`);
  },

  // ready <run-id> -> actions the coordinator can take now (tab separated), last line "# <state>"
  ready([runId]) {
    const s = loadState(runId);
    const byId = new Map(s.plan.nodes.map((n) => [n.id, n]));
    const lines = [];
    for (const n of s.plan.nodes) {
      const depsOk = n.depends_on.every((d) => byId.get(d).status === 'validated');
      const gateOk = n.gate !== 'approval' || s.approval.status === 'approved';
      if (n.status === 'created') lines.push(['stage-gate', n.id, n.agent, n.artifact].join('\t'));
      else if (n.status === 'running') lines.push(['running', n.id, n.agent, n.artifact].join('\t'));
      else if (n.status === 'validated' && n.agent === 'evidence-validator'
        && s.domain_gates.processed_sha256 !== n.artifact_sha256) {
        lines.push(['domain-gates', n.id, n.agent, n.artifact].join('\t'));
      }
      else if ((n.status === 'pending' || n.status === 'stale') && depsOk && gateOk) {
        const err = (n.last_error || '').replace(/\s+/g, ' ');
        lines.push(['dispatch', n.id, n.agent, n.artifact, `attempt=${n.attempts + 1}`, err].join('\t'));
      }
    }
    const statuses = s.plan.nodes.map((n) => n.status);
    let state = 'IN_PROGRESS';
    if (statuses.includes('blocked')) state = 'BLOCKED';
    else if (statuses.length > 0 && statuses.every((x) => x === 'validated') && lines.length === 0
      && (!s.plan.nodes.some((n) => n.agent === 'evidence-validator') || s.domain_gates.result === 'pass')) {
      state = 'COMPLETE';
    }
    else if (lines.length === 0) {
      const waiting = s.plan.nodes.some((n) => n.gate === 'approval' && n.status === 'pending');
      state = waiting ? 'WAITING_APPROVAL' : 'IDLE';
    }
    for (const l of lines) console.log(l);
    console.log(`# ${state}`);
  },

  // verify <run-id> -> used once at the start of a resume. Re-checks validated artifacts against disk and
  // handles nodes left `running` by an interrupted session: artifact on disk -> `created` (stage gate runs),
  // otherwise -> `stale` (re-dispatched). Never call it while subagents of the live session are still running.
  verify([runId]) {
    const s = loadState(runId);
    const changed = [];
    const markDownstream = (n, problem) => {
      for (const d of dependentsOf(s, n.id)) {
        if (['created', 'validated', 'running'].includes(d.status)) {
          markStale(d, `upstream ${n.id}: ${problem}`);
          changed.push(d.id);
        }
      }
    };
    for (const n of s.plan.nodes) {
      if (n.id === REQUIREMENTS_NODE) continue;
      const abs = join(runDir(runId), n.artifact);
      if (n.status === 'running') {
        // An artifact left by an EARLIER attempt (before the node was started again) must not be taken for
        // the result of the interrupted one: accept the file only if it is newer than the recorded start.
        const startedMs = n.started_at ? Date.parse(n.started_at) : NaN;
        const fresh = existsSync(abs) && (Number.isNaN(startedMs) ? false : statSync(abs).mtimeMs >= startedMs);
        if (fresh) {
          n.status = 'created';
          n.artifact_sha256 = fileHash(abs);
          n.last_error = null;
          changed.push(`${n.id} (created from interrupted run)`);
        } else {
          markStale(n, 'interrupted: session ended before the artifact was written');
          changed.push(n.id);
        }
        continue;
      }
      if (n.status !== 'validated') continue;
      const problem = !existsSync(abs) ? 'artifact file is missing'
        : fileHash(abs) !== n.artifact_sha256 ? 'artifact changed after validation' : null;
      if (!problem) continue;
      markStale(n, problem);
      changed.push(n.id);
      markDownstream(n, problem);
    }
    if (changed.length) saveState(s);
    console.log(changed.length ? `${runId}: updated -> ${[...new Set(changed)].join(', ')}` : `${runId}: all artifacts intact, nothing interrupted`);
  },

  // domain-gates <run-id> -> applies the results of validation.md: PASS records it, FAIL rows are mapped to
  // their owner nodes (retry counted, downstream invalidated). Run after the validator node is validated.
  'domain-gates'([runId]) {
    const s = loadState(runId);
    const vnode = s.plan.nodes.find((n) => n.agent === 'evidence-validator');
    if (!vnode) die('plan has no evidence-validator node');
    if (vnode.status !== 'validated') die(`${vnode.id} is ${vnode.status}, expected validated`);
    const abs = join(runDir(runId), vnode.artifact);
    if (fileHash(abs) !== vnode.artifact_sha256) die(`${vnode.artifact} changed after validation`);
    const rows = readFileSync(abs, 'utf8').split('\n').filter((l) => l.trim().startsWith('|'))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
      .filter((c) => c.length >= 6 && /^G[1-7]$/.test(c[0]))
      .map(([gate, status, artifact, node, finding, fix]) => ({ gate, status, artifact, node, finding, fix }));
    const have = new Set(rows.map((r) => r.gate));
    for (const g of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']) if (!have.has(g)) die(`gate ${g} has no row`);

    s.domain_gates.attempt = (s.domain_gates.attempt || 0) + 1;
    s.domain_gates.results = rows;
    s.domain_gates.processed_sha256 = vnode.artifact_sha256;
    const fails = rows.filter((r) => r.status === 'FAIL');
    if (fails.length === 0) {
      s.domain_gates.result = 'pass';
      saveState(s);
      console.log(`domain gates: PASS (attempt ${s.domain_gates.attempt})`);
      return;
    }
    s.domain_gates.result = 'fail';
    const byNode = new Map();
    for (const r of fails) {
      if (!byNode.has(r.node)) byNode.set(r.node, []);
      byNode.get(r.node).push(`[${r.gate}] ${r.finding} | fix: ${r.fix}`);
    }
    console.log(`domain gates: FAIL (attempt ${s.domain_gates.attempt}), ${fails.length} finding(s)`);
    for (const [nodeId, items] of byNode) {
      const node = s.plan.nodes.find((n) => n.id === nodeId);
      if (!node || node.id === REQUIREMENTS_NODE) {
        console.log(`ASK_MASTER\t${nodeId}\t${items.join(' ')}`);
        continue;
      }
      if (!['created', 'validated'].includes(node.status)) continue;
      console.log(failNode(s, node, items.join(' ')));
    }
    saveState(s);
  },

  // start <run-id> <node-id>
  start([runId, nodeId]) {
    const s = loadState(runId);
    const node = getNode(s, nodeId);
    const byId = new Map(s.plan.nodes.map((n) => [n.id, n]));
    if (!['pending', 'stale', 'running'].includes(node.status)) die(`${nodeId} cannot start from status ${node.status}`);
    const notReady = node.depends_on.filter((d) => byId.get(d).status !== 'validated');
    if (notReady.length) die(`${nodeId} has unvalidated dependencies: ${notReady.join(', ')}`);
    if (node.gate === 'approval' && s.approval.status !== 'approved') die(`${nodeId} requires approval`);
    node.status = 'running';
    node.attempts += 1;
    node.started_at = now();
    saveState(s);
    console.log(`${nodeId}: running (attempt ${node.attempts})`);
  },

  // artifact-written <path> -> records the artifact hash for the owning node. Idempotent; silent for unknown files.
  'artifact-written'([path]) {
    if (!path) die('usage: artifact-written <path>');
    const abs = resolve(path);
    const rel = relative(WORKFLOWS, abs).split(sep);
    if (rel[0] === '..' || rel.length < 3 || !RUN_ID_RE.test(rel[0])) return;
    const runId = rel[0];
    if (!existsSync(statePath(runId))) return;
    const artifact = rel.slice(1).join('/');
    if (!ARTIFACT_RE.test(artifact) || !existsSync(abs)) return;
    const s = loadState(runId);
    const hash = fileHash(abs);

    if (artifact === REQUIREMENTS_ARTIFACT) {
      if (s.requirements.confirmed && s.requirements.artifact_sha256 !== hash) {
        s.requirements.confirmed = false;
        s.status = 'requirements';
        for (const n of s.plan.nodes) {
          if (n.id !== REQUIREMENTS_NODE && n.status !== 'pending') markStale(n, 'requirements changed after confirmation');
        }
        const req = s.plan.nodes.find((n) => n.id === REQUIREMENTS_NODE);
        if (req) markStale(req, 'requirements changed after confirmation');
        saveState(s);
        console.log(`${runId}: requirements changed after confirmation; re-confirmation required, plan invalidated`);
      }
      return;
    }

    const node = s.plan.nodes.find((n) => n.artifact === artifact);
    if (!node) return;
    if (node.artifact_sha256 === hash && ['created', 'validated'].includes(node.status)) return;
    if (node.status === 'validated') {
      markStale(node, 'artifact modified after validation');
      for (const d of dependentsOf(s, node.id)) {
        if (['created', 'validated', 'running'].includes(d.status)) markStale(d, `upstream ${node.id} changed`);
      }
      node.artifact_sha256 = hash;
      saveState(s);
      console.log(`${node.id}: modified after validation; node and dependents marked stale`);
      return;
    }
    node.status = 'created';
    node.artifact_sha256 = hash;
    node.last_error = null;
    saveState(s);
    console.log(`${node.id}: created (${hash.slice(0, 8)})`);
  },

  // stage-gate <run-id> <node-id> pass|fail [findings...]
  'stage-gate'([runId, nodeId, result, ...findings]) {
    if (!['pass', 'fail'].includes(result)) die('result must be pass or fail');
    const s = loadState(runId);
    const node = getNode(s, nodeId);
    if (result === 'pass') {
      if (node.status !== 'created') die(`${nodeId} is ${node.status}, expected created`);
      const abs = join(runDir(runId), node.artifact);
      if (!existsSync(abs)) die(`artifact missing: ${node.artifact}`);
      if (fileHash(abs) !== node.artifact_sha256) die(`${node.artifact} changed since artifact-written; run artifact-written again`);
      node.status = 'validated';
      node.stage_gate = { result: 'pass', at: now() };
      node.last_error = null;
      saveState(s);
      console.log(`${nodeId}: validated`);
      return;
    }
    if (!['created', 'running'].includes(node.status)) die(`${nodeId} is ${node.status}, cannot fail the gate`);
    const message = failNode(s, node, findings.join(' ') || 'stage gate failed');
    saveState(s);
    console.log(message);
  },

  // fail <run-id> <node-id> <finding...> -> domain-gate failure; counts a retry and cascades to dependents
  fail([runId, nodeId, ...finding]) {
    const s = loadState(runId);
    const node = getNode(s, nodeId);
    if (node.id === REQUIREMENTS_NODE) die('requirements failures are handled by re-running the Q&A loop');
    if (!['created', 'validated'].includes(node.status)) die(`${nodeId} is ${node.status}, cannot fail`);
    const message = failNode(s, node, finding.join(' ') || 'domain gate failed');
    saveState(s);
    console.log(message);
  },

  // invalidate <run-id> <node-id> [--cascade] [--reason <text...>] -> revision; does not consume retries
  invalidate([runId, nodeId, ...rest]) {
    const s = loadState(runId);
    const node = getNode(s, nodeId);
    const cascade = rest.includes('--cascade');
    const reasonIdx = rest.indexOf('--reason');
    const reason = reasonIdx >= 0 ? rest.slice(reasonIdx + 1).join(' ') : 'invalidated';
    markStale(node, reason);
    const touched = [node.id];
    if (cascade) {
      for (const d of dependentsOf(s, node.id)) {
        if (d.status !== 'pending') {
          markStale(d, `upstream ${node.id} invalidated`);
          touched.push(d.id);
        }
      }
    }
    if (s.status === 'blocked' || s.status === 'completed') s.status = 'executing';
    saveState(s);
    console.log(`${runId}: stale -> ${touched.join(', ')}`);
  },

  // unblock <run-id> <node-id> -> resets a blocked node and its skipped dependents after the cause is fixed
  unblock([runId, nodeId]) {
    const s = loadState(runId);
    const node = getNode(s, nodeId);
    if (node.status !== 'blocked') die(`${nodeId} is ${node.status}, not blocked`);
    node.status = 'stale';
    node.retries = 0;
    for (const d of dependentsOf(s, node.id)) if (d.status === 'skipped') d.status = 'pending';
    if (!s.plan.nodes.some((n) => n.status === 'blocked')) s.status = 'executing';
    saveState(s);
    console.log(`${nodeId}: unblocked`);
  },

  // set-type <run-id> <workflow-type>
  'set-type'([runId, type]) {
    if (!WORKFLOW_TYPES.includes(type)) die(`workflow type must be one of: ${WORKFLOW_TYPES.join(', ')}`);
    const s = loadState(runId);
    s.workflow_type = type;
    saveState(s);
    console.log(`${runId}: workflow_type=${type}`);
  },

  // set-status <run-id> <status>
  'set-status'([runId, status]) {
    if (!RUN_STATUSES.includes(status)) die(`unknown status: ${status}`);
    const s = loadState(runId);
    s.status = status;
    saveState(s);
    console.log(`${runId}: status=${status}`);
  },

  // summary <run-id> -> human-readable overview of the run
  summary([runId]) {
    const s = loadState(runId);
    console.log(`run: ${s.run_id}`);
    console.log(`status: ${s.status}   type: ${s.workflow_type ?? '-'}   requirements confirmed: ${s.requirements.confirmed}`);
    console.log(`approval: ${s.approval.status} (round ${s.approval.round})   max retries: ${s.config.max_retries}`);
    for (const n of s.plan.nodes) {
      const err = n.last_error ? `   ! ${n.last_error}` : '';
      console.log(`  ${n.id.padEnd(28)} ${n.status.padEnd(10)} attempts=${n.attempts} retries=${n.retries}  ${n.artifact}${err}`);
    }
  },

  // list-unfinished -> one line per unfinished run: <run-id> <status> <type>
  'list-unfinished'() {
    if (!existsSync(WORKFLOWS)) return;
    for (const name of readdirSync(WORKFLOWS).sort()) {
      if (!RUN_ID_RE.test(name) || !existsSync(statePath(name))) continue;
      const s = loadState(name);
      if (s.status !== 'completed') console.log(`${s.run_id}\t${s.status}\t${s.workflow_type ?? '-'}`);
    }
  },

  help() {
    console.log(usage());
  },
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !commands[cmd]) die(`unknown command${cmd ? `: ${cmd}` : ''}. ${usage()}`);
commands[cmd](rest);
