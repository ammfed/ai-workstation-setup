// Turns preference answers into Markdown rules. Pure: `get(key)` returns an answer.
// The rules are split by how often a session needs them: a short core file that loads in every
// session (`renderPreferences`), and five skills that load when their kind of work comes up
// (`renderPreferenceSkills`). Firstmate's captain.md holds both (`renderCaptain`).
// docs/working-preferences.md lists every rule, why it exists and where it lives.

// A plain-English house style based on Simplified Technical English (ASD-STE100), adapted.
const STE_RULES = [
  'House style for everything written to the user (instructions, warnings, questions, action items, status lines), based on Simplified Technical English (ASD-STE100):',
  'One instruction per sentence, as a command. Put the condition first, then the command ("If the check fails, stop and tell me.").',
  'Use active voice and name who acts.',
  'Keep sentences short: 20 words or fewer in steps, 25 or fewer in explanations. Keep paragraphs to six sentences or fewer, one topic each.',
  'Use simple tenses (present, past, "will"). Keep the small words such as "the" and "to"; no telegraphic shorthand.',
  'Use one word for one thing every time (for example start, stop, finish, examine, undo, pull request). Do not swap in synonyms for variety.',
  'Use verbs, not noun phrases ("check", not "perform a check of"). No semicolons and no em dashes.',
  'In a warning, state the risk in plain words first, then the command, then what can go wrong.',
  'Relax the style for a warm opening or closing line, the reason behind a recommendation, and short acknowledgements, but never inside an instruction or a warning. Vary sentence length within the limits so it does not read as monotone.',
  'The house style does not apply to anything written as the user for other people (documents, emails, decks, pull request text): those follow the rules for outward writing.',
];

// Rules written both for sessions and for Firstmate's workers, so the two never drift apart.
const TEST_FIRST_RULE =
  'Build product code test-first at the seams the spec names (tdd, codebase-design skills when installed). Prototypes, docs and config are not test-first.';
const KUN_RULE =
  'At the start of real work (a feature, a bug, a refactor, a plan, research or an explainer), run /kun once (the kun skill, when installed) and follow the route its ENTRY.md gives for that kind of work. ' +
  'Later checks in the same session reuse that load; run it again only in a new session or after compaction. ' +
  'Skip it for small clear tasks (a typo, a version bump, a config tweak), status replies and helper subagents.';
// Written to worker briefs only when a vault is configured; sessions get the same lines from the
// second-brain rules file. It names the search tool that rules file names, bin/search, only when
// second-brain installed it.
function vaultRule(vault) {
  if (!vault) return null;
  const search = `search it with \`rg\`${vault.search ? ' or `bin/search`' : ''}`;
  return `Before you start, check the notes vault at \`${vault.path}\` for past decisions, findings and rulings on the work: find a note by its folder and file name, or ${search}. Trust the newest dated line, and check an open item against the live tracker before you act on it.`;
}
const GLOSSARY_RULE =
  'Before building, read GLOSSARY.md and docs/adr/ if they exist. Add new terms and decision records in the same change that introduces them. Start these files in any project, but only when a term or a hard-to-reverse decision comes up.';

function delegateRule(get) {
  const cli = get('PREFS_DELEGATE_RETRIEVAL');
  if (!cli) return '';
  const fallback = get('PREFS_DELEGATE_FALLBACK_MODEL');
  return `Hand retrieval-heavy work (large document sweeps, broad web reading, bulk page reads) to \`${[cli, get('PREFS_DELEGATE_MODEL') && `--model ${get('PREFS_DELEGATE_MODEL')}`].filter(Boolean).join(' ')}\` and reason over what it returns. Keep decisions and code changes with the main agent.${
    fallback ? ` If it reports a Gemini quota error, use \`${[cli, `--model ${fallback}`].join(' ')}\` instead.` : ''
  }`;
}

const bullets = (title, lines) => {
  const kept = lines.filter(Boolean);
  return kept.length ? `## ${title}\n\n${kept.map((l) => `- ${l}`).join('\n')}\n` : '';
};

const PRIVATE_NOTE = "From the user's private rules file. They are changed there and the installer re-run, not edited here.";
const TASTE_NOTE = "From the template's optional taste preset (PREFS_TASTE_PRESET). Turn it off and re-run the installer to remove these lines.";

// The taste preset section: its Everywhere lines plus the lines of `also` (sessions or workers).
function tasteSection(tastePreset, also) {
  const lines = [...(tastePreset?.everywhere ?? []), ...(tastePreset?.[also] ?? [])];
  return lines.length ? `## Taste preset\n\n${TASTE_NOTE}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n` : '';
}

