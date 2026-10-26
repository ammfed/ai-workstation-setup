// Tests for the working-preferences rules: the short core file and the five on-demand skills,
// where every rule lives (test/rule-homes.mjs), what the defaults write, how the decision,
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
import { BRIEF_BLOCK_END, BRIEF_BLOCK_START, PREFERENCE_SKILLS, mergeBriefBlock, renderBriefInclude, renderCaptain, renderCaptainShared, renderPreferenceSkills, renderPreferences } from '../modules/preferences/render.mjs';
import { ALL_ON, RULE_HOMES } from './rule-homes.mjs';

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

// The core file and each skill file, by home name ('core' or the skill's name).
async function renderHomes(given = {}, opts = { cardsPath: CARDS }) {
  const ctx = await answer(given);
  const get = (key) => ctx.get(key);
  return { core: renderPreferences(get, opts), ...renderPreferenceSkills(get, opts) };
}

// Every file joined, for checks that a rule is written somewhere or nowhere.
async function render(given = {}) {
  return Object.values(await renderHomes(given)).join('\n');
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
  const homes = await renderHomes();
  const decisions = sectionOf(homes.core, 'Decisions');
  assert.match(decisions, /Ask quick questions with the question tool, one at a time, with a preview on every option and a recommendation\. Put larger or visual decisions on a Lavish decision-card page\./);
  assert.match(decisions, /Every round of questions to the user runs the grilling method/);
  assert.match(decisions, /Keep it balanced\. When the intent and the request are clear enough, go ahead without asking\./);
  assert.match(homes['writing-for-others'], /becomes a short questionnaire for that person/);
  assert.match(sectionOf(homes['review-pages'], 'Opening and sending'), /--no-open/, 'card-page rules still apply with both');
});

test('the default status leads with what needs the user, then what is at risk, the table and the links', async () => {
  assert.equal((await answer()).get('PREFS_STATUS'), 'needs-you');
  const status = sectionOf((await renderHomes())['status-and-away'], 'Status replies');
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
  assert.doesNotMatch((await renderHomes({ PREFS_STATUS: 'board' }))['status-and-away'], /NEEDS YOU/);
});

test('the board status is still a choice, with a YOU block and never ME', async () => {
  const status = sectionOf((await renderHomes({ PREFS_STATUS: 'board' }))['status-and-away'], 'Status replies');
  assert.match(status, /TODO, DOING, DONE/);
  assert.match(status, /the user's block labelled YOU, the agent's labelled with its own role name \(for example FIRST MATE\), never ME\./);
  assert.match(status, /small text bars and boxes where they carry meaning/);
  assert.doesNotMatch(await render({ PREFS_STATUS: 'actions' }), /labelled YOU/);
});

