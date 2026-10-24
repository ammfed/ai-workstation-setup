// Tests for the model defaults the template writes: the per-model effort in Claude Code
// settings, the read-only reader subagent, the no-mistakes review model, the example
// Firstmate dispatch profiles and second mates, backpass, and the research model in the
// working preferences.
// Invented values only; a temporary folder stands in for the home.
// Run: node --test test/models.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Context, detectPlatform } from '../lib/context.mjs';
import agentClis, { NO_MISTAKES_REVIEW, REVIEW_RULE_PATHS, REVIEW_RULES, REVIEW_RULES_SINCE, noMistakesConfigPath, noMistakesVersion, parseReviewModel, readsGlobalReview, reviewRulesBlock, withClaudeReviewModel, withReviewRules, writeReviewRules } from '../modules/agent-clis/module.mjs';
import claudeCode, { installReaderAgent, parseModelEfforts } from '../modules/claude-code/module.mjs';
import backpass, { claudeModelId } from '../modules/backpass/module.mjs';
import firstmate, { dispatchProfiles, secondmateDefault } from '../modules/firstmate/module.mjs';
import preferences from '../modules/preferences/module.mjs';
import { renderPreferences } from '../modules/preferences/render.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function context(home, { answers = {}, dryRun = false } = {}) {
  const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun, interactive: false, answers: new Map(Object.entries(answers)), prompter: null, repoRoot });
  ctx.beginModule('test');
  return ctx;
}

const question = (mod, key) => mod.questions.find((q) => q.key === key);

// A context whose `no-mistakes --version` prints `version`, or fails when it is null (not installed).
function withNoMistakes(ctx, version) {
  ctx.capture = (cmd) => (cmd === 'no-mistakes --version' && version ? `no-mistakes version ${version} (4822244) 2026-09-26T08:30:42Z` : null);
  return ctx;
}

test('Claude Code settings default Opus 5.5 to medium effort, and the question stays', () => {
  const q = question(claudeCode, 'CLAUDE_MODEL_EFFORTS');
  assert.equal(q.default, 'claude-opus-5-5=medium');
  assert.deepEqual(parseModelEfforts(q.default), { 'claude-opus-5-5': 'medium' });
  assert.deepEqual(parseModelEfforts(''), {});
});

test('Claude Code starts on Opus at medium effort, and a saved keep still wins', async () => {
  const ask = async (answers) => {
    const ctx = context(os.tmpdir(), { answers, dryRun: true });
    for (const key of ['CLAUDE_MODEL', 'CLAUDE_EFFORT', 'CLAUDE_MODEL_EFFORTS']) await ctx.ask(question(claudeCode, key));
    return ['CLAUDE_MODEL', 'CLAUDE_EFFORT', 'CLAUDE_MODEL_EFFORTS'].map((key) => ctx.get(key));
  };
  assert.deepEqual(await ask({}), ['opus', 'medium', 'claude-opus-5-5=medium']);
  assert.deepEqual(await ask({ CLAUDE_MODEL: 'keep', CLAUDE_EFFORT: 'keep', CLAUDE_MODEL_EFFORTS: '' }), ['keep', 'keep', '']);
  assert.match(question(claudeCode, 'CLAUDE_EFFORT').message, /older models; Opus 5\.5 has its own level/);
});