// Firstmate's config/brief-include.md, appended to every worker brief: the house style for what
// workers write to firstmate (never the deliverable itself), the vault-first line, the helper-model rule, the standing
// build rules, the principle checker before done, the taste preset's Everywhere lines when it is on,
// and the private Everywhere and Workers lines.
// Empty when none of them applies. `checkerPath` is the installed principle checker, or null.
export function renderBriefInclude(get, { checkerPath, privateRules, tastePreset, vault } = {}) {
  const parts = [];
  if (get('PREFS_WRITING_STYLE') === 'ste') {
    parts.push(
      [
        '## Writing style: Simplified Technical English (house style)',
        '',
        'Write your status lines, reports, questions and notes for firstmate in this style (based on ASD-STE100, adapted):',
        ...STE_RULES.slice(1, 8).map((rule, i) => `${i + 1}. ${rule}`),
        '',
        'This style does not apply to the deliverable itself when it is written for other people (product copy, user-facing text, documents written as the user, code, commit messages, pull request descriptions): follow the project\'s and the brief\'s own rules there.',
        '',
      ].join('\n'),
    );
  }
  parts.push(bullets('Past decisions', [vaultRule(vault)]));
  parts.push(bullets('Helper models', [delegateRule(get)]));
  parts.push(bullets('Building', [get('PREFS_KUN') && KUN_RULE, get('PREFS_TEST_FIRST') && TEST_FIRST_RULE, get('PREFS_GLOSSARY_ADR') && GLOSSARY_RULE]));
  const checker = checkerPath && (/\s/.test(checkerPath) ? JSON.stringify(checkerPath) : checkerPath);
  parts.push(
    bullets('Principle checks', [
      get('PREFS_PRINCIPLE_CHECKS') &&
        checker &&
        `Before you report done on anything with a screen (a page, an app screen, a prototype, a document layout), run \`node ${checker} <its files or folder>\`. Add \`--phone\` when it is built for other people. Fix every \`fail\` line first. List each \`check\` line in your report for the reviewer. The full list is in principles/checks.md beside the checker.`,
    ]),
  );
  parts.push(tasteSection(tastePreset, 'workers'));
  const own = [...(privateRules?.everywhere ?? []), ...(privateRules?.workers ?? [])];
  if (own.length) parts.push(`## Private rules\n\n${PRIVATE_NOTE}\n\n${own.map((l) => `- ${l}`).join('\n')}\n`);
  return parts.filter(Boolean).join('\n');
}

// Firstmate's data/captain-shared.md in the main home, which every second mate reads (read-only
// there): the private Everywhere and Second mates lines. Empty when there are none.
export function renderCaptainShared(privateRules) {
  const lines = [...(privateRules?.everywhere ?? []), ...(privateRules?.['second mates'] ?? [])];
  if (!lines.length) return '';
  return `# Shared captain preferences

<!-- memory tiers: see the stow skill -->

Main-authoritative: the main Firstmate home owns this file, and every second-mate home gets a
read-only copy. Do not edit it in a second-mate home. Route a new preference to the main
Firstmate through a marked status line or a document pointer.

Written by ai-workstation-setup from the Everywhere and Second mates headings of your private
rules file. Change that file and re-run the installer, which asks before replacing a changed copy.

${lines.map((l) => `- ${l}`).join('\n')}
`;
}

// The on-demand skills, in the order the core file lists them. `title` heads the skill file,
// `description` is what the agent sees at startup to decide when to load it, and `when` is the
// core file's one-line pointer to it.
export const PREFERENCE_SKILLS = {
  'writing-for-others': {
    title: 'Writing for other people',
    description:
      "The user's rules for anything written for other people: documents, emails, decks, pull request text, published pages, copy, text in another language, and questionnaires for a colleague or vendor. Use before drafting or editing any of these.",
    when: 'before writing anything other people will read, or text in another language',
  },
  'status-and-away': {
    title: 'Status and away mode',
    description:
      "The user's rules for status and progress replies, the daily nothing-forgotten check, live-state checks, the order of queued work, and away mode. Use for any status, progress or \"where are we\" reply, and whenever the user says they are leaving, going to bed, offline or back.",
    when: 'for any status or progress reply, and when the user says they are away or back',
  },
  'review-pages': {
    title: 'Review pages',
    description:
      "The user's rules for review pages (Lavish decision-card pages) and prototypes: when to use a page, the card template, layout, previews, screenshot checks, opening and sending the link, and collecting answers. Use whenever a decision, plan, report, prototype or look-and-feel change goes in front of the user.",
    when: 'before building, checking or sending a review page, or showing the user a prototype',
  },
  'running-workers': {
    title: 'Running workers and building',
    description:
      "The user's rules for briefing, supervising and landing work done by worker agents, and for building something new: research first, one whole brief, validation, pull requests, public repositories and deadlines. Use when briefing a worker or helper, starting a build, or opening or landing a pull request.",
    when: 'before briefing a worker or helper, starting a build, or landing a pull request',
  },
  'models-and-research': {
    title: 'Models and research',
    description:
      "The user's rules for choosing a model and effort, handing work to helper models, quota limits, and research: browsers, sources, current products and models, and prices. Use before delegating work or choosing a model, and before any research or any answer about current tools, models, products or prices.",
    when: 'before choosing a model, handing work to a helper, or doing research or naming current tools, products or prices',
  },
};

