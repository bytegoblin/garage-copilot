// Contract tests for the prompt-level pieces that cannot be unit-tested by behaviour: they check that the
// documents that must agree with each other still do.
// Run: node --test scripts/test/contracts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const CONFIG = JSON.parse(read('config/workflow.json'));
const COORDINATOR = read('.claude/commands/garage.md');
const PLAYBOOKS = Object.values(CONFIG.playbooks);

test('every configured playbook exists with the sections the workflow relies on', () => {
  assert.ok(PLAYBOOKS.length >= 2);
  for (const name of PLAYBOOKS) {
    const f = `.claude/skills/${name}/SKILL.md`;
    assert.ok(existsSync(join(ROOT, f)), `${f} is missing`);
    const text = read(f);
    assert.match(text, /^name: /m, `${name}: frontmatter name`);
    for (const h of ['## Questions for the master (requirements stage)', '## Recommended research split', '## Question checklist']) {
      assert.ok(text.includes(h), `${name}: missing "${h}"`);
    }
    // The research split table must give slugs usable in node ids and artifact names.
    const split = text.split('## Recommended research split')[1].split('\n## ')[0];
    const slugs = [...split.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].map((m) => m[1]);
    assert.ok(slugs.length >= 2, `${name}: research split has no slugs`);
    assert.ok(slugs.includes('safety'), `${name}: the split must include a safety topic`);
  }
});

test('the coordinator knows every playbook, chooses it before requirements and has a small-project path', () => {
  for (const name of PLAYBOOKS) assert.ok(COORDINATOR.includes(name), `garage.md does not mention ${name}`);
  const phase2 = COORDINATOR.split('## Phase 2')[1].split('## Phase 3')[0];
  assert.match(phase2, /trade playbook/i);
  assert.match(phase2, /`playbook` name/);
  assert.match(COORDINATOR, /\*\*small\*\* `project-plan`/);
  assert.match(COORDINATOR, /\*\*regular\*\* `project-plan`/);
});

test('the requirements agent reads the playbook questions', () => {
  const agent = read('.claude/agents/requirements-formalizer.md');
  assert.match(agent, /`playbook`/);
  assert.match(agent, /Questions for the master/);
});

test('every agent file has a name equal to its file name and an English-only frontmatter description', () => {
  for (const f of readdirSync(join(ROOT, '.claude/agents'))) {
    const t = read(`.claude/agents/${f}`);
    assert.equal(t.match(/^name: (.+)$/m)?.[1], f.replace(/\.md$/, ''), f);
    assert.ok(!/[А-Яа-я]/.test(t.match(/^description: (.+)$/m)?.[1] || ''), `${f}: description must be English`);
  }
});