test('the reader subagent runs on Haiku, read-only, and lands in the Claude agents folder', async () => {
  const shipped = fs.readFileSync(path.join(repoRoot, 'templates', 'claude-code', 'agents', 'reader.md'), 'utf8');
  assert.match(shipped, /^---\nname: reader\n/);
  assert.match(shipped, /\nmodel: haiku\n/);
  assert.match(shipped, /\ntools: Read, Bash, WebFetch, WebSearch\n/);
  assert.equal(question(claudeCode, 'CLAUDE_READER_AGENT').default, true);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'models-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    await installReaderAgent(context(home));
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'agents', 'reader.md'), 'utf8'), shipped);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test('a reader subagent the person wrote is kept', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'models-'));
  const own = path.join(home, '.claude', 'agents', 'reader.md');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, '---\nname: reader\nmodel: sonnet\n---\nMy own reader.\n');
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    await installReaderAgent(context(home));
    assert.equal(fs.readFileSync(own, 'utf8'), '---\nname: reader\nmodel: sonnet\n---\nMy own reader.\n');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test('the review model defaults to Opus 5.5 at medium effort, and parses model and effort', () => {
  assert.equal(NO_MISTAKES_REVIEW, 'claude-opus-5-5 medium');
  assert.deepEqual(parseReviewModel('claude-opus-5-5 medium'), { model: 'claude-opus-5-5', effort: 'medium' });
  assert.deepEqual(parseReviewModel('  sonnet  '), { model: 'sonnet' });
  assert.equal(parseReviewModel(''), null);
  assert.equal(parseReviewModel('keep'), null);
  assert.throws(() => parseReviewModel('claude-opus-5-5 turbo'), /NO_MISTAKES_REVIEW_MODEL/);
  assert.throws(() => parseReviewModel('a b c'), /NO_MISTAKES_REVIEW_MODEL/);
});

test('the review model goes into agent_config.claude without touching the rest of the config', () => {
  const pin = { model: 'claude-opus-5-5', effort: 'medium' };
  const block = 'agent_config:\n  claude:\n    model: claude-opus-5-5\n    effort: medium\n';
  assert.equal(withClaudeReviewModel('', pin), block);
  assert.equal(withClaudeReviewModel('agent: auto\nlog_level: info', pin), `agent: auto\nlog_level: info\n\n${block}`);
  assert.equal(
    withClaudeReviewModel('agent: auto\nagent_config:  # per harness\n  codex:\n    model: sample-model\nlog_level: info\n', pin),
    'agent: auto\nagent_config:  # per harness\n  claude:\n    model: claude-opus-5-5\n    effort: medium\n  codex:\n    model: sample-model\nlog_level: info\n',
  );
  assert.equal(withClaudeReviewModel('agent_config:\n  codex:\n    model: m\n', { model: 'sonnet' }), 'agent_config:\n  claude:\n    model: sonnet\n  codex:\n    model: m\n');
});

test('an existing claude entry or an agent_config the template cannot edit is left alone', () => {
  const pin = { model: 'claude-opus-5-5', effort: 'medium' };
  assert.equal(withClaudeReviewModel('agent_config:\n  claude:\n    model: sonnet\n', pin), null);
  assert.equal(withClaudeReviewModel('agent_config:\n  codex: {}\n  "claude":\n    effort: high\n', pin), null);
  assert.equal(withClaudeReviewModel('agent_config: {}\n', pin), null);
  assert.equal(withClaudeReviewModel('agent_config: { claude: { model: sonnet } }\n', pin), null);
});

test('the design review rules go into an empty config and beside other keys, once per interface path', () => {
  const block = reviewRulesBlock(REVIEW_RULES);
  assert.equal(withReviewRules('', REVIEW_RULES), `${block}\n`);
  assert.equal(withReviewRules('agent: auto\nlog_level: info\n', REVIEW_RULES), `agent: auto\nlog_level: info\n\n${block}\n`);
  assert.match(block, /^review:\n  path_instructions:\n    - path: "\*\.html"\n      instructions: \|\n        Interface code:/m);
  assert.equal(block.match(/- path: /g).length, REVIEW_RULE_PATHS.length);
  for (const p of REVIEW_RULE_PATHS) assert.ok(!p.includes('/'), `${p} matches by file name at any depth`);
  for (const id of ['W4', 'L3', 'L9', 'N1', 'I1', 'I2', 'I3', 'I4', 'I5']) assert.match(block, new RegExp(`${id}: `));
  // no-mistakes takes at most 32 entries and 16,384 bytes of injected rules, shared with each repository's own.
  assert.ok(REVIEW_RULE_PATHS.length * (Buffer.byteLength(REVIEW_RULES.join('\n')) + 400) < 16384 / 2);
});