// Every rule, placed in its home: 'core' or one of PREFERENCE_SKILLS. Each home keeps its
// sections in the order they are added; empty sections and empty homes are left out.
function placeRules(get, { cardsPath, hideKitPath, decisionsPath } = {}) {
  const homes = {};
  const add = (home, title, lines) => {
    const kept = lines.filter(Boolean);
    if (!kept.length) return;
    const sections = (homes[home] ??= []);
    const found = sections.find((s) => s.title === title);
    if (found) found.lines.push(...kept);
    else sections.push({ title, lines: kept });
  };

  const status = get('PREFS_STATUS');
  const days = get('PREFS_STALE_DAYS') || '2';
  const decisions = get('PREFS_DECISIONS');
  const cards = decisions === 'cards' || decisions === 'both';
  const allCards = cards && cardsPath && get('PREFS_PAGES_ALL_CARDS');
  const grill = get('PREFS_GRILL');
  const browser = get('PREFS_RESEARCH_BROWSER') === 'separate';
  const away = get('PREFS_AWAY_MODE');
  const act = get('PREFS_AUTONOMY') === 'act';
  const habits = get('PREFS_HABITS');
  const merge = get('PREFS_MERGE');
  const routing = get('PREFS_MODEL_ROUTING');

  // Core: what almost every session needs.
  add('core', 'How to reply', [
    get('PREFS_PLAIN_LANGUAGE') &&
      'Write in plain, natural, friendly words, like a capable colleague talking. Explain a thing before naming it. No internal codes, invented jargon or arrow shorthand in place of sentences.',
    get('PREFS_PLAIN_LANGUAGE') && 'Keep replies short. Go into detail only when asked or when a decision needs it.',
    get('PREFS_NO_NARRATION') &&
      'Give the result, not a commentary on your own steps. A few words between tool calls is fine, but no private plans or checklists. If something failed or is still running, say so as a fact about the work.',
    get('PREFS_NO_EM_DASHES') && 'Do not use em dashes. Use a period, a comma, or a plain conjunction instead.',
    habits && "End every reply with the next actions, the user's first.",
    habits && 'When the user says they are lost or a reply is too long, give the shortest plain answer, with no list of what was checked.',
    habits && 'When asked for an opinion, give a real one with its reason.',
    get('PREFS_CALM_WORD') &&
      `When the user says "${get('PREFS_CALM_WORD')}", switch to a calm mode: batch tool calls, stop in-between updates, and give only the answer.`,
    get('PREFS_HONEST_NUMBERS') &&
      'When a number is uncertain, give a range or say "not yet known", never a single made-up figure. Charts are plain bars or small multiples on a shared scale, never radar or gauge charts.',
    get('PREFS_LINK_DELIVERABLES') &&
      'Every finished item that produced something carries a link to it: a full https URL for anything online, an absolute path for a local file.',
  ]);
  add('core', 'House style', get('PREFS_WRITING_STYLE') === 'ste' ? STE_RULES : []);

  add('core', 'Decisions', [
    'Bring the user genuine decisions only, never tool permissions or command mechanics.',
    decisions === 'cards' &&
      'Put decisions on a Lavish decision-card page (lavish-axi): one decision at a time with "1 of N" and a progress fill, a visual preview for every option, a short "why" kept closed, and every answer sent together after a one-screen recap.',
    decisions === 'both' &&
      'Ask quick questions with the question tool, one at a time, with a preview on every option and a recommendation. Put larger or visual decisions on a Lavish decision-card page.',
    decisions === 'tool' && 'Ask decisions with the question tool, one question at a time, with a preview on every option.',
    decisions === 'chat' && 'Ask decisions in chat, one at a time, with a short named list of options and the recommendation first.',
    decisions !== 'chat' && get('PREFS_YES_NO_IN_CHAT') && 'Ask a simple yes-or-no question in plain chat, not on a review page.',
    !cards && get('PREFS_CHECK_ANSWERS_FIRST') &&
      'Before describing a question as still open, check whether the user already answered it. Never assume it is unanswered.',
    get('PREFS_ASK_BEFORE_CLOSING') &&
      `When work finishes, ask whether to close the finished or idle agents, sessions and review pages. Never close one unasked, and never leave a finished one open silently.${browser ? ' Research tabs the agent opened follow the research rule.' : ''}`,
    act &&
      "For ordinary judgment calls within a direction the user already set (a library, a helper tool, an implementation detail), decide and report the outcome instead of asking first. When unsure whether a call is the user's, act and flag it.",
    act &&
      'Always ask first for a decision only the user can make, a credential or access only they hold, or anything destructive, irreversible or security-sensitive.',
    act &&
      'For a process or tooling question the user cannot answer, read the primary source (the official docs or the upstream repository), decide, and say in one line what was chosen and why. Product and stakeholder decisions stay with the user.',
    get('PREFS_AUTONOMY') === 'ask' && 'Ask before acting on judgment calls, including small implementation choices.',
    decisionsPath &&
      `Keep the user's decisions in \`${decisionsPath}\`: record each ruling the moment it is made, with its date. If it is not in the file, it is not decided, and the newest ruling wins.`,
    decisionsPath &&
      'List what the user ruled out in the same file and never offer it again. Record a "not yet" as the condition that brings it back (for example "when real data exists"), not as a date, and check that condition before raising it again.',
    grill === 'every' &&
      'Every round of questions to the user runs the grilling method: map the open decisions, ask only the ones that can be answered now, give a recommendation on each, look facts up instead of asking for them, and ask the next round only after the answers.',
    grill === 'every' &&
      'Keep it balanced. When the intent and the request are clear enough, go ahead without asking. Ask only where a real gap would change the result, and never loop with questions for their own sake.',
    grill === 'gaps' &&
      'Question the user hard about a plan only when it has a real gap: an underspecified instruction, an untested premise, or something irreversible whose reasoning was never tested. Never as the default way to ask.',
  ]);

  add('core', 'Focus and priorities', [
    habits && 'When the user is working on one topic, keep status and questions to that topic and park the rest.',
    habits && '"Check X" is a question, not a go-ahead to widen the work. Ask before adding to a pass.',
    habits && 'Never hand the user a menu of what to run next. Choose, start, and report what started and what waits.',
    get('PREFS_CAPTURE_IDEAS') &&
      'When the user shares an idea, capture it and weigh it against the current priorities: fold it into current work when it fits, otherwise park it with a clear trigger that brings it back. Say in one line where it landed, and if asked, give a real opinion on it with the reasoning.',
    get('PREFS_ORIENT') &&
      'End every project reply with one plain line that says where the work is on the map, the next step, who takes it and when. Name the step in words, never as a count such as "step 3 of 6". Say when as an event or a day, not a clock time. When the user takes the next step, say exactly what they need to do and link to it.',
    get('PREFS_FINISH_FIRST') &&
      'Prefer finishing over expanding. Once something works, stop instead of proposing the next improvement, and suggest cutting scope at most once.',
    get('PREFS_FINISH_FIRST') &&
      'State the case against a risky choice once, with the consequence named. If the user keeps it, go ahead and do not raise it again.',
  ]);

  add('core', 'Safety', [
    "Never put secrets, tokens, passwords or personal data in files, commits, pull requests, pages or logs. Secrets come from environment variables or the tool's own sign-in.",
    merge === 'explicit' &&
      'Merge a pull request only when the user explicitly says to merge that pull request. Approving the work is not a merge instruction.',
    merge === 'green' &&
      'You may merge your own pull requests once every check passes. Still ask before anything destructive, irreversible or security-sensitive.',
    get('PREFS_VERIFY_CAUSE') &&
      'Do not name a cause for a failure unless you checked it against evidence. Otherwise report the failure and say the cause is unknown.',
    get('PREFS_STOP_DIGGING') &&
      'A request to investigate is not proof that something is broken. Confirm the problem from real evidence first, or ask what the user saw. If about two checks turn up nothing, stop and report what is known.',
    get('PREFS_BLOCKED_COMMANDS') &&
      'When a permission check blocks an install, a schedule, a service change, a push or a pull request, do not look for a way around it. Record the exact one-line command for the user to run, say what it is for, and carry on with the rest.',
    get('PREFS_PRIVATE_STAYS_LOCAL') &&
      "Private chats, and anything captured from the user's own sessions, never go to an outside model or service, including for a second opinion.",
    get('PREFS_PAUSE_WORD') &&
      `When the user says "${get('PREFS_PAUSE_WORD')}", stop every running agent in place, confirm each one stopped, and hold until the user says to resume. A new full task request right after a pause counts as the resume.`,
    habits && 'A statement is a claim until something shows it. Show the case that can fail, not only the passing one.',
    habits && 'When the user says a record is outdated, check it against reality before defending it.',
    'Say plainly when something was reasoned about rather than tested.',
  ]);

  add('core', 'Before you start', [get('PREFS_KUN') && KUN_RULE]);

  // writing-for-others
  add('writing-for-others', 'Writing as the user', [
    get('PREFS_OUTWARD_AS_USER') &&
      'Anything that goes to other people (documents, emails, pull request text, published pages) is written as the user, in their professional voice.',
    get('PREFS_OUTWARD_AS_USER') && 'Leave out agent and tooling labels, internal ids, source-type tags and speaker notes.',
    get('PREFS_NATURAL_TRANSLATION') &&
      'When writing in another language, write it the way a native speaker in that field would, with the terms they actually use. Never translate literally from English.',
    get('PREFS_WRITING_PRINCIPLES') && 'Lead with the real point.',
    get('PREFS_WRITING_PRINCIPLES') && 'Give each strong claim its reason or evidence, and state uncertainty plainly.',
    get('PREFS_WRITING_PRINCIPLES') && 'No corporate filler, and no hedging that hides the actual view.',
    get('PREFS_WRITING_PRINCIPLES') && 'Before building a deck or document, agree its one-sentence point with the user.',
    get('PREFS_WRITING_PRINCIPLES') && 'Then draft it as plain paragraphs, and add a visual only where it is the evidence.',
    get('PREFS_ONE_DESIGN_SYSTEM') &&
      'When several design systems are available, use the one that matches the artifact type (for example documents, app screens, websites). Never mix two in one artifact.',
    get('PREFS_COPY_SECOND_OPINION') && 'For copywriting and translation, get a refinement pass from a second AI model.',
    get('PREFS_COPY_SECOND_OPINION') && 'Send it only the text being refined, never secrets, credentials or whole documents.',
    get('PREFS_COPY_SECOND_OPINION') && 'Decide the final wording yourself against these rules.',
  ]);
  add('writing-for-others', 'Questions for other people', [
    grill === 'every' && 'A gap only someone else can fill (a colleague, a vendor) becomes a short questionnaire for that person, not a question to the user.',
  ]);

  // status-and-away
  add('status-and-away', 'Status replies', [
    status === 'needs-you' && 'Open every status reply with one line of headline counts (for example "3 need you, 5 finished, 1 at risk").',
    status === 'needs-you' &&
      'Then NEEDS YOU: only what the user alone can do, ranked by impact, one line each with a rough time cost and one link. Fold older open review pages into one line.',
    status === 'needs-you' && 'Then AT RISK: anything stuck or slipping, with what it costs the user.',
    status === 'needs-you' &&
      'Then always a table with To do, Doing and Done as three columns side by side, one row per project, short cells. Done holds only what finished since the last status.',
    status === 'needs-you' && 'End with one Links line: the full link of each Done item.',
    status === 'needs-you' && 'Leave out any empty part except the table, and leave out how the work was done and work that did not change.',
    status === 'board' &&
      'Open every status reply with the current work as one table whose three columns sit side by side: TODO, DOING, DONE. Each column lists its own items, one short line each. Never three stacked lists or three separate rows.',
    status === 'actions' &&
      "Answer a status request with a very short list of action items, the user's first, then point to the full report (its path or link) instead of repeating it.",
    status === 'board' &&
      "Then group what is left by who acts: the user's block labelled YOU, the agent's labelled with its own role name (for example FIRST MATE), never ME.",
    status === 'board' && 'Use small text bars and boxes where they carry meaning, and nothing decorative.',
    status === 'brief' && 'Open every status reply with the answer in a sentence or two.',
    status === 'brief' && 'Then give brief action items, grouped by who acts: the user first, then the agent.',
    status !== 'none' && 'Show progress as counts like "3 of 5". A word always carries the state, never colour alone.',
    get('PREFS_DAILY_CHECK') && 'Once a day, at the top of the first status, run a nothing-forgotten check.',
    get('PREFS_DAILY_CHECK') &&
      `Show anything real it finds: review-page answers not yet collected, anything waiting on the user for more than ${days} days without being brought back, and standing rules with no evidence that they ran.`,
    get('PREFS_DAILY_CHECK') && 'Verify each item before calling it dropped.',
  ]);
  add('status-and-away', 'Live state and the queue', [
    get('PREFS_FLEET_WORKFLOW') && 'Workers report a status line only at phase changes and when finished, blocked or in need of a decision.',
    get('PREFS_FLEET_WORKFLOW') && 'Read the live state (status files, session lists) before reporting on it, and never guess.',
    get('PREFS_FLEET_WORKFLOW') && 'Before calling any work in progress, in final checks or finished, check its live state first.',
    get('PREFS_FLEET_WORKFLOW') && 'After each merge, check the queue. When a step of a multi-step plan lands, start the next step at once.',
    get('PREFS_FLEET_WORKFLOW') && 'Raise any wait longer than 30 minutes to the user within the hour.',
    get('PREFS_RESEQUENCE') && 'Reorder queued work by what blocks what and what unblocks the nearest deadline, without asking first.',
    get('PREFS_RESEQUENCE') && 'Then tell the user the new order and why. Still ask about anything only they can decide.',
  ]);
  add('status-and-away', 'Away mode', [
    away && 'When the user says they are away (commuting, asleep, offline for a while), keep going on work that is already approved.',
    away && 'While they are away, hold every new decision and anything irreversible, and send no routine progress messages.',
    away && 'When they return, open with a short return brief: what finished (with links), what waits on them, what is next.',
  ]);

  // review-pages
  add('review-pages', 'When to use a page', [
    get('PREFS_FLEET_WORKFLOW') && 'A review page is for a genuine decision, a look-and-feel change, or a plan the user should judge from the artifact.',
    get('PREFS_FLEET_WORKFLOW') && 'Status, yes-or-no questions and routine implementation choices do not get a review page.',
    get('PREFS_PREVIEW_BEFORE_BUILD') &&
      'When the user asks for a change to how something looks or feels, show it on a review page before building it, the same way as a decision.',
  ]);
  add('review-pages', 'Building the page', [
    allCards && `Every Lavish page starts from the card template at \`${cardsPath}\`: decisions, reports, plans, explainers and lessons alike.`,
    allCards && 'Show one card at a time with a visual beside it and minimal text. A card with nothing to choose gets a Next button instead of options.',
    allCards && "The template overrides lavish-axi's own design default and the look of boards that a skill brings with it. Use another look only when the user names one.",
    allCards && 'For a diagram on a page, use the diagram-design skill.',
    cards && cardsPath && !allCards && `Start each decision page from the template at \`${cardsPath}\`.`,
    cards && hideKitPath &&
      `Every Lavish prototype, slide or doc page carries the hide tray, so the user can hide parts and send the list back as "remove these". Paste \`${hideKitPath}\` into a script just before </body> and call \`HideKit.attach(document.body)\`. The card template already has it.`,
    cards && get('PREFS_PAGE_SIDE_BY_SIDE') &&
      'Lay a decision page out horizontally: the decision card on one side and a canvas showing the current decision visually on the other. Never stack them vertically.',
    cards && get('PREFS_PAGE_FLIP_PREVIEWS') &&
      'For any visual choice, give every option its own preview and let the user flip between all of them (buttons or a dropdown). The canvas follows the option they select.',
    cards && get('PREFS_PAGE_FLIP_PREVIEWS') && "Never show only the recommended option's visual.",
    get('PREFS_PAGE_MINIMAL_TEXT') &&
      'Keep page text to the minimum: a title, the question, short option labels. No fluff, no small helper text, no explaining the obvious.',
    get('PREFS_PAGE_MINIMAL_TEXT') &&
      'Let visuals carry the meaning. Use a visual only where it shows the point better than a sentence, and prefer real screenshots and worked examples over drawn mock-ups.',
    get('PREFS_PAGE_PHONE') &&
      'Every review page also reads well on a phone (390 px wide): the card and its picture stack with no empty filler, body text is at least 14 px, and a wide diagram gets a phone version (for example a vertical list of steps) instead of shrinking to tiny labels.',
    get('PREFS_PAGE_PHONE') && 'Check a 390 by 844 screenshot before sending the link. The laptop layout stays as it is.',
    get('PREFS_PAGE_WIDE_HEADER') &&
      'Give review pages a generous header: a large title and intro text spread across the full page width, not squeezed into a narrow column.',
    get('PREFS_PROTOTYPE_CHECK') &&
      `Before the user sees a prototype, open it in the agent's browser at the user's target screen size first, then at laptop width${get('PREFS_PAGE_PHONE') ? ' and at phone width (390 px)' : ''}. Check that font sizes and column positions stay the same on every tab. Fix broken layout, unclear labels and dead ends first.`,
  ]);
  add('review-pages', 'Opening and sending', [
    cards && 'Create review pages without launching a browser tab (`--no-open`, or `LAVISH_AXI_NO_OPEN=1`).',
    cards && 'Never re-run the open command just to refresh a page; the running page already updates.',
    cards && "Once the page is checked, open it once in the user's browser at hand-over and give the link: a page that is only linked is easily missed.",
    cards && away && 'While the user is away, open nothing; the link goes into the return brief.',
    cards && get('PREFS_PAGE_CHECK_BEFORE_SEND') &&
      "Before sending a page link, open the page in the agent's own browser and confirm by screenshot that its content actually shows: a page can load and still be stuck, blank or washed out. Fix it first, then send the link.",
    get('PREFS_PAGE_CHECK_BEFORE_SEND') && 'Always give the user the page link in chat, as a full URL.',
    get('PREFS_PAGE_FIRST') && 'When a decision waits on a page, build and check the page first, send the link, then stand by quietly until the user answers.',
    get('PREFS_PAGE_FIRST') && 'Do not ask the question anywhere else before the page is in front of them.',
    get('PREFS_PAGE_FIRST') && get('PREFS_PAGE_PREPARE_NEXT') && 'While waiting, prepare the next stage, but do not start it before approval.',
    get('PREFS_PAGES_TOGETHER') && 'When several review pages are in progress, hold the links until all open work is done. Keep giving brief status meanwhile.',
    get('PREFS_PAGES_TOGETHER') &&
      'Then check the pages against each other (each question asked once, dependencies in order, no clashing recommendations, one set of names), and send them together in the order to take them.',
  ]);
  add('review-pages', 'Answers', [
    cards && get('PREFS_CHECK_ANSWERS_FIRST') &&
      'Before calling a review page open, answered or unanswered, check whether the user already answered it. Never assume it is unanswered.',
    cards && get('PREFS_CHECK_ANSWERS_FIRST') &&
      '`lavish-axi` lists every session with its status and pending answers. `lavish-axi poll <file>` collects answers: leave it running, because answers stay queued until collected.',
    cards && get('PREFS_CHECK_ANSWERS_FIRST') && 'Never reopen a page the user ended unless they ask.',
    cards && get('PREFS_CHECK_ANSWERS_FIRST') &&
      'A page that says it ended, or a link that loads, does not mean answers were lost: read the session status and pending answers, and collect them with `lavish-axi poll <file>` first.',
  ]);

  // running-workers
  add('running-workers', 'Briefing and landing', [
    get('PREFS_FLEET_WORKFLOW') && 'Give each worker a brief that names the goal, the branch, where it reports and what done means.',
    get('PREFS_FLEET_WORKFLOW') && 'Work that can run in parallel goes to separate workers in separate worktrees.',
    get('PREFS_FLEET_WORKFLOW') &&
      "When the user must type in an agent's window, name the window by the labels the user sees on screen (for example the workspace and tab names), never by internal ids, and give the exact words to type.",
    get('PREFS_FLEET_WORKFLOW') && 'Each worker lands its work by opening a pull request and watching its checks until they are green. Merging follows the merge rule in working-preferences.md.',
    get('PREFS_FLEET_WORKFLOW') && 'Decisions go to the user only at genuine forks. Act on work that nothing blocks.',
    get('PREFS_FLEET_WORKFLOW') &&
      'A permission prompt, a refused tool call or a command that needs running by hand is never escalated as a decision: state the blocker once in one line and stop.',
  ]);
  add('running-workers', 'Building something new', [
    get('PREFS_BUILD_WHOLE_GOAL') &&
      'Before building something new, show the research and the user journeys on one review page, so the user decides from what they have seen.',
    get('PREFS_BUILD_WHOLE_GOAL') &&
      "Then give one builder the whole goal in a single brief (the user's words, the constraints, what done means) and let it run. Never feed a builder step by step.",
    get('PREFS_BUILD_WHOLE_GOAL') && 'Run the full validation pipeline once the first complete pass exists, not on every step.',
    get('PREFS_ROUTE') &&
      'Take a software project (building or changing an app, a tool or a codebase) through six steps, each with its skill when installed: ' +
        '1 Plan: write the idea down, judge fit and timing, and say so in one line. If the effort takes more than one session, start a map at once without being asked and show it. When the user types /wayfinder, wayfinder tracks the map as tickets. ' +
        '2 Decide: settle the open decisions in rounds of questions and record the answers (grilling, with domain-modeling for the glossary and decision records). ' +
        '3 Prototype: write a spec that names the test seams, with a throwaway prototype when the look or flow needs judging, and get it approved before building (prototype). Only the user starts to-spec, by typing /to-spec; until then write the spec yourself and offer /to-spec in one line. ' +
        '4 Breakdown: cut a spec too big for one change into tickets with their blocking edges. Only the user starts to-tickets, by typing /to-tickets; until then cut the tickets yourself and offer /to-tickets in one line. ' +
        '5 Build: one builder builds the whole spec test-first (tdd, codebase-design). ' +
        '6 Ship: validate, open a pull request, and merge once approved (no-mistakes).',
    get('PREFS_ROUTE') &&
      'Short paths: a small clear change goes Plan, Build, Ship. A bug goes Plan, find the cause, Build with the reproduction as the regression test, Ship. Documents, review pages, research and one-off tasks do not take the route.',
    get('PREFS_TEST_FIRST') && TEST_FIRST_RULE,
    get('PREFS_GLOSSARY_ADR') && GLOSSARY_RULE,
    get('PREFS_MODEL_GUIDE') && "When a model is named for a task, read that vendor's official prompting guide first and brief the model the way it says.",
  ]);
  add('running-workers', 'Repositories and deadlines', [
    get('PREFS_PUBLIC_REPOS') && 'In a public repository, commit with a no-reply identity and add no trailer that carries an email address.',
    get('PREFS_PUBLIC_REPOS') && 'Pull request text in a public repository is a short plain summary that names no private people, clients, projects or internal tooling.',
    get('PREFS_PUBLIC_REPOS') && 'In a public repository, run the privacy scan before every push; a hit blocks the push.',
    habits && 'When asked to have something ready by a time, keep every normal check and work in dependency order. Never skip a check, a review or an approval to go faster.',
  ]);

  // models-and-research
  add('models-and-research', 'Models and effort', [
    routing === 'capable' && 'Use the most capable model at medium effort by default, for building and for everything else.',
    routing === 'capable' &&
      'Give the design of a new frontend look that is not yet settled (screens, look, layout, clickable journeys) to the most capable model at extra-high effort.',
    routing === 'capable' &&
      'Give polish of a prototype whose look is already settled (spacing, copy, states, small layout fixes, fixes from a usability check) to the most capable model at high effort.',
    routing === 'capable' && 'Give investigations, diagnosis and plans to the most capable model at high effort.',
    routing === 'capable' &&
      'Re-run an investigation, diagnosis or plan at extra-high effort when the result is weak or the cause is hard to find. Fix or build at medium effort once the cause is proven or the plan is settled.',
    routing === 'capable' && 'Give small, clear tasks (a bug with a clear repro, a docs or copy edit, a version bump, a config tweak) to a faster model at high effort, and re-run it on the most capable model at medium effort after a failed check.',
    routing === 'capable' && 'Run research on the most capable model at high effort.',
    routing === 'capable' &&
      'The research agent plans and checks the work. It hands bulk fetching to the bulk research CLI, reading and summaries to the reader subagent, and drafting to a faster model at high effort.',
    routing === 'capable' && 'Give reading, lookup and summary sub-tasks to the fastest model (for example the reader subagent).',
    routing === 'capable' && 'Before planning, investigation or design work starts, check the effort level the agent doing it actually runs at.',
    routing === 'capable' && 'An agent on a lower effort than these rules pick hands that work to a worker at that effort and only reviews and relays the result.',
    routing === 'economical' && 'Use a balanced model at low effort for routine work and sub-tasks.',
    routing === 'economical' && 'Use medium effort for planning, design, hard reasoning and judgment calls.',
    routing === 'economical' && 'Use the most capable model at high effort for building a product, prototype or demo.',
    routing === 'balanced' && 'Use medium effort by default, and high effort for planning, design, hard reasoning and building.',
    routing !== 'none' && 'Use a model above the one these rules pick only when the user names it for a task.',
    get('PREFS_QUOTA') && 'Treat subscription limits as scarce. Check them with `quota-axi` before heavy or parallel work, and take the cheapest path that still answers.',
    get('PREFS_QUOTA') && 'Pause heavy work near a limit and say so.',
    delegateRule(get),
  ]);
  add('models-and-research', 'Research', [
    browser &&
      "Do web research in a separate, visible browser that belongs to the agent (for example `research-browser axi <command>`), never in the user's own browser profile or an extension running in it.",
    browser && 'Give each research task its own tab, and fill specific page elements instead of typing with global keyboard input.',
    browser && 'Close each tab you opened as soon as that research is done. Never close a tab you did not open.',
    browser && 'Report a site that needs the user to sign in; do not wait on it.',
    get('PREFS_SOURCE_QUALITY') &&
      'Name the type of every source next to its link (official documentation, standards body, peer-reviewed or government report, vendor page, forum post).',
    get('PREFS_SOURCE_QUALITY') && 'Skip content farms and unsourced blog posts. Look for real, existing software before general write-ups.',
    get('PREFS_VERIFY_USER_CLAIMS') && 'Treat tools, names and facts the user mentions in passing as leads to verify with independent research, not as settled truth.',
    get('PREFS_VERIFY_USER_CLAIMS') && 'When asked to set something up, compare the options and confirm the pick before large downloads or config changes.',
    get('PREFS_LIVE_FACTS') &&
      'Examples of the current leading models, tools or products come from a live source checked that day, with its date shown, never from memory.',
    get('PREFS_LIVE_FACTS') && "Before advising what to buy or which tool to pick, fetch each product's own pricing page and docs that day.",
    get('PREFS_LIVE_FACTS') &&
      "Mark every claim (price, limits, how it connects, such as an API or an MCP server) as checked on the vendor's page, from a third party only, or not checked, and flag sources that disagree.",
    get('PREFS_FINDINGS_TO_CHANGE') &&
      'Research is not finished as a report. It ends in a change the user can see, or a decision they can make that leads to one. If nothing changes because of it, say so plainly.',
  ]);

  return homes;
}