test('every review page uses the card template and pages are handed over together', async () => {
  const text = (await renderHomes())['review-pages'];
  const pages = sectionOf(text, 'Building the page');
  assert.ok(pages.includes(`Every Lavish page starts from the card template at \`${CARDS}\``));
  assert.match(pages, /overrides lavish-axi's own design default/);
  assert.match(pages, /diagram-design skill/);
  assert.doesNotMatch(text, /Start each decision page from the template/, 'the template path is given once');
  assert.match(sectionOf(text, 'Opening and sending'), /hold the links until all open work is done/);

  const off = (await renderHomes({ PREFS_PAGES_ALL_CARDS: 'no' }))['review-pages'];
  assert.doesNotMatch(off, /Every Lavish page starts/);
  assert.match(sectionOf(off, 'Building the page'), /Start each decision page from the template/);
  assert.doesNotMatch(await render({ PREFS_DECISIONS: 'chat' }), /Every Lavish page starts/);
});

test('building and the everyday habits are written in their sections, and each can be turned off', async () => {
  const homes = await renderHomes();
  const building = sectionOf(homes['running-workers'], 'Building something new');
  assert.match(building, /show the research and the user journeys on one review page/);
  assert.match(building, /Never feed a builder step by step\./);
  assert.match(building, /read that vendor's official prompting guide first/);
  assert.match(sectionOf(homes.core, 'How to reply'), /End every reply with the next actions, the user's first\./);
  assert.match(sectionOf(homes.core, 'Focus and priorities'), /"Check X" is a question, not a go-ahead to widen the work\./);
  assert.match(sectionOf(homes.core, 'Safety'), /A statement is a claim until something shows it\./);

  const off = await render({ PREFS_BUILD_WHOLE_GOAL: 'no', PREFS_KUN: 'no', PREFS_MODEL_GUIDE: 'no', PREFS_HABITS: 'no' });
  assert.doesNotMatch(off, /## Building something new|run \/kun once/);
  assert.doesNotMatch(off, /End every reply with the next actions|"Check X"|A statement is a claim/);
});

test('the /kun rule is on by default, in sessions and worker briefs, and can be turned off', async () => {
  const building = sectionOf((await renderHomes()).core, 'Before you start');
  assert.match(building, /At the start of real work \(a feature, a bug, a refactor, a plan, research or an explainer\), run \/kun once/);
  assert.match(building, /Later checks in the same session reuse that load; run it again only in a new session or after compaction\./);
  assert.match(building, /Skip it for small clear tasks/);
  assert.doesNotMatch(await render({ PREFS_KUN: 'no' }), /run \/kun once/);
  const ctx = await answer({ PREFS_TARGETS: 'claude,firstmate' });
  assert.equal(ctx.get('PREFS_KUN'), true);
  assert.match(renderBriefInclude((key) => ctx.get(key)), /## Building\n\n- At the start of real work .* run \/kun once/);
  assert.doesNotMatch(renderBriefInclude((key) => (key === 'PREFS_KUN' ? false : ctx.get(key))), /\/kun/);
});

test('the vault-first line goes to the worker brief only, and names bin/search only when second-brain installed it', async () => {
  const ctx = await answer({ PREFS_TARGETS: 'claude,firstmate' });
  const get = (key) => ctx.get(key);
  const dir = path.join(os.tmpdir(), 'notes vault');
  const lead = `Before you start, check the notes vault at \`${dir}\` for past decisions, findings and rulings on the work: find a note by its folder and file name, or `;
  const tail = ' Trust the newest dated line, and check an open item against the live tracker before you act on it.';
  const cases = [
    [{ scripts: true, search: false }, 'search it with `rg`.'],
    [{ scripts: true, search: true }, 'search it with `rg` or `bin/search`.'],
    [{ scripts: false, search: false }, 'search it with `rg`.'],
  ];
  for (const [setup, routes] of cases) {
    const vault = { path: dir, ...setup };
    assert.ok(renderBriefInclude(get, { vault }).includes(`## Past decisions\n\n- ${lead}${routes}${tail}\n`), routes);
    // Sessions get these lines from the second-brain rules file, so the session rules leave them out.
    assert.doesNotMatch(renderPreferences(get, { cardsPath: CARDS, vault }), /notes vault|bin\/search/);
  }
  for (const text of [renderPreferences(get, { cardsPath: CARDS }), renderBriefInclude(get), renderBriefInclude(get, { vault: null })]) {
    assert.doesNotMatch(text, /Past decisions|notes vault|MAP\.md|bin\/search|bin\/related/);
  }
});

test('a real run writes the brief\'s vault-first line from this run\'s vault answers, or a saved vault only when its folder exists, and never when agents are kept out', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  const files = [path.join(home, '.claude', 'rules', 'working-preferences.md'), path.join(home, 'fm', 'config', 'brief-include.md')];
  const read = () => files.map((f) => fs.readFileSync(f, 'utf8'));
  const brief = () => read()[1];
  const base = { PREFS_PRIVATE_RULES: path.join(home, 'missing.md') };
  const vault = path.join(home, 'my vault');
  try {
    await installInto(home, base);
    for (const text of read()) assert.doesNotMatch(text, /notes vault/);
    await installInto(home, { ...base, VAULT_PATH: vault });
    for (const text of read()) assert.doesNotMatch(text, /notes vault/);
    fs.mkdirSync(vault);
    await installInto(home, { ...base, VAULT_PATH: vault, VAULT_TOOLS: 'search,capture' });
    assert.ok(brief().includes(`check the notes vault at \`${vault}\` for past decisions, findings and rulings on the work: find a note by its folder and file name, or search it with \`rg\` or \`bin/search\`.`));
    assert.doesNotMatch(read()[0], /notes vault/);
    fs.rmSync(vault, { recursive: true });
    await installInto(home, base, { VAULT_PATH: vault, VAULT_SCRIPTS: true, VAULT_TOOLS: [] });
    assert.ok(brief().includes(`at \`${vault}\` for past decisions, findings and rulings on the work: find a note by its folder and file name, or search it with \`rg\`.`));
    await installInto(home, base, { VAULT_PATH: vault, VAULT_SCRIPTS: false });
    assert.match(brief(), /search it with `rg`\. Trust/);
    await installInto(home, base, { VAULT_PATH: vault, VAULT_SCRIPTS: true, VAULT_AGENT_ACCESS: false });
    for (const text of read()) assert.doesNotMatch(text, /notes vault/);
    fs.mkdirSync(vault);
    await installInto(home, { ...base, VAULT_PATH: vault, VAULT_AGENT_ACCESS: 'no' });
    for (const text of read()) assert.doesNotMatch(text, /notes vault/);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the route and its build rules are off by default and each writes its own Building rule', async () => {
  assert.doesNotMatch(await render(), /six steps|test-first|GLOSSARY\.md|phone width/);
  const homes = await renderHomes({ PREFS_ROUTE: 'yes', PREFS_TEST_FIRST: 'yes', PREFS_GLOSSARY_ADR: 'yes', PREFS_PROTOTYPE_CHECK: 'yes' });
  const building = sectionOf(homes['running-workers'], 'Building something new');
  assert.match(building, /1 Plan: .*2 Decide: .*3 Prototype: .*4 Breakdown: .*5 Build: .*6 Ship: /);
  for (const skill of ['wayfinder', 'grilling', 'to-spec', 'to-tickets', 'tdd', 'no-mistakes']) assert.ok(building.includes(skill), skill);
  assert.match(building, /a small clear change goes Plan, Build, Ship/);
  assert.match(building, /Build product code test-first at the seams the spec names/);
  assert.match(building, /Prototypes, docs and config are not test-first\./);
  assert.match(building, /read GLOSSARY\.md and docs\/adr\/ if they exist/);
  assert.match(sectionOf(homes['review-pages'], 'Building the page'), /at laptop width and at phone width \(390 px\)/);
  assert.doesNotMatch(await render({ PREFS_TEST_FIRST: 'yes' }), /six steps|GLOSSARY|phone width/);
});

test('facts about current products come from a live, dated source, and the rule can be turned off', async () => {
  const research = sectionOf((await renderHomes())['models-and-research'], 'Research');
  assert.match(research, /the current leading models, tools or products come from a live source checked that day, with its date/);
  assert.match(research, /fetch each product's own pricing page and docs that day/);
  assert.match(research, /checked on the vendor's page, from a third party only, or not checked/);
  assert.doesNotMatch(await render({ PREFS_LIVE_FACTS: 'no' }), /live source checked that day/);
});

test('review pages also read well on a phone, a page in a skill\'s own look is re-themed, and both can be turned off', async () => {
  const pages = sectionOf((await renderHomes())['review-pages'], 'Building the page');
  assert.match(pages, /reads well on a phone \(390 px wide\): the card and its picture stack/);
  assert.match(pages, /a wide diagram gets a phone version/);
  assert.match(pages, /and the look of boards that a skill brings with it/);
  assert.doesNotMatch(await render({ PREFS_PAGE_PHONE: 'no' }), /reads well on a phone/);
});

test('one phone answer covers review pages and the prototype check', async () => {
  const on = (await renderHomes({ PREFS_PROTOTYPE_CHECK: 'yes' }))['review-pages'];
  assert.match(sectionOf(on, 'Building the page'), /then at laptop width and at phone width \(390 px\)\. Check/);
  const off = await render({ PREFS_PROTOTYPE_CHECK: 'yes', PREFS_PAGE_PHONE: 'no' });
  assert.match(off, /at the user's target screen size first, then at laptop width\. Check that font sizes/);
  assert.doesNotMatch(off, /390|phone/i, 'no phone width is left anywhere');
});

test('a page is created without a tab, checked, then opened once at hand-over, and nothing opens while the user is away', async () => {
  const opening = sectionOf((await renderHomes())['review-pages'], 'Opening and sending');
  assert.match(opening, /Create review pages without launching a browser tab \(`--no-open`, or `LAVISH_AXI_NO_OPEN=1`\)/);
  assert.match(opening, /Never re-run the open command just to refresh a page/);
  assert.match(opening, /Once the page is checked, open it once in the user's browser at hand-over and give the link/);
  assert.match(opening, /While the user is away, open nothing; the link goes into the return brief\./);
  assert.doesNotMatch(opening, /never open one automatically/, 'the older rule that forbade every open is gone');
  assert.doesNotMatch(await render({ PREFS_AWAY_MODE: 'no' }), /While the user is away, open nothing/);
  assert.doesNotMatch(await render({ PREFS_DECISIONS: 'chat' }), /open it once/);
});

test('planning effort is checked, and the agent decides process questions from the primary source', async () => {
  const homes = await renderHomes();
  const models = sectionOf(homes['models-and-research'], 'Models and effort');
  assert.match(models, /check the effort level the agent doing it actually runs at\./);
  assert.match(models, /An agent on a lower effort than these rules pick hands that work to a worker at that effort/);
  assert.doesNotMatch(await render({ PREFS_MODEL_ROUTING: 'economical' }), /hands that work to a worker at that effort/);
  assert.match(sectionOf(homes.core, 'Decisions'), /For a process or tooling question the user cannot answer, read the primary source/);
  assert.doesNotMatch(await render({ PREFS_AUTONOMY: 'ask' }), /read the primary source/);
});

test('the capable model rules: research, polish, investigations and plans on high effort, a new look on extra-high, small tasks on Sonnet high', async () => {
  const models = sectionOf((await renderHomes())['models-and-research'], 'Models and effort');
  assert.match(models, /Run research on the most capable model at high effort\./);
  assert.match(models, /The research agent plans and checks the work\. It hands bulk fetching to the bulk research CLI, reading and summaries to the reader subagent, and drafting to a faster model at high effort\./);
  assert.match(models, /to a faster model at high effort, and re-run it on the most capable model at medium effort after a failed check\./);
  assert.doesNotMatch(models, /raise it to high after a failed check/);
  assert.match(models, /Give the design of a new frontend look that is not yet settled \(screens, look, layout, clickable journeys\) to the most capable model at extra-high effort\./);
  assert.match(models, /Give polish of a prototype whose look is already settled \(spacing, copy, states, small layout fixes, fixes from a usability check\) to the most capable model at high effort\./);
  assert.match(models, /Give investigations, diagnosis and plans to the most capable model at high effort\./);
  assert.match(models, /Re-run an investigation, diagnosis or plan at extra-high effort when the result is weak or the cause is hard to find\. Fix or build at medium effort once the cause is proven or the plan is settled\./);
  assert.doesNotMatch(models, /investigations, diagnosis and plans to the most capable model at extra-high effort/);
  assert.doesNotMatch(models, /investigation, research or design work starts/);
  assert.match(models, /Before planning, investigation or design work starts/);
  const other = await render({ PREFS_MODEL_ROUTING: 'balanced' });
  assert.doesNotMatch(other, /Run research on the most capable model/);
});

test('a fleet checks live state, keeps work moving, and names windows by their labels; a deadline never skips a check', async () => {
  const homes = await renderHomes();
  const live = sectionOf(homes['status-and-away'], 'Live state and the queue');
  assert.match(live, /check its live state first/);
  assert.match(live, /start the next step at once/);
  assert.match(live, /Raise any wait longer than 30 minutes/);
  assert.match(sectionOf(homes['running-workers'], 'Briefing and landing'), /name the window by the labels the user sees on screen/);
  assert.match(sectionOf(homes['running-workers'], 'Repositories and deadlines'), /keep every normal check and work in dependency order/);
  assert.doesNotMatch(await render({ PREFS_HABITS: 'no' }), /dependency order/);
});

test('every project reply ends with where the work is, and it closes the reply together with the next actions', async () => {
  const text = await render();
  const core = (await renderHomes()).core;
  const habit = sectionOf(core, 'How to reply');
  const closing = sectionOf(core, 'Focus and priorities');
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

test('the core file stays short: 40 rules or fewer, under 80 lines and about 2,000 tokens, plain bullets under a few headings, and a pointer to each skill', async () => {
  const vault = { path: path.join(os.tmpdir(), 'vault'), scripts: true, search: true };
  const ctx = await answer({ PREFS_DELEGATE_RETRIEVAL: 'agy' });
  const core = renderPreferences((key) => ctx.get(key), { cardsPath: CARDS, hideKitPath: path.join(os.tmpdir(), 'hide-kit.js'), vault });
  const lines = core.trimEnd().split('\n');
  const headings = lines.filter((l) => l.startsWith('## '));
  const pointers = sectionOf(core, 'Rules that load when needed').split('\n').filter((l) => l.startsWith('- '));
  const rules = lines.filter((l) => l.startsWith('- ')).length - pointers.length;
  assert.ok(rules <= 40, `${rules} rules`);
  assert.ok(lines.length <= 80, `${lines.length} lines`);
  assert.ok(core.length / 4 < 2000, `about ${Math.round(core.length / 4)} tokens`);
  assert.ok(headings.length <= 7, headings.join(', '));
  assert.doesNotMatch(core, /^\|/m, 'no tables');
  assert.doesNotMatch(core, /```/, 'no code blocks');
  assert.doesNotMatch(core, /—/, 'no em dashes');
  assert.deepEqual(pointers.map((l) => l.slice(2, l.indexOf(':'))), Object.keys(PREFERENCE_SKILLS));
});

test('each skill file has a name, a plain description that names its triggers, and stays well under 500 lines', async () => {
  const skills = renderPreferenceSkills((key) => ALL_ON[key] ?? (key.startsWith('PREFS_') ? true : undefined), { cardsPath: CARDS });
  const all = await renderHomes();
  assert.deepEqual(Object.keys(skills), Object.keys(PREFERENCE_SKILLS));
  for (const [name, text] of Object.entries({ ...skills, ...Object.fromEntries(Object.entries(all).filter(([n]) => n !== 'core')) })) {
    const [, front] = text.match(/^---\n([\s\S]*?)\n---\n/) || [];
    assert.ok(front, `${name} has frontmatter`);
    assert.match(front, new RegExp(`^name: ${name}$`, 'm'));
    const description = front.match(/^description: (.*)$/m)[1];
    assert.ok(description.length <= 1024 && /\bUse (before|for|when|whenever)\b/.test(description), `${name}: ${description}`);
    assert.ok(text.split('\n').length < 500, name);
    assert.doesNotMatch(text, /^\|/m, `${name} has no tables`);
  }
});

test('every rule lives in exactly one home, as test/rule-homes.mjs lists, so the split loses none', async () => {
  const yes = Object.fromEntries(preferences.questions.filter((q) => q.type === 'confirm').map((q) => [q.key, 'yes']));
  const opts = { cardsPath: CARDS, hideKitPath: path.join(os.tmpdir(), 'hide-kit.js'), decisionsPath: path.join(os.tmpdir(), 'decisions.md'), vault: { path: path.join(os.tmpdir(), 'vault'), scripts: true, search: true } };
  const bulletsOf = (text) => text.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  const homesFor = async (given) => {
    const homes = await renderHomes({ ...yes, ...ALL_ON, ...given }, opts);
    const core = bulletsOf(homes.core).filter((b) => !Object.keys(PREFERENCE_SKILLS).some((n) => b.startsWith(`${n}: `)));
    return { ...Object.fromEntries(Object.entries(homes).map(([n, t]) => [n, bulletsOf(t)])), core };
  };
  const says = (row) => row.says.map((p) => p.text ?? p);

  // With every rule on, each bullet in each home belongs to exactly one row, and no row is missing.
  const all = await homesFor({});
  for (const [home, list] of Object.entries(all)) {
    const phrases = RULE_HOMES.filter((r) => !r.when && r.home === home).flatMap(says);
    for (const bullet of list) assert.equal(phrases.filter((p) => bullet.includes(p)).length, 1, `${home}: ${bullet}`);
    assert.equal(list.length, phrases.length, `${home} has ${list.length} bullets for ${phrases.length} listed`);
  }
  // A rule that another answer switches on is written in its home under that answer.
  for (const row of RULE_HOMES.filter((r) => r.when)) {
    const list = (await homesFor(row.when))[row.home] ?? [];
    for (const phrase of says(row)) assert.ok(list.some((b) => b.includes(phrase)), `${row.home} under ${JSON.stringify(row.when)}: ${phrase}`);
  }
  // Both reply-ending rules stay in the core file, word for word.
  assert.ok(all.core.includes("End every reply with the next actions, the user's first."));
  assert.ok(all.core.some((b) => b.startsWith('End every project reply with one plain line')));
});

test('captain.md holds the core rules and every skill\'s rules in one file, with no pointers to skills', async () => {
  const ctx = await answer();
  const get = (key) => ctx.get(key);
  const captain = renderCaptain(get, { cardsPath: CARDS });
  const files = [renderPreferences(get, { cardsPath: CARDS }), ...Object.values(renderPreferenceSkills(get, { cardsPath: CARDS }))];
  const rules = files.flatMap((t) => t.split('\n').filter((l) => l.startsWith('- ') && !/^- [a-z-]+: /.test(l)));
  for (const line of rules) assert.ok(captain.includes(line), line);
  assert.equal(captain.split('\n').filter((l) => l.startsWith('- ')).length, rules.length);
  assert.doesNotMatch(captain, /Rules that load when needed/);
  for (const skill of Object.values(PREFERENCE_SKILLS)) assert.match(captain, new RegExp(`^## ${skill.title}$`, 'm'));
});

test('the skills are written only with the claude target', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    await installInto(home, { PREFS_TARGETS: 'firstmate', PREFS_PRIVATE_RULES: path.join(home, 'missing.md') });
    assert.ok(fs.existsSync(path.join(home, 'fm', 'data', 'captain.md')));
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills')), 'no skills without the claude target');
    await installInto(home, { PREFS_TARGETS: 'claude', PREFS_PRIVATE_RULES: path.join(home, 'missing.md') });
    for (const name of Object.keys(PREFERENCE_SKILLS)) assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', name, 'SKILL.md')), name);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the route starts a map at once for an effort over several sessions, and wayfinder tracks it on request', async () => {
  const building = sectionOf((await renderHomes({ PREFS_ROUTE: 'yes' }))['running-workers'], 'Building something new');
  assert.match(building, /If the effort takes more than one session, start a map at once without being asked and show it\./);
  assert.match(building, /When the user types \/wayfinder, wayfinder tracks the map as tickets\./);
});

test('preparing the next stage while a review page waits is the user\'s choice, off by default', async () => {
  const line = 'While waiting, prepare the next stage, but do not start it before approval.';
  const off = sectionOf((await renderHomes())['review-pages'], 'Opening and sending');
  assert.match(off, /then stand by quietly until the user answers\./);
  assert.ok(!off.includes(line));
  const on = sectionOf((await renderHomes({ PREFS_PAGE_PREPARE_NEXT: 'yes' }))['review-pages'], 'Opening and sending');
  assert.match(on, /then stand by quietly until the user answers\./);
  assert.ok(on.includes(line));
  assert.ok(on.indexOf(line) > on.indexOf('stand by quietly'), 'the line follows the page-first rule');
  assert.ok(!(await render({ PREFS_PAGE_PREPARE_NEXT: 'yes', PREFS_PAGE_FIRST: 'no' })).includes(line));
});

test('the Simplified Technical English style is a choice that adds its rules and keeps outward writing out', async () => {
  const ctx = await answer();
  assert.equal(ctx.get('PREFS_WRITING_STYLE'), 'plain');
  assert.doesNotMatch(await render(), /Simplified Technical English/);
  const tone = sectionOf((await renderHomes({ PREFS_WRITING_STYLE: 'ste' })).core, 'House style');
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
  const gaps = sectionOf((await renderHomes({ PREFS_GRILL_ON_GAPS: 'yes' })).core, 'Decisions');
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
async function installInto(home, given, values = {}) {
  const answers = new Map(Object.entries({ PREFS_TARGETS: 'claude,firstmate', PREFS_DECISIONS: 'chat', ...given }));
  const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun: false, interactive: false, answers, prompter: null, repoRoot });
  ctx.beginModule('preferences');
  for (const q of preferences.questions) if (!q.when || q.when(ctx)) await ctx.ask(q);
  // Answers of the firstmate and skills modules, which run before this one.
  Object.assign(ctx.values, { FIRSTMATE_HOME: path.join(home, 'fm'), SKILLS: ['workflow-playbook'] }, values);
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
    const captain = fs.readFileSync(path.join(home, 'fm', 'data', 'captain.md'), 'utf8');
    assert.match(captain, /- Another sessions paragraph\.\n$/, 'the private lines close captain.md too');
    for (const name of Object.keys(PREFERENCE_SKILLS)) {
      const skill = fs.readFileSync(path.join(home, '.claude', 'skills', name, 'SKILL.md'), 'utf8');
      assert.match(prefs, new RegExp(`^- ${name}: `, 'm'), `the core file points to ${name}`);
      // captain.md holds every skill's rules, so Firstmate needs no skills.
      for (const line of skill.split('\n').filter((l) => l.startsWith('- '))) assert.ok(captain.includes(line), line);
      assert.doesNotMatch(skill, /Sessions rule|Everywhere rule/, 'private lines stay in the core file');
    }
    const brief = fs.readFileSync(path.join(home, 'fm', 'config', 'brief-include.md'), 'utf8');
    assert.match(brief, /- Workers rule\./);
    assert.ok(brief.includes(path.join(home, '.claude', 'skills', 'workflow-playbook', 'principles', 'bin', 'principle-check.mjs')), 'the brief names the installed checker');
    assert.match(fs.readFileSync(path.join(home, 'fm', 'data', 'captain-shared.md'), 'utf8'), /- Second mates rule\./);
    const again = (await installInto(home, { PREFS_PRIVATE_RULES: file })).out;
    assert.equal((again.match(/is already up to date/g) || []).length, 4 + Object.keys(PREFERENCE_SKILLS).length, again);
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

test('the generated block goes after the home lines once, replaces only itself, and refuses a broken marker', () => {
  const own = '## Our own rule\n\n- Keep this.\n';
  const first = mergeBriefBlock(own, '## Building\n\n- One.\n');
  assert.ok(first.startsWith(own), first);
  assert.ok(first.endsWith(`${BRIEF_BLOCK_END}\n`), first);
  const after = `${first}\n- Added later by hand.\n`;
  const second = mergeBriefBlock(after, '## Building\n\n- Two.\n');
  assert.equal(second, after.replace('- One.', '- Two.'));
  assert.equal(mergeBriefBlock(second, '## Building\n\n- Two.\n'), second);
  assert.equal(mergeBriefBlock('', '- Only.\n'), `${BRIEF_BLOCK_START}\n\n- Only.\n\n${BRIEF_BLOCK_END}\n`);
  assert.throws(() => mergeBriefBlock(`${BRIEF_BLOCK_START}\n- no end\n`, '- x\n'), /missing or misplaced marker/);
});

test('every local second-mate home in the registry gets the worker lines as a block around its own lines', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const mate = path.join(home, 'homes', 'mate-a');
    const fresh = path.join(home, 'homes', 'mate-b');
    const notHome = path.join(home, 'homes', 'not-a-home');
    for (const dir of [mate, fresh]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.fm-secondmate-home'), '');
    }
    fs.mkdirSync(notHome, { recursive: true });
    const own = '## Our house style\n\n- A line this home wrote.\n';
    fs.mkdirSync(path.join(mate, 'config'));
    fs.writeFileSync(path.join(mate, 'config', 'brief-include.md'), own);
    fs.mkdirSync(path.join(home, 'fm', 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'fm', 'data', 'secondmates.md'),
      [
        `- mate-a - one domain (home: ${mate}; scope: a; projects: a; added 2026-01-01)`,
        `- mate-b - another domain (home: ${fresh}; scope: b; projects: b; added 2026-01-01)`,
        `- stray - no marker file (home: ${notHome}; scope: c; projects: c; added 2026-01-01)`,
        '- far - another machine (host: example; root: /srv; home: /srv/far; scope: d; projects: d; added 2026-01-01)',
        '',
      ].join('\n'),
    );
    const given = { PREFS_PRIVATE_RULES: path.join(home, 'missing.md'), PREFS_KUN: 'yes', PREFS_PRINCIPLE_CHECKS: 'yes' };
    const { out, ctx } = await installInto(home, given);
    assert.equal(ctx.record.failures.length, 0, out);
    const checker = path.join(home, '.claude', 'skills', 'workflow-playbook', 'principles', 'bin', 'principle-check.mjs');
    const main = fs.readFileSync(path.join(home, 'fm', 'config', 'brief-include.md'), 'utf8');
    for (const dir of [mate, fresh]) {
      const brief = fs.readFileSync(path.join(dir, 'config', 'brief-include.md'), 'utf8');
      assert.ok(brief.includes(main.trimEnd()), `${dir} carries the main home's lines`);
      assert.ok(brief.includes(checker), `${dir} names the principle checker`);
      assert.match(brief, /run \/kun once/, dir);
    }
    assert.ok(fs.readFileSync(path.join(mate, 'config', 'brief-include.md'), 'utf8').startsWith(own), 'the home keeps its own lines');
    assert.match(out, /not-a-home is not a second-mate home/);
    assert.ok(!fs.existsSync(path.join(notHome, 'config')));

    // A changed answer replaces only the block, and a second identical run changes nothing.
    await installInto(home, { ...given, PREFS_KUN: 'no' });
    const changed = fs.readFileSync(path.join(mate, 'config', 'brief-include.md'), 'utf8');
    assert.ok(changed.startsWith(own), changed);
    assert.doesNotMatch(changed, /run \/kun once/);
    assert.equal(changed.split(BRIEF_BLOCK_START).length, 2, 'one block only');
    const again = (await installInto(home, { ...given, PREFS_KUN: 'no' })).out;
    assert.match(again, new RegExp(`${path.join(mate, 'config', 'brief-include.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is already up to date`));
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a dry run lists every second-mate home include it would write', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const mate = path.join(home, 'homes', 'mate-a');
    fs.mkdirSync(mate, { recursive: true });
    fs.writeFileSync(path.join(mate, '.fm-secondmate-home'), '');
    fs.mkdirSync(path.join(home, 'fm', 'data'), { recursive: true });
    fs.writeFileSync(path.join(home, 'fm', 'data', 'secondmates.md'), `- mate-a - one domain (home: ${mate}; scope: a; projects: a; added 2026-01-01)\n`);
    const answers = new Map(Object.entries({ PREFS_TARGETS: 'firstmate', PREFS_DECISIONS: 'chat', FIRSTMATE_HOME: path.join(home, 'fm'), PREFS_PRIVATE_RULES: path.join(home, 'missing.md') }));
    const ctx = new Context({ platform: { ...detectPlatform(), home }, dryRun: true, interactive: false, answers, prompter: null, repoRoot });
    ctx.beginModule('preferences');
    for (const q of preferences.questions) if (!q.when || q.when(ctx)) await ctx.ask(q);
    const out = await capture(() => preferences.install(ctx));
    assert.ok(out.includes(`would write ${path.join(mate, 'config', 'brief-include.md')}`), out);
    assert.ok(!fs.existsSync(path.join(mate, 'config')), 'a dry run writes nothing');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('without the firstmate module in the run, the saved Firstmate home is used, not ~/firstmate',{ skip: process.platform === 'win32' }, async () => {
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
    assert.ok(fs.readFileSync(path.join(home, 'fm', 'data', 'captain.md'), 'utf8').includes(taste.trimEnd()), 'captain.md has the same taste section');
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

// The hide tray (templates/preferences/hide-kit.js): its own file, inlined in the card template.
const KIT = path.join(repoRoot, 'templates/preferences/hide-kit.js');

test('the hide tray script is valid JavaScript, faint by default, and safe to inline', () => {
  const r = spawnSync(process.execPath, ['--check', KIT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const kit = fs.readFileSync(KIT, 'utf8');
  assert.match(kit, /const mode = opts\.mode \|\| 'ghost';/, 'hidden parts stay faint unless a page asks otherwise');
  assert.match(kit, /\[data-hk-hidden="ghost"\]\{opacity:\.18!important;outline:2px dashed/);
  assert.match(kit, /tag: 'hide-list'/);
  assert.match(kit, /setAttribute\('data-lavish-ui', ''\)/, 'Lavish leaves the tray out of annotation and snapshots');
  // Lavish inserts its own script at the first closing body tag, even inside a comment, and a
  // closing script tag would end the inlined block early.
  assert.doesNotMatch(kit, /<\/?(body|head|script)\b/i);
});

test('the card template carries an exact copy of the hide tray, docked under the canvas', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'templates/preferences/decision-cards.html'), 'utf8');
  const m = html.match(/\/\/ HIDE-KIT START \(a copy of hide-kit\.js\)\n([\s\S]*?)\/\/ HIDE-KIT END\n/);
  assert.ok(m, 'the inlined block is marked');
  assert.equal(m[1], fs.readFileSync(KIT, 'utf8'), 'the inlined copy matches templates/preferences/hide-kit.js');
  assert.match(html, /<div class="hide-slot" id="hide-slot"><\/div>/);
  assert.match(html, /HideKit\.attach\(\$\('canvas'\), \{\s*trayParent: \$\('hide-slot'\)/);
  assert.match(html, /hideKit\.refresh\(\);\n\}/, 'a redrawn canvas gets its hidden parts back');
});

test('the review-page rules tell every prototype, slide or doc page to carry the hide tray', () => {
  const text = renderPreferenceSkills((key) => ({ PREFS_DECISIONS: 'both' })[key], { cardsPath: CARDS, hideKitPath: '/x/hide-kit.js' })['review-pages'];
  assert.match(sectionOf(text, 'Building the page'), /Every Lavish prototype, slide or doc page carries the hide tray[^\n]*`\/x\/hide-kit\.js`[^\n]*`HideKit\.attach\(document\.body\)`/);
  const get = (key) => ({ PREFS_DECISIONS: 'tool' })[key];
  const none = [renderPreferences(get, { cardsPath: null, hideKitPath: null }), ...Object.values(renderPreferenceSkills(get, { cardsPath: null, hideKitPath: null }))].join('\n');
  assert.doesNotMatch(none, /hide tray/);
});

test('a dry run plans the card template, the hide tray script and the five preference skills', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-kit-'));
  try {
    const answers = path.join(home, 'answers.env');
    fs.writeFileSync(answers, 'MODULES=preferences\nPREFS_TARGETS=claude\nPREFS_DECISIONS=both\n');
    const r = spawnSync(process.execPath, [path.join(repoRoot, 'lib/installer.mjs'), '--dry-run', '--yes', '--platform', 'linux', '--answers', answers], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), NO_COLOR: '1' },
      stdin: 'ignore',
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const dir = path.join(home, '.config', 'ai-workstation-setup');
    assert.ok(r.stdout.includes(`would write ${path.join(dir, 'decision-cards.html')}`), r.stdout);
    assert.ok(r.stdout.includes(`would write ${path.join(dir, 'hide-kit.js')}`), r.stdout);
    for (const name of Object.keys(PREFERENCE_SKILLS)) {
      assert.ok(r.stdout.includes(`would write ${path.join(home, '.claude', 'skills', name, 'SKILL.md')}`), `${name}: ${r.stdout}`);
    }
    assert.ok(!fs.existsSync(dir) && !fs.existsSync(path.join(home, '.claude')), 'a dry run writes nothing');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a real run writes the hide tray script next to the card template', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-kit-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const { ctx } = await installInto(home, { PREFS_TARGETS: 'claude', PREFS_DECISIONS: 'both' });
    assert.equal(ctx.record.failures.length, 0);
    const dir = path.join(home, '.config', 'ai-workstation-setup');
    assert.equal(fs.readFileSync(path.join(dir, 'hide-kit.js'), 'utf8'), fs.readFileSync(KIT, 'utf8'));
    assert.match(fs.readFileSync(path.join(dir, 'decision-cards.html'), 'utf8'), /HIDE-KIT START/);
    assert.match(fs.readFileSync(path.join(home, '.claude', 'skills', 'review-pages', 'SKILL.md'), 'utf8'), new RegExp(`Paste \`${path.join(dir, 'hide-kit.js').replace(/[.\\]/g, '\\$&')}\``));
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