test('a config with its own review: key is left alone, and a second run gives the same file', () => {
  assert.equal(withReviewRules('review:\n  path_instructions:\n    - path: "*.go"\n      instructions: mine\n', REVIEW_RULES), null);
  assert.equal(withReviewRules('agent: auto\nreview: {}\n', REVIEW_RULES), null);
  const once = withReviewRules('agent: auto\n', REVIEW_RULES);
  assert.equal(withReviewRules(once, REVIEW_RULES), once);
  const more = withReviewRules(once, [...REVIEW_RULES, 'Dates are written as 22 Oct.']);
  assert.match(more, /^        Dates are written as 22 Oct\.$/m);
  assert.equal(more.match(/^review:/gm).length, 1);
  assert.equal(withReviewRules(more, []), 'agent: auto\n');
  assert.equal(withReviewRules('agent: auto\n', []), 'agent: auto\n');
});

test('the design review rules are asked with no-mistakes, default yes, and take your Reviewer lines', async () => {
  const q = question(agentClis, 'NO_MISTAKES_PRINCIPLES');
  assert.equal(q.type, 'confirm');
  assert.equal(q.default, true);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'models-'));
  const saved = process.env.NM_HOME;
  process.env.NM_HOME = path.join(home, '.nm');
  fs.mkdirSync(process.env.NM_HOME);
  const file = path.join(home, '.nm', 'config.yaml');
  fs.writeFileSync(file, 'agent: auto\n');
  const rules = path.join(home, 'private-rules.md');
  fs.writeFileSync(rules, '## Reviewer\n\n- Every chart has a plain title.\n\n## Sessions\n\n- Not for the reviewer.\n');
  const run = async (on) => {
    // PREFS_PRIVATE_RULES comes from the saved answers when preferences is not in this run.
    await writeReviewRules(withNoMistakes(context(home, { answers: { PREFS_PRIVATE_RULES: rules } }), 'v1.99.0'), on);
    return fs.readFileSync(file, 'utf8');
  };
  try {
    const first = await run(true);
    assert.match(first, /^agent: auto\n\n# >>> /);
    assert.match(first, /^        Every chart has a plain title\.$/m);
    assert.doesNotMatch(first, /Not for the reviewer/);
    assert.equal(await run(true), first);
    assert.equal(await run(false), 'agent: auto\n');
  } finally {
    if (saved === undefined) delete process.env.NM_HOME;
    else process.env.NM_HOME = saved;
  }
});

test('no-mistakes reads a global review: block from v1.89.0, the first release with it', () => {
  assert.deepEqual(REVIEW_RULES_SINCE, [1, 89, 0]);
  assert.deepEqual(noMistakesVersion(withNoMistakes(context(os.tmpdir()), 'v1.84.0')), [1, 84, 0]);
  assert.equal(noMistakesVersion(withNoMistakes(context(os.tmpdir()), null)), null);
  for (const v of [[1, 89, 0], [1, 89, 3], [1, 100, 1], [2, 0, 0]]) assert.equal(readsGlobalReview(v), true, v.join('.'));
  for (const v of [[1, 84, 0], [1, 88, 9], [0, 99, 0], null]) assert.equal(readsGlobalReview(v), false, String(v));
});