test('the small-project graph and the regular carpentry graph are accepted by the state machine', () => {
  const wf = mkdtempSync(join(tmpdir(), 'garage-contracts-'));
  const env = { ...process.env, GARAGE_WORKFLOWS_DIR: wf };
  const state = (...a) => spawnSync('node', [join(ROOT, 'scripts', 'state.mjs'), ...a], { env, encoding: 'utf8' });
  try {
    const graphs = {
      small: [
        { id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md' },
        { id: 'project-planner', agent: 'project-planner', artifact: 'artifacts/project-plan.md', depends_on: ['diy-researcher'] },
        { id: 'product-researcher', agent: 'product-researcher', artifact: 'artifacts/products.md', depends_on: ['project-planner'] },
        { id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md', depends_on: ['product-researcher'] },
        { id: 'evidence-validator', agent: 'evidence-validator', artifact: 'artifacts/validation.md', depends_on: ['cost-planner'] },
        { id: 'synthesizer', agent: 'synthesizer', artifact: 'artifacts/final-plan.md', depends_on: ['evidence-validator'] },
        { id: 'final-output-builder', agent: 'final-output-builder', artifact: 'output/garage-plan.html', depends_on: ['synthesizer'], gate: 'approval' },
      ],
      regular: [
        ...['materials', 'mounting', 'safety'].map((t) => ({ id: `diy-researcher-${t}`, agent: 'diy-researcher', artifact: `artifacts/research-${t}.md` })),
        { id: 'project-planner', agent: 'project-planner', artifact: 'artifacts/project-plan.md', depends_on: ['diy-researcher-materials', 'diy-researcher-mounting', 'diy-researcher-safety'] },
        ...['materials', 'tools', 'ppe'].map((c) => ({ id: `product-researcher-${c}`, agent: 'product-researcher', artifact: `artifacts/products-${c}.md`, depends_on: ['project-planner'] })),
        { id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md', depends_on: ['product-researcher-materials', 'product-researcher-tools', 'product-researcher-ppe'] },
        { id: 'evidence-validator', agent: 'evidence-validator', artifact: 'artifacts/validation.md', depends_on: ['cost-planner'] },
      ],
    };
    for (const [name, nodes] of Object.entries(graphs)) {
      const id = state('init', `contract-${name}`).stdout.trim();
      writeFileSync(join(wf, id, 'artifacts', 'requirements.md'), '# R\n<!-- meta\nstatus: ready\nworkflow_type: project-plan\n-->\n');
      assert.equal(state('confirm-requirements', id).status, 0);
      const f = join(wf, id, 'plan.json');
      writeFileSync(f, JSON.stringify({ nodes }));
      const r = state('set-plan', id, f);
      assert.equal(r.status, 0, `${name}: ${r.stderr}`);
      assert.match(state('ready', id).stdout, /dispatch\t/);
    }
  } finally {
    rmSync(wf, { recursive: true, force: true });
  }
});

test('models are explicit: every agent and command declares one, overrides use known aliases and cannot upgrade', () => {
  const rank = { haiku: 1, sonnet: 2, opus: 3 };
  const agentModel = {};
  for (const f of readdirSync(join(ROOT, '.claude/agents'))) {
    const m = read(`.claude/agents/${f}`).match(/^model: (\S+)$/m)?.[1];
    assert.ok(rank[m], `${f}: model must be one of ${Object.keys(rank)} (got ${m})`);
    agentModel[f.replace(/\.md$/, '')] = m;
  }
  for (const f of ['garage', 'garage-approve', 'garage-reject']) {
    const fm = read(`.claude/commands/${f}.md`).split('---')[1];
    assert.match(fm, /^model: (sonnet|haiku)$/m, `${f}: the coordinator model must be pinned`);
  }
  for (const [node, model] of Object.entries(CONFIG.node_models || {})) {
    assert.ok(rank[model], `node_models.${node}: unknown model ${model}`);
    const base = Object.keys(agentModel).find((a) => node === a || node.startsWith(`${a}-`));
    assert.ok(base, `node_models.${node}: no agent matches`);
    assert.ok(rank[model] <= rank[agentModel[base]], `node_models.${node} must not be more expensive than ${base}`);
  }
  assert.match(COORDINATOR, /node_models/);
});

test('the master-facing writers use the voice skill, and it exists', () => {
  assert.ok(existsSync(join(ROOT, '.claude/skills/master-voice/SKILL.md')));
  assert.match(read('.claude/agents/synthesizer.md'), /^skills: .*master-voice/m);
  assert.match(COORDINATOR, /master-voice/);
  assert.match(read('CLAUDE.md'), /master-voice/);
});

test('token economy: composite commands, retry depth and one-line hand-backs are wired consistently', () => {
  assert.ok(CONFIG.research_depth.retry?.max_searches > 0 && CONFIG.research_depth.retry.max_searches < CONFIG.research_depth.quick.max_searches);
  for (const word of ['start-ready', 'finish-node', '`retry`']) assert.ok(COORDINATOR.includes(word), `garage.md must mention ${word}`);
  for (const a of ['diy-researcher', 'product-researcher']) {
    assert.match(read(`.claude/agents/${a}.md`), /depth: retry/, `${a} must know the retry depth`);
  }
  for (const f of readdirSync(join(ROOT, '.claude/agents'))) {
    assert.match(read(`.claude/agents/${f}`), /exactly one line/, `${f}: hand-back must be one line`);
  }
});

test('re-validation is wired: config, validator agent and coordinator agree', () => {
  assert.ok(CONFIG.validator_depth.revalidation_spot_checks < CONFIG.validator_depth.first_pass_spot_checks);
  const v = read('.claude/agents/evidence-validator.md');
  assert.match(v, /re-validation/i);
  assert.match(v, /revalidation_spot_checks/);
  assert.match(COORDINATOR, /validator_depth/);
  assert.match(COORDINATOR, /re-run since the\s+previous report/);
  assert.ok(Array.isArray(CONFIG.source_policy.local_tlds) && CONFIG.source_policy.eu_tlds.length > 20);
});

test('the hook probe command exists, is not model-invocable and names every guarded action', () => {
  const t = read('.claude/commands/garage-probe-hooks.md');
  assert.match(t, /disable-model-invocation: true/);
  for (const w of ['no-leak-guard', 'approval-gate-guard', 'memory-write-guard', 'record_purchase', 'workflow-state.json', 'garage-plan.html']) {
    assert.ok(t.includes(w), `probe must mention ${w}`);
  }
  assert.match(t, /^model: (sonnet|haiku)$/m);
});

test('onboarding: the coordinator points to the onboarding skill, which covers every profile field and the save calls', () => {
  const phase0 = COORDINATOR.split('## Phase 0')[1].split('## Resume')[0];
  assert.match(phase0, /master-onboarding\/SKILL\.md/);
  for (const f of ['name', 'city', 'country', 'currency']) assert.ok(phase0.includes('`' + f + '`'), `Phase 0 misses required field ${f}`);

  const skill = read('.claude/skills/master-onboarding/SKILL.md');
  assert.match(skill, /^name: master-onboarding$/m);
  // Every field the profile tool accepts must be handled by onboarding: asked, or defaulted.
  const server = read('mcp/workshop-memory/server.mjs');
  const tool = server.split("registerTool('update_profile'")[1].split('}, handle')[0];
  const fields = [...tool.matchAll(/^\s+([a-z_0-9]+): z\./gm)].map((m) => m[1]);
  assert.ok(fields.length >= 12, 'could not read the profile fields from server.mjs');
  for (const f of fields) assert.ok(skill.includes('`' + f + '`'), `onboarding skill does not mention profile field ${f}`);
  for (const t of ['update_profile', 'add_inventory_item', 'get_profile']) assert.ok(skill.includes(t), `skill misses ${t}`);
  assert.match(skill, /at most 3 questions per message/);
  assert.match(skill, /Save nothing until the master has seen the summary/);
  // The first message introduces the assistant: who, what for, how approval works, what is remembered.
  const intro = skill.split('## Introduction')[1].split('\n## ')[0];
  for (const w of [/who you are/, /what you do/, /approved that plan/, /what you remember/, /no internal names/]) assert.match(intro, w);
  assert.match(intro, /same message as the\s+questions of round 1/);
});
