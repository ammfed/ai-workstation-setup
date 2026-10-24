// Tests for the working-preferences rules: what the defaults write, how the decision,
// grilling, status and writing-style choices change the text, how pages are opened, the one
// phone answer, the route and its build rules, that an earlier PREFS_GRILL_ON_GAPS answer
// carries over to PREFS_GRILL, that the card template ships its style and phone layout, and
// how the private rules file feeds the rules file, worker briefs and the shared second-mate file.
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
import { parsePrivateRules } from '../modules/preferences/private-rules.mjs';
import { renderBriefInclude, renderCaptainShared, renderPreferences } from '../modules/preferences/render.mjs';

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

test('the default status leads with what needs the user, then what is at risk, the table and the links', async () => {
  assert.equal((await answer()).get('PREFS_STATUS'), 'needs-you');
  const status = sectionOf(await render(), 'Reporting and status');
  const parts = ['one line of headline counts', 'Then NEEDS YOU: only what the user alone can do', 'Then AT RISK:', 'Then always a table with To do, Doing and Done', 'End with one Links line'];
  let at = -1;
  for (const part of parts) {
    const i = status.indexOf(part);
    assert.ok(i > at, `"${part}" missing or out of order`);
    at = i;
  }
  assert.match(status, /Leave out any empty part except the table/);
  assert.match(status, /Show progress as counts like "3 of 5"/);
  assert.doesNotMatch(status, /TODO, DOING, DONE|labelled YOU/, 'the older board shape is not mixed in');
  assert.doesNotMatch(sectionOf(await render({ PREFS_STATUS: 'board' }), 'Reporting and status'), /NEEDS YOU/);
});