test('the design review rules follow what the installed no-mistakes can read, and the config always parses', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'models-'));
  const saved = process.env.NM_HOME;
  process.env.NM_HOME = path.join(home, '.nm');
  fs.mkdirSync(process.env.NM_HOME);
  const file = path.join(home, '.nm', 'config.yaml');
  const run = async (version, start, { dryRun = false } = {}) => {
    if (start === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, start);
    const ctx = withNoMistakes(context(home, { dryRun }), version);
    const said = [];
    ctx.say = (line) => said.push(line);
    await writeReviewRules(ctx, true);
    return { text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, said: said.join('\n') };
  };
  const block = reviewRulesBlock(REVIEW_RULES);
  const commented = block.split('\n').map((l) => `# ${l}`).join('\n');
  try {
    // A version that reads it gets the block; one that does not, and no install at all, get none.
    assert.equal((await run('v1.89.0', 'agent: auto\n')).text, `agent: auto\n\n${block}\n`);
    const old = await run('v1.84.0', 'agent: auto\n');
    assert.equal(old.text, 'agent: auto\n');
    assert.match(old.said, /v1\.84\.0 cannot read design review rules/);
    assert.match((await run(null, 'agent: auto\n')).said, /not installed yet/);
    assert.equal((await run(null, null)).text, null);
    // A dry run without no-mistakes writes nothing.
    assert.equal((await run(null, null, { dryRun: true })).text, null);

    // An active block written earlier comes out on an old version, and the rest stays; a backup is kept.
    const active = `agent: auto\n\n${block}\n\nlog_level: info\n`;
    assert.equal((await run('v1.84.0', active)).text, 'agent: auto\n\nlog_level: info\n');
    assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f !== 'config.yaml' && f.startsWith('config.yaml')), 'a backup of the config is kept');
    // A block commented out by hand also comes out cleanly, and a version that reads it gets it back active.
    assert.equal((await run('v1.84.0', `agent: auto\n\n${commented}\n`)).text, 'agent: auto\n');
    const back = (await run('v1.99.0', `agent: auto\n\n${commented}\n\nlog_level: info\n`)).text;
    assert.equal(back, `agent: auto\n\nlog_level: info\n\n${block}\n`);
    assert.equal(back.match(/^review:/gm).length, 1);
    assert.doesNotMatch(back, /^# (#|review|  )/m);

    // Your own review: key is never touched; on an old version you are told it will not parse.
    const mine = 'review:\n  path_instructions:\n    - path: "*.go"\n      instructions: mine\n';
    const kept = await run('v1.84.0', mine);
    assert.equal(kept.text, mine);
    assert.match(kept.said, /refuses to start with/);
  } finally {
    if (saved === undefined) delete process.env.NM_HOME;
    else process.env.NM_HOME = saved;
  }
});

test('the no-mistakes config lives in NM_HOME when set, else ~/.no-mistakes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'models-'));
  const saved = process.env.NM_HOME;
  try {
    delete process.env.NM_HOME;
    assert.equal(noMistakesConfigPath(context(home)), path.join(home, '.no-mistakes', 'config.yaml'));
    process.env.NM_HOME = path.join(home, 'elsewhere');
    assert.equal(noMistakesConfigPath(context(home)), path.join(home, 'elsewhere', 'config.yaml'));
  } finally {
    if (saved === undefined) delete process.env.NM_HOME;
    else process.env.NM_HOME = saved;
  }
});

test('the example dispatch profiles: Opus medium default, Opus xhigh for a new look, Opus high for polish, investigations, plans and research, Sonnet high for small tasks, no Fable', () => {
  assert.equal(question(firstmate, 'FIRSTMATE_DISPATCH').default, 'capable');
  const capable = dispatchProfiles('capable', 'claude');
  assert.deepEqual(capable.default, [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium' }]);
  const rule = (re) => capable.rules.find((r) => re.test(r.when));
  const look = rule(/new look/);
  assert.deepEqual(look.use, [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'xhigh' }]);
  assert.match(look.when, /not yet settled/);
  const polish = rule(/polishes/);
  assert.deepEqual(polish.use, [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'high' }]);
  assert.match(polish.when, /look is already settled/);
  assert.match(polish.when, /spacing, copy, states, small layout fixes, or fixes from a usability check/);
  const thinking = rule(/investigat/);
  assert.deepEqual(thinking.use, [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'high' }]);
  assert.match(thinking.when, /diagnos/);
  assert.match(thinking.when, /plan/);
  assert.match(thinking.why, /re-run the same task at extra-high effort when the result is weak or the cause is hard to find/);
  assert.match(thinking.why, /fix or build at medium effort once the cause is proven or the plan is settled/);
  assert.deepEqual(rule(/researches/).use, [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'high' }]);
  const research = rule(/researches/).why;
  assert.match(research, /plans and checks/);
  assert.match(research, /bulk fetching to agy with gemini-3\.8-flash-high/);
  assert.match(research, /claude-sonnet-4-6 on a Gemini quota error/);
  assert.match(research, /reading and summaries to the reader subagent/);
  assert.match(research, /drafting to Sonnet 5\.5 at high effort/);
  const small = rule(/small, well-defined task/);
  assert.deepEqual(small.use, [{ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'high' }]);
  assert.match(small.why, /re-run on Opus 5\.5 at medium effort/);
  assert.doesNotMatch(JSON.stringify(capable), /fable/i);
  assert.deepEqual(dispatchProfiles('capable', 'codex').default, [{ harness: 'codex', effort: 'medium' }]);
});

