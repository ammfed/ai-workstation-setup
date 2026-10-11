// Tests for the model defaults the template writes: the per-model effort in Claude Code
// settings, the read-only reader subagent, the no-mistakes review model, the example
// Firstmate dispatch profiles, and the research model in the working preferences.
// Invented values only; a temporary folder stands in for the home.
// Run: node --test test/models.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Context, detectPlatform } from '../lib/context.mjs';
import { NO_MISTAKES_REVIEW, noMistakesConfigPath, parseReviewModel, withClaudeReviewModel } from '../modules/agent-clis/module.mjs';
import claudeCode, { installReaderAgent, parseModelEfforts } from '../modules/claude-code/module.mjs';
import firstmate, { dispatchProfiles } from '../modules/firstmate/module.mjs';
import preferences from '../modules/preferences/module.mjs';
import { renderPreferences } from '../modules/preferences/render.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function context(home, { answers = {}, dryRun = false } = {}) {
  const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun, interactive: false, answers: new Map(Object.entries(answers)), prompter: null, repoRoot });
  ctx.beginModule('test');
  return ctx;
}

const question = (mod, key) => mod.questions.find((q) => q.key === key);

test('Claude Code settings default Opus 5.5 to medium effort, and the question stays', () => {
  const q = question(claudeCode, 'CLAUDE_MODEL_EFFORTS');
  assert.equal(q.default, 'claude-opus-5-5=medium');
  assert.deepEqual(parseModelEfforts(q.default), { 'claude-opus-5-5': 'medium' });
  assert.deepEqual(parseModelEfforts(''), {});
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

test('the example dispatch profiles: Opus medium default, Opus xhigh for design and plans, Sonnet medium for small tasks, no Fable', () => {
  assert.equal(question(firstmate, 'FIRSTMATE_DISPATCH').default, 'capable');
  const capable = dispatchProfiles('capable', 'claude');
  assert.deepEqual(capable.default, [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium' }]);
  const rule = (re) => capable.rules.find((r) => re.test(r.when));
  assert.deepEqual(rule(/frontend/).use, [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'xhigh' }]);
  assert.deepEqual(rule(/investigat/).use, [{ harness: 'claude', model: 'claude-opus-5-5', effort: 'xhigh' }]);
  assert.match(rule(/investigat/).when, /diagnos/);
  assert.match(rule(/investigat/).when, /plan/);
  assert.deepEqual(rule(/small, well-defined task/).use, [{ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }]);
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
  const text = renderPreferences((key) => ctx.get(key), { cardsPath: path.join(os.tmpdir(), 'cards.html') });
  assert.match(text, /to `agy --model gemini-3\.8-flash-high`/);

  const other = context(os.tmpdir(), { answers: { PREFS_DELEGATE_RETRIEVAL: 'other-cli' }, dryRun: true });
  for (const q of preferences.questions) {
    if (q.when && !q.when(other)) continue;
    await other.ask(q);
  }
  assert.equal(other.get('PREFS_DELEGATE_MODEL'), '');
  assert.match(renderPreferences((key) => other.get(key), { cardsPath: path.join(os.tmpdir(), 'cards.html') }), /to `other-cli`/);
});