test('the board status is still a choice, with a YOU block and never ME', async () => {
  const status = sectionOf(await render({ PREFS_STATUS: 'board' }), 'Reporting and status');
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

  const off = await render({ PREFS_BUILD_WHOLE_GOAL: 'no', PREFS_KUN: 'no', PREFS_MODEL_GUIDE: 'no', PREFS_HABITS: 'no' });
  assert.doesNotMatch(off, /## Building/);
  assert.doesNotMatch(off, /End every reply with the next actions|"Check X"|A statement is a claim/);
});

test('the /kun rule is on by default, in sessions and worker briefs, and can be turned off', async () => {
  const building = sectionOf(await render(), 'Building');
  assert.match(building, /At the start of real work \(a feature, a bug, a refactor, a plan, research or an explainer\), run \/kun once/);
  assert.match(building, /Later checks in the same session reuse that load\./);
  assert.match(building, /Skip it for small clear tasks/);
  assert.doesNotMatch(await render({ PREFS_KUN: 'no' }), /run \/kun once/);
  const ctx = await answer({ PREFS_TARGETS: 'claude,firstmate' });
  assert.equal(ctx.get('PREFS_KUN'), true);
  assert.match(renderBriefInclude((key) => ctx.get(key)), /## Building\n\n- At the start of real work .* run \/kun once/);
  assert.doesNotMatch(renderBriefInclude((key) => (key === 'PREFS_KUN' ? false : ctx.get(key))), /\/kun/);
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

test('one phone answer covers review pages and the prototype check', async () => {
  const on = await render({ PREFS_PROTOTYPE_CHECK: 'yes' });
  assert.match(sectionOf(on, 'Building'), /then at laptop width and at phone width \(390 px\)\. Check/);
  const off = await render({ PREFS_PROTOTYPE_CHECK: 'yes', PREFS_PAGE_PHONE: 'no' });
  assert.match(sectionOf(off, 'Building'), /at the user's target screen size first, then at laptop width\. Check that font sizes/);
  assert.doesNotMatch(off, /390|phone/i, 'no phone width is left anywhere');
});

test('a page is created without a tab, checked, then opened once at hand-over, and nothing opens while the user is away', async () => {
  const decisions = sectionOf(await render(), 'Decisions');
  assert.match(decisions, /Create review pages without launching a browser tab \(`--no-open`, or `LAVISH_AXI_NO_OPEN=1`\)/);
  assert.match(decisions, /never re-run the open command just to refresh a page/);
  assert.match(decisions, /Once the page is checked, open it once in the user's browser at hand-over and give the link/);
  assert.match(decisions, /While the user is away, open nothing; the link goes into the return brief\./);
  assert.doesNotMatch(decisions, /never open one automatically/, 'the older rule that forbade every open is gone');
  assert.doesNotMatch(await render({ PREFS_AWAY_MODE: 'no' }), /While the user is away, open nothing/);
  assert.doesNotMatch(await render({ PREFS_DECISIONS: 'chat' }), /open it once/);
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

test('the card template labels its note box and hides an empty waiting strip', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'templates/preferences/decision-cards.html'), 'utf8');
  assert.match(html, /<label[^>]*for="note"[^>]*>Note<\/label>\s*<textarea id="note"/, 'a visible label sits above the note box');
  // The strip is display:flex, which beats the hidden attribute unless hidden is forced.
  assert.match(html, /\[hidden\]\{display:none!important\}/);
  assert.match(html, /<div class="waiting" id="waiting" hidden>/);
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

// A private rules file with all five headings, an unknown one, a title and a comment.
const PRIVATE = [
  '# My own rules',
  'Intro text before the first heading is not used.',
  '<!-- a note to myself -->',
  '## Everywhere',
  '- Everywhere rule one.',
  '- Everywhere rule two,',
  '  continued on the next line.',
  '## sessions',
  'Sessions rule as a paragraph.',
  '',
  'Another sessions paragraph.',
  '## Workers',
  '1. Workers rule.',
  '## Second mates',
  '* Second mates rule.',
  '## Reviewer',
  '- Reviewer rule.',
  '## Hobbies',
  '- Hobby rule.',
].join('\n');

test('the private rules file splits into its five headings, and an unknown heading is reported', () => {
  const { rules, unknown } = parsePrivateRules(PRIVATE);
  assert.deepEqual(rules.everywhere, ['Everywhere rule one.', 'Everywhere rule two, continued on the next line.']);
  assert.deepEqual(rules.sessions, ['Sessions rule as a paragraph.', 'Another sessions paragraph.']);
  assert.deepEqual(rules.workers, ['Workers rule.']);
  assert.deepEqual(rules['second mates'], ['Second mates rule.']);
  assert.deepEqual(rules.reviewer, ['Reviewer rule.']);
  assert.deepEqual(unknown, ['Hobbies']);
  const all = Object.values(rules).flat().join('\n');
  assert.doesNotMatch(all, /Intro text|a note to myself|Hobby rule|My own rules/);
  assert.deepEqual(parsePrivateRules('').unknown, []);
});

test('private Everywhere and Sessions lines close the rules file; the other headings stay out of it', async () => {
  const { rules } = parsePrivateRules(PRIVATE);
  const ctx = await answer();
  const text = renderPreferences((key) => ctx.get(key), { cardsPath: CARDS, privateRules: rules });
  const own = sectionOf(text, 'Private rules');
  for (const line of ['Everywhere rule one.', 'Sessions rule as a paragraph.', 'Another sessions paragraph.']) assert.ok(own.includes(`- ${line}`), line);
  assert.doesNotMatch(text, /Workers rule|Second mates rule|Reviewer rule/);
  assert.ok(text.trimEnd().endsWith('- Another sessions paragraph.'), 'the private section comes last');
  assert.doesNotMatch(await render(), /## Private rules/, 'no file, no section');
});

test('the worker brief include gains the helper model, build rules, the principle checker and private Workers lines', async () => {
  const { rules } = parsePrivateRules(PRIVATE);
  const ctx = await answer({ PREFS_TARGETS: 'claude,firstmate', PREFS_TEST_FIRST: 'yes', PREFS_GLOSSARY_ADR: 'yes', PREFS_DELEGATE_RETRIEVAL: 'agy', PREFS_DELEGATE_MODEL: 'example-model' });
  assert.equal(ctx.get('PREFS_PRINCIPLE_CHECKS'), true, 'the checker line is on by default');
  const checker = path.join(os.tmpdir(), 'skills', 'workflow-playbook', 'principles', 'bin', 'principle-check.mjs');
  const text = renderBriefInclude((key) => ctx.get(key), { checkerPath: checker, privateRules: rules });
  const order = ['## Helper models', '`agy --model example-model`', '## Building', 'test-first at the seams', 'GLOSSARY.md', '## Principle checks', `node ${checker} <its files or folder>`, '--phone', '## Private rules', '- Everywhere rule one.', '- Workers rule.'];
  let at = -1;
  for (const part of order) {
    const i = text.indexOf(part);
    assert.ok(i > at, `"${part}" missing or out of order`);
    at = i;
  }
  assert.doesNotMatch(text, /Sessions rule|Second mates rule|Reviewer rule|## Writing style/);
  assert.doesNotMatch(text, /Delivery contract: mode=/);
  // The checker line needs both the answer and an installed checker.
  assert.doesNotMatch(renderBriefInclude((key) => ctx.get(key)), /Principle checks/);
  assert.doesNotMatch(renderBriefInclude((key) => (key === 'PREFS_PRINCIPLE_CHECKS' ? false : ctx.get(key)), { checkerPath: checker }), /Principle checks/);
  assert.match(renderBriefInclude((key) => ctx.get(key), { checkerPath: '/a b/principle-check.mjs' }), /node "\/a b\/principle-check\.mjs"/, 'a path with a space is quoted');
});

test('the shared second-mate file carries the Everywhere and Second mates lines under a main-authoritative header, and only when there are any', () => {
  const { rules } = parsePrivateRules(PRIVATE);
  const text = renderCaptainShared(rules);
  assert.match(text, /^# Shared captain preferences\n/);
  assert.match(text, /<!-- memory tiers: see the stow skill -->/);
  assert.match(text, /Main-authoritative/);
  assert.match(text, /read-only copy\. Do not edit it in a second-mate home\./);
  assert.match(text, /- Everywhere rule one\.\n/);
  assert.match(text, /- Second mates rule\.\n$/);
  assert.doesNotMatch(text, /Sessions rule|Workers rule|Reviewer rule/);
  assert.equal(renderCaptainShared(null), '');
  assert.equal(renderCaptainShared(parsePrivateRules('## Workers\n- only for workers').rules), '');
});

test('a private rules path inside this clone is refused', async () => {
  await assert.rejects(answer({ PREFS_PRIVATE_RULES: path.join(repoRoot, 'local', 'private-rules.md') }), /inside this clone/);
});

function capture(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => (console.log = log))
    .then(() => lines.join('\n'));
}

// Runs the module for real into a temporary home, as the throwaway HOME install test would.
async function installInto(home, given) {
  const answers = new Map(Object.entries({ PREFS_TARGETS: 'claude,firstmate', PREFS_DECISIONS: 'chat', ...given }));
  const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun: false, interactive: false, answers, prompter: null, repoRoot });
  ctx.beginModule('preferences');
  for (const q of preferences.questions) if (!q.when || q.when(ctx)) await ctx.ask(q);
  // Answers of the firstmate and skills modules, which run before this one.
  Object.assign(ctx.values, { FIRSTMATE_HOME: path.join(home, 'fm'), SKILLS: ['workflow-playbook'] });
  const out = await capture(() => preferences.install(ctx));
  return { out, ctx };
}

test('a real run writes the private lines into all three files, warns about an unknown heading, and a second run changes nothing', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const file = path.join(home, 'private-rules.md');
    fs.writeFileSync(file, PRIVATE);
    const { out, ctx } = await installInto(home, { PREFS_PRIVATE_RULES: file });
    assert.match(out, /unknown heading "Hobbies"; its lines are not used/);
    assert.deepEqual(ctx.record.warnings.length, 1);
    assert.equal(ctx.record.failures.length, 0, out);
    const prefs = fs.readFileSync(path.join(home, '.claude', 'rules', 'working-preferences.md'), 'utf8');
    assert.match(prefs, /- Sessions rule as a paragraph\./);
    assert.equal(fs.readFileSync(path.join(home, 'fm', 'data', 'captain.md'), 'utf8'), prefs);
    const brief = fs.readFileSync(path.join(home, 'fm', 'config', 'brief-include.md'), 'utf8');
    assert.match(brief, /- Workers rule\./);
    assert.ok(brief.includes(path.join(home, '.claude', 'skills', 'workflow-playbook', 'principles', 'bin', 'principle-check.mjs')), 'the brief names the installed checker');
    assert.match(fs.readFileSync(path.join(home, 'fm', 'data', 'captain-shared.md'), 'utf8'), /- Second mates rule\./);
    const again = (await installInto(home, { PREFS_PRIVATE_RULES: file })).out;
    assert.equal((again.match(/is already up to date/g) || []).length, 4, again);
    assert.doesNotMatch(again, /wrote|created/i);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a second unattended run with a changed answer refreshes the files this setup wrote and keeps a hand-edited one', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const given = { PREFS_PRIVATE_RULES: path.join(home, 'missing.md') };
    const prefsFile = path.join(home, '.claude', 'rules', 'working-preferences.md');
    const captain = path.join(home, 'fm', 'data', 'captain.md');
    const brief = path.join(home, 'fm', 'config', 'brief-include.md');
    await installInto(home, { ...given, PREFS_KUN: 'no' });
    for (const f of [prefsFile, captain, brief]) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /run \/kun once/, f);

    const { out } = await installInto(home, { ...given, PREFS_KUN: 'yes' });
    assert.doesNotMatch(out, /left untouched/, out);
    for (const f of [prefsFile, captain, brief]) assert.match(fs.readFileSync(f, 'utf8'), /run \/kun once/, f);

    // A file edited by hand since is never replaced silently.
    const edited = `${fs.readFileSync(prefsFile, 'utf8')}- My own line.\n`;
    fs.writeFileSync(prefsFile, edited);
    const third = await installInto(home, { ...given, PREFS_KUN: 'no' });
    assert.equal(fs.readFileSync(prefsFile, 'utf8'), edited);
    assert.match(third.out, /working-preferences\.md exists with different content.*left untouched/);
    assert.doesNotMatch(fs.readFileSync(captain, 'utf8'), /run \/kun once/);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('without the firstmate module in the run, the saved Firstmate home is used, not ~/firstmate', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const saved = path.join(home, '.fm-home');
    // The checker an earlier run installed, so the brief has a line without SKILLS in this run.
    const checker = path.join(home, '.claude', 'skills', 'workflow-playbook', 'principles', 'bin', 'principle-check.mjs');
    fs.mkdirSync(path.dirname(checker), { recursive: true });
    fs.writeFileSync(checker, '');
    const answers = new Map(Object.entries({ PREFS_TARGETS: 'claude,firstmate', PREFS_DECISIONS: 'chat', FIRSTMATE_HOME: saved, PREFS_PRIVATE_RULES: path.join(home, 'missing.md') }));
    const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun: false, interactive: false, answers, prompter: null, repoRoot });
    ctx.beginModule('preferences');
    for (const q of preferences.questions) if (!q.when || q.when(ctx)) await ctx.ask(q);
    const out = await capture(() => preferences.install(ctx));
    assert.equal(ctx.record.failures.length, 0, out);
    assert.ok(fs.existsSync(path.join(saved, 'data', 'captain.md')), out);
    assert.ok(fs.readFileSync(path.join(saved, 'config', 'brief-include.md'), 'utf8').includes(checker), out);
    assert.ok(!fs.existsSync(path.join(home, 'firstmate')), 'nothing lands in ~/firstmate');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('with no private rules file, nothing extra is written and no shared second-mate file appears', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const { out } = await installInto(home, { PREFS_PRIVATE_RULES: path.join(home, 'missing.md') });
    assert.match(out, /no private rules file at .*missing\.md; nothing extra written/);
    assert.doesNotMatch(fs.readFileSync(path.join(home, '.claude', 'rules', 'working-preferences.md'), 'utf8'), /## Private rules/);
    assert.ok(!fs.existsSync(path.join(home, 'fm', 'data', 'captain-shared.md')));
    assert.doesNotMatch(fs.readFileSync(path.join(home, 'fm', 'config', 'brief-include.md'), 'utf8'), /## Private rules/);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the taste preset is off by default, so the recommended set writes none of it', async () => {
  const ctx = await answer();
  assert.equal(ctx.get('PREFS_TASTE_PRESET'), false);
  assert.equal(preferences.questions.find((q) => q.key === 'PREFS_TASTE_PRESET').useDefault(ctx), true, 'not asked unless the user goes through each preference');
  assert.doesNotMatch(await render(), /## Taste preset/);
});

test('the taste preset ships generic rules that no preference question already writes', async () => {
  const text = fs.readFileSync(path.join(repoRoot, 'templates', 'preferences', 'taste-preset.md'), 'utf8');
  const { rules, unknown } = parsePrivateRules(text);
  assert.deepEqual(unknown, []);
  assert.ok(rules.everywhere.length && rules.sessions.length, 'it has screen taste and review habits');
  assert.equal(rules.workers.length + rules['second mates'].length + rules.reviewer.length, 0);
  assert.doesNotMatch(text, /—|@|~\/|\/home\/|\b(19|20)\d\d\b/, 'no em dashes, addresses, paths or years');
  const yesToAll = Object.fromEntries(preferences.questions.filter((q) => q.type === 'confirm').map((q) => [q.key, 'yes']));
  const written = (await render({ ...yesToAll, PREFS_TASTE_PRESET: 'no' })).split('\n').map((l) => l.replace(/^- /, ''));
  for (const line of [...rules.everywhere, ...rules.sessions]) assert.ok(!written.includes(line), `already written: ${line}`);
});

test('turning the taste preset on writes its rules into the rules file and its Everywhere lines into worker briefs', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const { rules } = parsePrivateRules(fs.readFileSync(path.join(repoRoot, 'templates', 'preferences', 'taste-preset.md'), 'utf8'));
    const { out, ctx } = await installInto(home, { PREFS_TASTE_PRESET: 'yes', PREFS_PRIVATE_RULES: path.join(home, 'missing.md') });
    assert.equal(ctx.record.failures.length, 0, out);
    assert.match(out, new RegExp(`taste preset: ${rules.everywhere.length + rules.sessions.length} rules added`));
    const prefs = fs.readFileSync(path.join(home, '.claude', 'rules', 'working-preferences.md'), 'utf8');
    const taste = sectionOf(prefs, 'Taste preset');
    for (const line of [...rules.everywhere, ...rules.sessions]) assert.ok(taste.includes(`- ${line}`), line);
    assert.equal(fs.readFileSync(path.join(home, 'fm', 'data', 'captain.md'), 'utf8'), prefs);
    const brief = sectionOf(fs.readFileSync(path.join(home, 'fm', 'config', 'brief-include.md'), 'utf8'), 'Taste preset');
    for (const line of rules.everywhere) assert.ok(brief.includes(`- ${line}`), line);
    for (const line of rules.sessions) assert.ok(!brief.includes(line), `a session habit stays out of worker briefs: ${line}`);
    assert.ok(!fs.existsSync(path.join(home, 'fm', 'data', 'captain-shared.md')), 'second mates read captain.md through the main home, not a shared copy');
    const off = (await installInto(home, { PREFS_PRIVATE_RULES: path.join(home, 'missing.md') })).out;
    assert.doesNotMatch(off, /taste preset/);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