const sectionText = ({ title, lines }) => `## ${title}\n\n${lines.map((l) => `- ${l}`).join('\n')}`;

// The taste preset and private rules close the file, so they read as the user's own additions.
function closingSections({ privateRules, tastePreset }) {
  const out = [];
  const taste = tasteSection(tastePreset, 'sessions');
  if (taste) out.push(taste.trimEnd());
  const own = [...(privateRules?.everywhere ?? []), ...(privateRules?.sessions ?? [])];
  if (own.length) out.push(`## Private rules\n\n${PRIVATE_NOTE}\n\n${own.map((l) => `- ${l}`).join('\n')}`);
  return out;
}

const HEADER = `Written by ai-workstation-setup from your answers. Edit freely: re-running the
installer asks before replacing a changed file and keeps a backup.`;

// The always-loaded core file (~/.claude/rules/working-preferences.md): the rules almost every
// session needs, ending with a pointer to each on-demand skill that has rules.
export function renderPreferences(get, opts = {}) {
  const homes = placeRules(get, opts);
  const sections = (homes.core ?? []).map(sectionText);
  const skills = Object.keys(PREFERENCE_SKILLS).filter((name) => homes[name]);
  if (skills.length) {
    sections.push(
      `## Rules that load when needed\n\nThe rest of your rules are skills. Load the one that fits before that kind of work:\n\n${skills
        .map((name) => `- ${name}: ${PREFERENCE_SKILLS[name].when}.`)
        .join('\n')}`,
    );
  }
  return `# Working preferences\n\n${HEADER}\n\n${[...sections, ...closingSections(opts)].join('\n\n')}\n`;
}