test('agy research runs on gemini-3.8-flash-high by default', async () => {
  const ctx = context(os.tmpdir(), { answers: { PREFS_DELEGATE_RETRIEVAL: 'agy' }, dryRun: true });
  for (const q of preferences.questions) {
    if (q.when && !q.when(ctx)) continue;
    await ctx.ask(q);
  }
  assert.equal(ctx.get('PREFS_DELEGATE_MODEL'), 'gemini-3.8-flash-high');
  assert.equal(ctx.get('PREFS_DELEGATE_FALLBACK_MODEL'), 'claude-sonnet-4-6');
  const text = renderPreferences((key) => ctx.get(key), { cardsPath: path.join(os.tmpdir(), 'cards.html') });
  assert.match(text, /to `agy --model gemini-3\.8-flash-high`/);
  assert.match(text, /If it reports a Gemini quota error, use `agy --model claude-sonnet-4-6` instead\./);

  const other = context(os.tmpdir(), { answers: { PREFS_DELEGATE_RETRIEVAL: 'other-cli' }, dryRun: true });
  for (const q of preferences.questions) {
    if (q.when && !q.when(other)) continue;
    await other.ask(q);
  }
  assert.equal(other.get('PREFS_DELEGATE_MODEL'), '');
  assert.equal(other.get('PREFS_DELEGATE_FALLBACK_MODEL'), undefined);
  assert.doesNotMatch(renderPreferences((key) => other.get(key), { cardsPath: path.join(os.tmpdir(), 'cards.html') }), /quota error/);
  assert.match(renderPreferences((key) => other.get(key), { cardsPath: path.join(os.tmpdir(), 'cards.html') }), /to `other-cli`/);
});

test('second mates run on Opus 5.5 at medium with the capable profiles on Claude, else the harness default', async () => {
  assert.equal(secondmateDefault('capable', 'claude'), 'claude claude-opus-5-5 medium');
  assert.equal(secondmateDefault('capable', 'codex'), 'default');
  assert.equal(secondmateDefault('starter', 'claude'), 'default');
  assert.equal(secondmateDefault('none', undefined), 'default');
  // Asked after the dispatch questions, so its default can follow them.
  const keys = firstmate.questions.map((q) => q.key);
  assert.ok(keys.indexOf('FIRSTMATE_SECONDMATE_HARNESS') > keys.indexOf('FIRSTMATE_DISPATCH_HARNESS'));
  const ask = async (answers) => {
    const ctx = context(os.tmpdir(), { answers, dryRun: true });
    for (const key of ['FIRSTMATE_DISPATCH', 'FIRSTMATE_DISPATCH_HARNESS', 'FIRSTMATE_SECONDMATE_HARNESS']) {
      const q = question(firstmate, key);
      if (!q.when || q.when(ctx)) await ctx.ask(q);
    }
    return ctx.get('FIRSTMATE_SECONDMATE_HARNESS');
  };
  assert.equal(await ask({}), 'claude claude-opus-5-5 medium');
  assert.equal(await ask({ FIRSTMATE_DISPATCH: 'none' }), 'default');
  assert.equal(await ask({ FIRSTMATE_SECONDMATE_HARNESS: 'default' }), 'default');
});

