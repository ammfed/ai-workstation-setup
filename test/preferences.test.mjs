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

test('facts about current products come from a live, dated source, and the rule can be turned off', async () => {
  const research = sectionOf(await render(), 'Research');
  assert.match(research, /the current leading models, tools or products come from a live source checked that day, with its date/);
  assert.match(research, /fetch each product's own pricing page and docs that day/);
  assert.match(research, /checked on the vendor's page, from a third party only, or not checked/);
  assert.doesNotMatch(await render({ PREFS_LIVE_FACTS: 'no' }), /live source checked that day/);
});

test('review pages also read well on a phone, a page in a skill\'s own look is re-themed, and both can be turned off', async () => {
  const text = await render();
  const pages = sectionOf(text, 'Review pages');
  assert.match(pages, /reads well on a phone \(390 px wide\): the card and its picture stack/);
  assert.match(pages, /a wide diagram gets a phone version/);
  assert.match(pages, /and the look of boards that a skill brings with it/);
  assert.doesNotMatch(await render({ PREFS_PAGE_PHONE: 'no' }), /reads well on a phone/);
});

test('planning effort is checked, and the agent decides process questions from the primary source', async () => {
  const text = await render();
  assert.match(sectionOf(text, 'AI and model use'), /check the effort level the agent doing it actually runs at\. An agent on a lower effort than these rules pick hands that work to a worker at that effort/);
  assert.doesNotMatch(await render({ PREFS_MODEL_ROUTING: 'economical' }), /hands that work to a worker at that effort/);
  assert.match(sectionOf(text, 'Decisions'), /For a process or tooling question the user cannot answer, read the primary source/);
  assert.doesNotMatch(await render({ PREFS_AUTONOMY: 'ask' }), /read the primary source/);
});

test('the capable model rules: research, polish, investigations and plans on high effort, a new look on extra-high, small tasks on Sonnet high', async () => {
  const models = sectionOf(await render(), 'AI and model use');
  assert.match(models, /Run research on the most capable model at high effort\. It plans and checks the work, hands bulk fetching to the bulk research CLI, reading and summaries to the reader subagent, and drafting to a faster model at high effort\./);
  assert.match(models, /to a faster model at high effort, and re-run it on the most capable model at medium effort after a failed check\./);
  assert.doesNotMatch(models, /raise it to high after a failed check/);
  assert.match(models, /Give the design of a new frontend look that is not yet settled \(screens, look, layout, clickable journeys\) to the most capable model at extra-high effort\./);
  assert.match(models, /Give polish of a prototype whose look is already settled \(spacing, copy, states, small layout fixes, fixes from a usability check\) to the most capable model at high effort\./);
  assert.match(models, /Give investigations, diagnosis and plans to the most capable model at high effort\. Re-run the same task at extra-high effort when the result is weak or the cause is hard to find, and fix or build at medium effort once the cause is proven or the plan is settled\./);
  assert.doesNotMatch(models, /investigations, diagnosis and plans to the most capable model at extra-high effort/);
  assert.doesNotMatch(models, /investigation, research or design work starts/);
  assert.match(models, /Before planning, investigation or design work starts/);
  const other = await render({ PREFS_MODEL_ROUTING: 'balanced' });
  assert.doesNotMatch(other, /Run research on the most capable model/);
});

test('a fleet checks live state, keeps work moving, and names windows by their labels; a deadline never skips a check', async () => {
  const text = await render();
  const fleet = sectionOf(text, 'Working with a fleet');
  assert.match(fleet, /check its live state first/);
  assert.match(fleet, /start the next step at once/);
  assert.match(fleet, /Raise any wait longer than 30 minutes/);
  assert.match(fleet, /name the window by the labels the user sees on screen/);
  assert.match(sectionOf(text, 'Safety'), /keep every normal check and work in dependency order/);
  assert.doesNotMatch(await render({ PREFS_HABITS: 'no' }), /dependency order/);
});

test('every project reply ends with where the work is, and it closes the reply together with the next actions', async () => {
  const text = await render();
  const habit = sectionOf(text, 'Language and tone');
  const closing = sectionOf(text, 'Ideas and priorities');
  assert.match(habit, /End every reply with the next actions, the user's first\./);
  assert.match(closing, /End every project reply with one plain line that says where the work is on the map, the next step, who takes it and when\./);
  assert.match(closing, /Name the step in words, never as a count such as "step 3 of 6"\. Say when as an event or a day, not a clock time\./);
  assert.doesNotMatch(text, /orient them in two short lines/);
  // Both rules close a reply, so neither may push the other away from the end.
  assert.doesNotMatch(text, /(begin|start|open) (every|each) (project )?reply with/i);
  assert.equal(text.match(/^- End every (project )?reply with/gm).length, 2);
  assert.doesNotMatch(await render({ PREFS_ORIENT: 'no' }), /where the work is on the map/);
  assert.match(await render({ PREFS_ORIENT: 'no' }), /End every reply with the next actions/);
});

test('the route starts a map at once for an effort over several sessions, and wayfinder tracks it on request', async () => {
  const building = sectionOf(await render({ PREFS_ROUTE: 'yes' }), 'Building');
  assert.match(building, /If the effort takes more than one session, start a map at once without being asked and show it\./);
  assert.match(building, /When the user types \/wayfinder, wayfinder tracks the map as tickets\./);
});

test('preparing the next stage while a review page waits is the user\'s choice, off by default', async () => {
  const line = 'While waiting, prepare the next stage, but do not start it before approval.';
  const off = sectionOf(await render(), 'Review page delivery');
  assert.match(off, /then stand by quietly until the user answers\./);
  assert.ok(!off.includes(line));
  const on = sectionOf(await render({ PREFS_PAGE_PREPARE_NEXT: 'yes' }), 'Review page delivery');
  assert.match(on, /then stand by quietly until the user answers\./);
  assert.ok(on.includes(line));
  assert.ok(on.indexOf(line) > on.indexOf('stand by quietly'), 'the line follows the page-first rule');
  assert.ok(!(await render({ PREFS_PAGE_PREPARE_NEXT: 'yes', PREFS_PAGE_FIRST: 'no' })).includes(line));
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
  assert.equal(firstmate.questions.find((x) => x.key === 'FIRSTMATE_STOW_REMINDER_TOKENS').default, 'auto');
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

test('the card template is light by default with a guarded dark switch', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'templates/preferences/decision-cards.html'), 'utf8');
  assert.doesNotMatch(html, /prefers-color-scheme\s*:\s*dark/, 'the browser dark setting is not followed');
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.match(html, /<button[^>]*id="theme"[^>]*aria-pressed="false"[^>]*aria-label="Dark mode"/);
  assert.match(html, /setAttribute\('aria-pressed'/);
  // Every storage call sits inside a try block, and the theme is set before the stylesheet paints.
  const calls = html.match(/localStorage\.(getItem|setItem)/g) || [];
  assert.ok(calls.length >= 2, 'the choice is read and written');
  for (const m of html.matchAll(/localStorage\.(?:getItem|setItem)/g)) {
    assert.match(html.slice(Math.max(0, m.index - 80), m.index), /try\s*\{[^}]*$/, 'storage access is wrapped in try/catch');
  }
  assert.ok(html.indexOf('localStorage.getItem') < html.indexOf('<style>'), 'theme is applied before first paint');
});