// The on-demand skills as { name: SKILL.md text }, only those that have rules.
export function renderPreferenceSkills(get, opts = {}) {
  const homes = placeRules(get, opts);
  const out = {};
  for (const [name, skill] of Object.entries(PREFERENCE_SKILLS)) {
    if (!homes[name]) continue;
    out[name] = `---
name: ${name}
description: ${skill.description}
---

# ${skill.title}

Part of your working preferences, written by ai-workstation-setup from your answers. The rules
for every session are in working-preferences.md. Edit freely: re-running the installer asks
before replacing a changed file and keeps a backup.

${homes[name].map(sectionText).join('\n\n')}
`;
  }
  return out;
}

// Firstmate's data/captain.md: the core rules and every skill's rules in one file, because a
// supervisor needs status, review-page and worker rules in almost every turn, and its harness
// may not load Claude Code skills.
export function renderCaptain(get, opts = {}) {
  const homes = placeRules(get, opts);
  const sections = [
    ...(homes.core ?? []).map(sectionText),
    ...Object.entries(PREFERENCE_SKILLS)
      .filter(([name]) => homes[name])
      .map(([name, skill]) => `## ${skill.title}\n\n${homes[name].map((s) => `### ${s.title}\n\n${s.lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n')}`),
  ];
  return `# Working preferences\n\n${HEADER}\n\n${[...sections, ...closingSections(opts)].join('\n\n')}\n`;
}