test('backpass defaults to Opus 5.5 and reads a dotted Claude id as the dashed one', async () => {
  const ask = async (answers) => {
    const ctx = context(os.tmpdir(), { answers, dryRun: true });
    for (const key of ['BACKPASS_AGENT', 'BACKPASS_MODEL']) await ctx.ask(question(backpass, key));
    return ctx.get('BACKPASS_MODEL');
  };
  assert.equal(await ask({}), 'claude-opus-5-5');
  assert.equal(await ask({ BACKPASS_AGENT: 'codex' }), 'gpt-5.5');
  assert.equal(claudeModelId('claude-opus-5.5'), 'claude-opus-5-5');
  assert.equal(claudeModelId(' claude-sonnet-4.6 '), 'claude-sonnet-4-6');
  assert.equal(claudeModelId('claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(claudeModelId('gpt-5.5'), 'gpt-5.5');
});

test('the model map lists the installer defaults and sends small tasks to Sonnet 5.5 at high only', () => {
  const map = fs.readFileSync(path.join(repoRoot, 'docs', 'model-map.md'), 'utf8');
  assert.match(map, /\| claude-code \| `CLAUDE_MODEL` \| `opus` \(Opus 5\.5\) \|/);
  assert.match(map, /\| claude-code \| `CLAUDE_EFFORT` \| `medium` \|/);
  assert.match(map, /\| firstmate \| `FIRSTMATE_SECONDMATE_HARNESS` \| `claude claude-opus-5-5 medium`/);
  assert.match(map, /\| backpass \| `BACKPASS_MODEL` \| `claude-opus-5-5`/);
  assert.doesNotMatch(map, /\| Sonnet 5\.5 \| medium \|/);
  assert.match(map, /version bump, config value\) \| Sonnet 5\.5 \| high \|/);
});

test('the workflow-playbook skill routes models and waits at a review page the way the shipped preferences do', () => {
  const skill = fs.readFileSync(path.join(repoRoot, 'templates', 'skills', 'workflow-playbook', 'SKILL.md'), 'utf8');
  const routing = skill.slice(skill.indexOf('**Match the model to the job.**'), skill.indexOf('2. **One complete brief.**'));
  const row = (job) => routing.split('\n').map((l) => l.trim()).find((l) => l.startsWith(`| ${job}`)) || '';
  assert.match(row('Building'), /strongest model at medium effort/);
  assert.match(row('Research, investigations'), /strongest model at high effort.*highest effort when the result is weak/);
  assert.match(row('A new look'), /highest effort/);
  assert.match(row('Polish'), /strongest model at high effort/);
  assert.match(row('Small, clear tasks'), /faster model at high effort.*failed check, re-run it on the strongest model at medium effort/);
  assert.match(routing, /above these only when the owner names it/);

  const rules = renderPreferences((k) => ({ PREFS_MODEL_ROUTING: 'capable' })[k]);
  assert.match(rules, /polish of a prototype whose look is already settled[^\n]*high effort/);
  assert.match(rules, /small, clear tasks[^\n]*faster model at high effort, and re-run it on the most capable model at medium effort after a failed check/);

  const wait = skill.slice(skill.indexOf('2. **Never leave the next step empty'), skill.indexOf('3. **End every reply'));
  assert.match(wait, /stands by quietly for that answer: it does not prepare the next stage/);
  assert.match(wait, /owner's preference[^.]*, and the recommended answer is no/);
  const prepare = preferences.questions.find((q) => q.key === 'PREFS_PAGE_PREPARE_NEXT');
  assert.equal(prepare.default, false, 'the setup also waits by default');
});
