// Tests for the working-preferences rules: what the defaults write, how the decision,
// grilling, status and writing-style choices change the text, the route and its build
// rules, that an earlier PREFS_GRILL_ON_GAPS answer carries over to PREFS_GRILL, and that
// the card template ships its style and phone layout.
// Run: node --test test/preferences.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Context, detectPlatform } from '../lib/context.mjs';
import firstmate from '../modules/firstmate/module.mjs';
import preferences from '../modules/preferences/module.mjs';
import { renderPreferences } from '../modules/preferences/render.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARDS = path.join(os.tmpdir(), 'decision-cards.html');

// Answers every preferences question the way an unattended run does: given answers first,
// then defaults, skipping questions whose condition is not met.
async function answer(given = {}) {
  const ctx = new Context({ platform: detectPlatform(), dryRun: true, interactive: false, answers: new Map(Object.entries(given)), prompter: null, repoRoot });
  for (const q of preferences.questions) {
    if (q.when && !q.when(ctx)) continue;
    await ctx.ask(q);
  }
  return ctx;
}

async function render(given = {}) {
  const ctx = await answer(given);
  return renderPreferences((key) => ctx.get(key), { cardsPath: CARDS });
}

function sectionOf(text, title) {
  const start = text.indexOf(`## ${title}\n`);
  assert.notEqual(start, -1, `missing section ${title}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

test('the defaults ask through both the question tool and card pages, and grill every round, balanced', async () => {
  const ctx = await answer();
  assert.equal(ctx.get('PREFS_DECISIONS'), 'both');
  assert.equal(ctx.get('PREFS_GRILL'), 'every');
  const decisions = sectionOf(await render(), 'Decisions');
  assert.match(decisions, /Ask quick questions with the question tool, one at a time, a preview on every option and a recommendation\. Put larger or visual decisions on a Lavish decision-card page\./);
  assert.match(decisions, /Every round of questions to the user runs the grilling method/);
  assert.match(decisions, /Keep it balanced\. When the intent and the request are clear enough, go ahead without asking\./);
  assert.match(decisions, /becomes a short questionnaire for that person/);
  assert.match(decisions, /--no-open/, 'card-page rules still apply with both');
});

test('the default status is the board, with a YOU block and never ME', async () => {
  const status = sectionOf(await render(), 'Reporting and status');
  assert.match(status, /TODO, DOING, DONE/);
  assert.match(status, /the user's block labelled YOU, the agent's labelled with its own role name \(for example FIRST MATE\), never ME\./);
  assert.match(status, /small text bars and boxes where they carry meaning/);
  assert.doesNotMatch(await render({ PREFS_STATUS: 'actions' }), /labelled YOU/);
});

test('every review page uses the card template and pages are handed over together', async () => {
  const text = await render();
  const pages = sectionOf(text, 'Review pages');
  assert.ok(pages.includes(`Every Lavish page starts from the card template at \`${CARDS}\``));
  assert.match(pages, /overrides lavish-axi's own design default/);
  assert.match(pages, /diagram-design skill/);
  assert.doesNotMatch(sectionOf(text, 'Decisions'), /Start each decision page from the template/, 'the template path is given once');
  assert.match(sectionOf(text, 'Review page delivery'), /hold the links until all open work is done/);

  const off = await render({ PREFS_PAGES_ALL_CARDS: 'no' });
  assert.doesNotMatch(off, /Every Lavish page starts/);
  assert.match(sectionOf(off, 'Decisions'), /Start each decision page from the template/);
  assert.doesNotMatch(await render({ PREFS_DECISIONS: 'chat' }), /Every Lavish page starts/);
});

test('building and the everyday habits are written in their sections, and each can be turned off', async () => {
  const text = await render();
  const building = sectionOf(text, 'Building');
  assert.match(building, /show the research and the user journeys on one review page/);
  assert.match(building, /Never feed a builder step by step\./);
  assert.match(building, /read that vendor's official prompting guide first/);
  assert.match(sectionOf(text, 'Language and tone'), /End every reply with the next actions, the user's first\./);
  assert.match(sectionOf(text, 'Ideas and priorities'), /"Check X" is a question, not a go-ahead to widen the work\./);
  assert.match(sectionOf(text, 'Safety'), /A statement is a claim until something shows it\./);

  const off = await render({ PREFS_BUILD_WHOLE_GOAL: 'no', PREFS_MODEL_GUIDE: 'no', PREFS_HABITS: 'no' });
  assert.doesNotMatch(off, /## Building/);
  assert.doesNotMatch(off, /End every reply with the next actions|"Check X"|A statement is a claim/);
});

test('the route and its build rules are off by default and each writes its own Building rule', async () => {
  assert.doesNotMatch(await render(), /six steps|test-first|GLOSSARY\.md|phone width/);
  const building = sectionOf(
    await render({ PREFS_ROUTE: 'yes', PREFS_TEST_FIRST: 'yes', PREFS_GLOSSARY_ADR: 'yes', PREFS_PROTOTYPE_CHECK: 'yes' }),
    'Building',
  );
  assert.match(building, /1 Plan: .*2 Decide: .*3 Prototype: .*4 Breakdown: .*5 Build: .*6 Ship: /);
  for (const skill of ['wayfinder', 'grilling', 'to-spec', 'to-tickets', 'tdd', 'no-mistakes']) assert.ok(building.includes(skill), skill);
  assert.match(building, /a small clear change goes Plan, Build, Ship/);
  assert.match(building, /Build product code test-first at the seams the spec names/);
  assert.match(building, /Prototypes, docs and config are not test-first\./);
  assert.match(building, /read GLOSSARY\.md and docs\/adr\/ if they exist/);
  assert.match(building, /at laptop width and at phone width \(390 px\)/);
  assert.doesNotMatch(sectionOf(await render({ PREFS_TEST_FIRST: 'yes' }), 'Building'), /six steps|GLOSSARY|phone width/);
});

test('the Simplified Technical English style is a choice that adds its rules and keeps outward writing out', async () => {
  const ctx = await answer();
  assert.equal(ctx.get('PREFS_WRITING_STYLE'), 'plain');
  assert.doesNotMatch(await render(), /Simplified Technical English/);
  const tone = sectionOf(await render({ PREFS_WRITING_STYLE: 'ste' }), 'Language and tone');
  assert.match(tone, /based on Simplified Technical English \(ASD-STE100\)/);
  assert.match(tone, /One instruction per sentence, as a command\. Put the condition first/);
  assert.match(tone, /20 words or fewer in steps, 25 or fewer in explanations/);
  assert.match(tone, /In a warning, state the risk in plain words first/);
  assert.match(tone, /does not apply to anything written as the user for other people/);
  await assert.rejects(answer({ PREFS_WRITING_STYLE: 'strict' }), /PREFS_WRITING_STYLE/);
});

test('an earlier PREFS_GRILL_ON_GAPS answer carries over to PREFS_GRILL', async () => {
  assert.equal((await answer({ PREFS_GRILL_ON_GAPS: 'yes' })).get('PREFS_GRILL'), 'gaps');
  assert.equal((await answer({ PREFS_GRILL_ON_GAPS: 'no' })).get('PREFS_GRILL'), 'off');
  assert.equal((await answer({ PREFS_GRILL_ON_GAPS: 'yes', PREFS_GRILL: 'every' })).get('PREFS_GRILL'), 'every');
  const gaps = sectionOf(await render({ PREFS_GRILL_ON_GAPS: 'yes' }), 'Decisions');
  assert.match(gaps, /only when it has a real gap/);
  assert.doesNotMatch(gaps, /Every round of questions/);
  assert.doesNotMatch(await render({ PREFS_GRILL: 'off' }), /grilling method|real gap/);
});

test('a saved PREFS_GRILL_ON_GAPS answer is saved back as PREFS_GRILL', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-test-'));
  const from = path.join(tmp, 'answers.env');
  const to = path.join(tmp, 'saved.env');
  fs.writeFileSync(from, 'MODULES=preferences\nPREFS_TARGETS=claude\nPREFS_GRILL_ON_GAPS=yes\n');
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'lib/installer.mjs'), '--dry-run', '--yes', '--platform', 'linux', '--answers', from, '--save-answers', to], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    stdin: 'ignore',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const saved = fs.readFileSync(to, 'utf8');
  assert.match(saved, /^PREFS_GRILL=gaps$/m);
  assert.doesNotMatch(saved, /PREFS_GRILL_ON_GAPS/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the stow reminder is on by default when Firstmate is picked', () => {
  const q = firstmate.questions.find((x) => x.key === 'FIRSTMATE_STOW_REMINDER');
  assert.equal(q.default, true);
  assert.equal(firstmate.questions.find((x) => x.key === 'FIRSTMATE_STOW_REMINDER_TOKENS').default, '350000');
});

test('the card template ships its fonts, colours, waiting strip and phone layout', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'templates/preferences/decision-cards.html'), 'utf8');
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Inter:wght@600;700;800&family=Roboto\+Mono:wght@500&family=Roboto:wght@400;500;700/);
  for (const colour of ['#EDEDED', '#B68A35', '#92722A', '#7C5E24', '#F9F7ED', '#1B1D21', '#232528', '#5F646D', '#E1E3E5', '#2F663C', '#F3FAF4', '#B2550B', '#FFFBEB']) {
    assert.ok(html.includes(colour), `missing ${colour}`);
  }
  assert.match(html, /--radius:16px/);
  assert.match(html, /Waiting on a click, not a decision/);
  assert.match(html, /@media \(max-width:719px\)/);
  assert.match(html, /previewsTall/);
  assert.match(html, /showModal\(\)/, 'a picture opens full size on tap');
});
