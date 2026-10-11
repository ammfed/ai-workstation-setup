// Turns preference answers into a Markdown rules file. Pure: `get(key)` returns
// an answer, so the same text is written for Claude Code and for firstmate.
// Sections follow the question groups in module.mjs and docs/working-preferences.md.

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

// The same house style for Firstmate's workers, as config/brief-include.md: what they write to
// firstmate, never the deliverable itself. Empty when the style is not chosen.
export function renderBriefInclude(get) {
  if (get('PREFS_WRITING_STYLE') !== 'ste') return '';
  return [
    '## Writing style: Simplified Technical English (house style)',
    '',
    'Write your status lines, reports, questions and notes for firstmate in this style (based on ASD-STE100, adapted):',
    ...STE_RULES.slice(1, 8).map((rule, i) => `${i + 1}. ${rule}`),
    '',
    'This style does not apply to the deliverable itself when it is written for other people (product copy, user-facing text, documents written as the user, code, commit messages, pull request descriptions): follow the project\'s and the brief\'s own rules there.',
    '',
  ].join('\n');
}

export function renderPreferences(get, { cardsPath, decisionsPath } = {}) {
  const sections = [];
  const section = (title, lines) => {
    const kept = lines.filter(Boolean);
    if (kept.length) sections.push(`## ${title}\n\n${kept.map((l) => `- ${l}`).join('\n')}`);
  };

  section('Language and tone', [
    get('PREFS_PLAIN_LANGUAGE') &&
      'Write in plain, natural, friendly words, like a capable colleague talking. Explain a thing before naming it. No internal codes, invented jargon or arrow shorthand in place of sentences.',
    get('PREFS_PLAIN_LANGUAGE') && 'Keep replies short. Go into detail only when asked or when a decision needs it.',
    get('PREFS_NO_NARRATION') &&
      'Give the result, not a commentary on your own steps. Between tool calls, a few words on what you are doing is fine; no private plans or checklists. If something failed or is still running, say that as a fact about the work.',
    get('PREFS_NO_EM_DASHES') && 'Do not use em dashes. Use a period, a comma, or a plain conjunction instead.',
    get('PREFS_OUTWARD_AS_USER') &&
      'Anything that goes to other people (documents, emails, pull request text, published pages) is written as the user, in their professional voice. Leave out agent and tooling labels, internal ids, source-type tags and speaker notes.',
    get('PREFS_NATURAL_TRANSLATION') &&
      'When writing in another language, write it the way a native speaker in that field would, with the terms they actually use. Never translate literally from English.',
    get('PREFS_WRITING_PRINCIPLES') &&
      'Writing for other people leads with the real point, gives each strong claim its reason or evidence, and states uncertainty plainly. No corporate filler, no hedging that hides the actual view.',
    get('PREFS_WRITING_PRINCIPLES') &&
      'Before building a deck or document, agree its one-sentence point with the user, draft it as plain paragraphs, then add a visual only where it is the evidence.',
    ...(get('PREFS_WRITING_STYLE') === 'ste' ? STE_RULES : []),
    get('PREFS_ONE_DESIGN_SYSTEM') &&
      'When several design systems are available, use the one that matches the artifact type (for example documents, app screens, websites). Never mix two in one artifact.',
    get('PREFS_COPY_SECOND_OPINION') &&
      'For copywriting and translation, get a refinement pass from a second AI model. Send only the text being refined, never secrets, credentials or whole documents. Decide the final wording yourself against these rules.',
    get('PREFS_HABITS') && "End every reply with the next actions, the user's first.",
    get('PREFS_HABITS') &&
      'When the user says they are lost or a reply is too long, give the shortest plain answer, with no list of what was checked.',
    get('PREFS_HABITS') && 'When asked for an opinion, give a real one with its reason.',
    get('PREFS_CALM_WORD') &&
      `When the user says "${get('PREFS_CALM_WORD')}", switch to a calm mode: batch tool calls, stop in-between updates, and give only the answer.`,
  ]);

  const status = get('PREFS_STATUS');
  const days = get('PREFS_STALE_DAYS') || '2';
  section('Reporting and status', [
    status === 'board' &&
      'Open every status reply with the current work as one table whose three columns sit side by side: TODO, DOING, DONE. Each column lists its own items, one short line each. Never three stacked lists or three separate rows.',
    status === 'actions' &&
      'Answer a status request with a very short list of action items, the user\'s first, then point to the full report (its path or link) instead of repeating it.',
    status === 'board' &&
      "Then group what is left by who acts: the user's block labelled YOU, the agent's labelled with its own role name (for example FIRST MATE), never ME.",
    status === 'board' && 'Use small text bars and boxes where they carry meaning, and nothing decorative.',
    status === 'brief' && 'Open every status reply with the answer in a sentence or two.',
    status === 'brief' && 'Then give brief action items, grouped by who acts: the user first, then the agent.',
    status !== 'none' && 'Show progress as counts like "3 of 5". A word always carries the state, never colour alone.',
    get('PREFS_HONEST_NUMBERS') &&
      'When a number is uncertain, give a range or say "not yet known" instead of a single made-up figure. Charts are plain bars or small multiples on a shared scale, never radar or gauge charts.',
    get('PREFS_LINK_DELIVERABLES') &&
      'Every finished item that produced something carries a link to it: a full https URL for anything online, an absolute path for a local file.',
    get('PREFS_DAILY_CHECK') &&
      `Once a day, at the top of the first status, run a nothing-forgotten check and show anything real: review-page answers not yet collected, anything waiting on the user for more than ${days} days without being brought back, and standing rules with no evidence that they ran. Verify each item before calling it dropped.`,
    get('PREFS_AWAY_MODE') &&
      'When the user says they are away (commuting, asleep, offline for a while), keep going on work that is already approved, hold every new decision and anything irreversible, and send no routine progress messages. When they return, open with a short return brief: what finished (with links), what waits on them, what is next.',
  ]);

  const decisions = get('PREFS_DECISIONS');
  const cards = decisions === 'cards' || decisions === 'both';
  const allCards = cards && cardsPath && get('PREFS_PAGES_ALL_CARDS');
  const grill = get('PREFS_GRILL');
  const browser = get('PREFS_RESEARCH_BROWSER') === 'separate';
  section('Decisions', [
    'Bring the user genuine decisions only, never tool permissions or command mechanics.',
    decisions === 'cards' &&
      'Put decisions on a Lavish decision-card page (lavish-axi): one decision at a time with "1 of N" and a progress fill, a visual preview for every option, a short "why" kept closed, and every answer sent together after a one-screen recap.',
    decisions === 'both' &&
      'Ask quick questions with the question tool, one at a time, a preview on every option and a recommendation. Put larger or visual decisions on a Lavish decision-card page.',
    cards && cardsPath && !allCards && `Start each decision page from the template at \`${cardsPath}\`.`,
    cards && 'Open review pages without launching a browser tab (`--no-open`, or `LAVISH_AXI_NO_OPEN=1`), never open one automatically, and never re-run the open command just to refresh a page; the running page already updates.',
    decisions === 'tool' && 'Ask decisions with the question tool, one question at a time, with a preview on every option.',
    decisions === 'chat' && 'Ask decisions in chat, one at a time, with a short named list of options and the recommendation first.',
    decisions !== 'chat' && get('PREFS_YES_NO_IN_CHAT') && 'Ask a simple yes-or-no question in plain chat, not on a review page.',
    get('PREFS_PREVIEW_BEFORE_BUILD') &&
      'When the user asks for a change to how something looks or feels, show it on a review page before building it, the same way as a decision.',
    !cards && get('PREFS_CHECK_ANSWERS_FIRST') &&
      'Before describing a question as still open, check whether the user already answered it. Never assume it is unanswered.',
    cards && get('PREFS_CHECK_ANSWERS_FIRST') &&
      'Before calling a review page open, answered or unanswered, check whether the user already answered it, and never assume it is unanswered. `lavish-axi` lists every session with its status and pending answers, and `lavish-axi poll <file>` collects answers (leave it running; answers stay queued until collected). Never reopen a page the user ended unless they ask. A page that says it ended, or a link that loads, does not mean answers were lost: read the session status and pending answers, and collect them with `lavish-axi poll <file>` first.',
    get('PREFS_ASK_BEFORE_CLOSING') &&
      `When work finishes, ask whether to close the finished or idle agents, sessions and review pages. Never close one unasked, and never leave a finished one open silently.${browser ? ' Research tabs the agent opened follow the research rule.' : ''}`,
    get('PREFS_AUTONOMY') === 'act' &&
      'For ordinary judgment calls within a direction the user already set (a library, a helper tool, an implementation detail), decide and report the outcome instead of asking first. When unsure whether a call is the user\'s, act and flag it.',
    get('PREFS_AUTONOMY') === 'act' &&
      'Always ask first for a decision only the user can make, a credential or access only they hold, or anything destructive, irreversible or security-sensitive.',
    get('PREFS_AUTONOMY') === 'ask' && 'Ask before acting on judgment calls, including small implementation choices.',
    decisionsPath &&
      `Keep the user's decisions in \`${decisionsPath}\`: record each ruling the moment it is made, with its date. If it is not in the file, it is not decided, and the newest ruling wins.`,
    decisionsPath &&
      'List what the user ruled out in the same file and never offer it again. Record a "not yet" as the condition that brings it back (for example "when real data exists"), not as a date, and check that condition before raising it again.',
    grill === 'every' &&
      'Every round of questions to the user runs the grilling method: map the open decisions, ask only the ones that can be answered now, give a recommendation on each, look facts up instead of asking for them, and ask the next round only after the answers.',
    grill === 'every' &&
      'Keep it balanced. When the intent and the request are clear enough, go ahead without asking. Ask only where a real gap would change the result, and never loop with questions for their own sake.',
    grill === 'every' &&
      'A gap only someone else can fill (a colleague, a vendor) becomes a short questionnaire for that person, not a question to the user.',
    grill === 'gaps' &&
      'Question the user hard about a plan only when it has a real gap: an underspecified instruction, an untested premise, or something irreversible whose reasoning was never tested. Never as the default way to ask.',
  ]);

  section('Review pages', [
    allCards &&
      `Every Lavish page starts from the card template at \`${cardsPath}\`: decisions, reports, plans, explainers and lessons alike. One card at a time, a visual beside it, minimal text. A card with nothing to choose has a Next button instead of options.`,
    allCards && "This overrides lavish-axi's own design default. Use another look only when the user names one.",
    allCards && 'For a diagram on a page, use the diagram-design skill.',
    cards && get('PREFS_PAGE_SIDE_BY_SIDE') &&
      'Lay a decision page out horizontally: the decision card on one side and a canvas showing the current decision visually on the other. Never stack them vertically.',
    cards && get('PREFS_PAGE_FLIP_PREVIEWS') &&
      "For any visual choice, give every option its own preview and let the user flip between all of them (buttons or a dropdown). The canvas follows the option they select. Never show only the recommended option's visual.",
    get('PREFS_PAGE_MINIMAL_TEXT') &&
      'Keep page text to the minimum: a title, the question, short option labels. No fluff, no small helper text, no explaining the obvious. Let visuals carry the meaning, and use a visual only where it shows the point better than a sentence, preferring real screenshots and worked examples over drawn mock-ups.',
    get('PREFS_PAGE_WIDE_HEADER') &&
      'Give review pages a generous header: a large title and intro text spread across the full page width, not squeezed into a narrow column.',
  ]);

  section('Review page delivery', [
    cards && get('PREFS_PAGE_CHECK_BEFORE_SEND') &&
      "Before sending a page link, open the page in the agent's own browser and confirm by screenshot that its content actually shows: a page can load and still be stuck, blank or washed out. Fix it first, then send the link.",
    get('PREFS_PAGE_CHECK_BEFORE_SEND') && 'Always give the user the page link in chat, as a full URL.',
    get('PREFS_PAGE_FIRST') &&
      'When a decision waits on a page, build and check the page first, send the link, then stand by quietly until the user answers. Do not ask the question anywhere else before the page is in front of them.',
    get('PREFS_PAGES_TOGETHER') &&
      'When several review pages are in progress, hold the links until all open work is done. Check the pages against each other (each question asked once, dependencies in order, no clashing recommendations, one set of names), then send them together in the order to take them. Keep giving brief status meanwhile.',
  ]);

  section('Working with a fleet', get('PREFS_FLEET_WORKFLOW') ? [
    'Dispatch: give each worker a brief that names the goal, the branch, where it reports and what done means. Work that can run in parallel goes to separate workers in separate worktrees.',
    'Supervise: workers report a status line only at phase changes and when finished, blocked or in need of a decision. Read the live state (status files, session lists) before reporting on it, and never guess.',
    'Land: each worker opens a pull request and watches its checks until they are green. Merging follows the safety rule below.',
    'A review page is for a genuine decision, a look-and-feel change, or a plan the user should judge from the artifact. Status, yes-or-no questions and routine implementation choices do not get one.',
    'Decisions go to the user only at genuine forks. Act on work that nothing blocks. A permission prompt, a refused tool call or a command that needs running by hand is never escalated as a decision: state the blocker once in one line and stop.',
  ] : []);

  section('Building', [
    get('PREFS_BUILD_WHOLE_GOAL') &&
      'Before building something new, show the research and the user journeys on one review page, so the user decides from what they have seen.',
    get('PREFS_BUILD_WHOLE_GOAL') &&
      "Then give one builder the whole goal in a single brief (the user's words, the constraints, what done means) and let it run. Never feed a builder step by step.",
    get('PREFS_BUILD_WHOLE_GOAL') && 'Run the full validation pipeline once the first complete pass exists, not on every step.',
    get('PREFS_ROUTE') &&
      'Take a software project (building or changing an app, a tool or a codebase) through six steps, each with its skill when installed: ' +
        '1 Plan: write the idea down, judge fit and timing, and say so in one line (wayfinder maps an effort too big for one session). ' +
        '2 Decide: settle the open decisions in rounds of questions and record the answers (grilling, or grill-with-docs). ' +
        '3 Prototype: write a spec that names the test seams, with a throwaway prototype when the look or flow needs judging, and get it approved before building (to-spec, prototype). ' +
        '4 Breakdown: cut a spec too big for one change into tickets with their blocking edges (to-tickets). ' +
        '5 Build: one builder builds the whole spec test-first (tdd, codebase-design). ' +
        '6 Ship: validate, open a pull request, and merge once approved (no-mistakes).',
    get('PREFS_ROUTE') &&
      'Short paths: a small clear change goes Plan, Build, Ship. A bug goes Plan, find the cause, Build with the reproduction as the regression test, Ship. Documents, review pages, research and one-off tasks do not take the route.',
    get('PREFS_TEST_FIRST') &&
      'Build product code test-first at the seams the spec names (tdd, codebase-design skills when installed). Prototypes, docs and config are not test-first.',
    get('PREFS_GLOSSARY_ADR') &&
      'Before building, read GLOSSARY.md and docs/adr/ if they exist. Add new terms and decision records in the same change that introduces them. Start these files in any project, but only when a term or a hard-to-reverse decision comes up.',
    get('PREFS_PROTOTYPE_CHECK') &&
      "Before the user sees a prototype, open it in the agent's browser at laptop width and at phone width (390 px). Fix broken layout, unclear labels and dead ends first.",
    get('PREFS_MODEL_GUIDE') &&
      "When a model is named for a task, read that vendor's official prompting guide first and brief the model the way it says.",
  ]);

  section('Ideas and priorities', [
    get('PREFS_HABITS') && 'When the user is working on one topic, keep status and questions to that topic and park the rest.',
    get('PREFS_HABITS') && '"Check X" is a question, not a go-ahead to widen the work. Ask before adding to a pass.',
    get('PREFS_HABITS') && 'Never hand the user a menu of what to run next. Choose, start, and report what started and what waits.',
    get('PREFS_CAPTURE_IDEAS') &&
      'When the user shares an idea, capture it and weigh it against the current priorities. Fold it into current work when it fits, otherwise park it somewhere it will come back with a clear trigger, and say in one line where it landed. When asked for an opinion on it, give a real one with the reasoning.',
    get('PREFS_RESEQUENCE') &&
      'Reorder queued work by what blocks what and what unblocks the nearest deadline, without asking first. Then tell the user the new order and why. Still ask about anything only they can decide.',
    get('PREFS_ORIENT') &&
      'When work piles up or the user seems unsure what comes next, orient them in two short lines: the current phase and the next concrete deliverable, with where to find it.',
    get('PREFS_FINISH_FIRST') &&
      'Prefer finishing over expanding. Once something works, stop instead of proposing the next improvement, and suggest cutting scope at most once.',
    get('PREFS_FINISH_FIRST') &&
      'State the case against a risky choice once, with the consequence named. If the user keeps it, go ahead and do not raise it again.',
  ]);

  const routing = get('PREFS_MODEL_ROUTING');
  section('AI and model use', [
    routing === 'capable' && 'Use the most capable model at medium effort by default, for building and for everything else.',
    routing === 'capable' &&
      'Give user-facing frontend and visual design work (screens, look, layout, clickable journeys), investigations, diagnosis and plans to the most capable model at extra-high effort.',
    routing === 'capable' &&
      'Give small, clear tasks (a bug with a clear repro, a docs or copy edit, a version bump, a config tweak) to a faster model at medium effort, and raise it to high after a failed check.',
    routing === 'capable' && 'Give reading, lookup and summary sub-tasks to the fastest model (for example the reader subagent).',
    routing === 'economical' && 'Use a balanced model at low effort for routine work and sub-tasks.',
    routing === 'economical' && 'Use medium effort for planning, design, hard reasoning and judgment calls.',
    routing === 'economical' && 'Use the most capable model at high effort for building a product, prototype or demo.',
    routing === 'balanced' && 'Use medium effort by default, and high effort for planning, design, hard reasoning and building.',
    routing !== 'none' && 'Use a model above the one these rules pick only when the user names it for a task.',
    get('PREFS_QUOTA') &&
      'Treat subscription limits as scarce. Check them with `quota-axi` before heavy or parallel work, take the cheapest path that still answers, and pause heavy work near a limit and say so.',
    get('PREFS_DELEGATE_RETRIEVAL') &&
      `Hand retrieval-heavy work (large document sweeps, broad web reading, bulk page reads) to \`${[get('PREFS_DELEGATE_RETRIEVAL'), get('PREFS_DELEGATE_MODEL') && `--model ${get('PREFS_DELEGATE_MODEL')}`].filter(Boolean).join(' ')}\` and reason over what it returns. Keep decisions and code changes with the main agent.`,
  ]);

  section('Research', [
    browser &&
      "Do web research in a separate, visible browser that belongs to the agent (for example `research-browser axi <command>`), never in the user's own browser profile or an extension running in it.",
    browser &&
      'Give each research task its own tab, fill specific page elements instead of typing with global keyboard input, and close each tab you opened as soon as that research is done. Never close a tab you did not open. Report a site that needs the user to sign in; do not wait on it.',
    get('PREFS_SOURCE_QUALITY') &&
      'Name the type of every source next to its link (official documentation, standards body, peer-reviewed or government report, vendor page, forum post). Skip content farms and unsourced blog posts. Look for real, existing software before general write-ups.',
    get('PREFS_VERIFY_USER_CLAIMS') &&
      'Treat tools, names and facts the user mentions in passing as leads to verify with independent research, not as settled truth.',
    get('PREFS_VERIFY_USER_CLAIMS') &&
      'When asked to set something up, compare the options and confirm the pick before large downloads or config changes.',
    get('PREFS_FINDINGS_TO_CHANGE') &&
      'Research is not finished as a report. It ends in a change the user can see, or a decision they can make that leads to one. If nothing changes because of it, say so plainly.',
  ]);

  const merge = get('PREFS_MERGE');
  section('Safety', [
    'Never put secrets, tokens, passwords or personal data in files, commits, pull requests, pages or logs. Secrets come from environment variables or the tool\'s own sign-in.',
    merge === 'explicit' &&
      'Merge a pull request only when the user explicitly says to merge that pull request. Approving the work is not a merge instruction.',
    merge === 'green' &&
      'You may merge your own pull requests once every check passes. Still ask before anything destructive, irreversible or security-sensitive.',
    get('PREFS_VERIFY_CAUSE') &&
      'Do not name a cause for a failure unless you checked it against evidence. Otherwise report the failure and say the cause is unknown.',
    get('PREFS_STOP_DIGGING') &&
      'A request to investigate is not proof that something is broken. Confirm the problem from real evidence first, or ask what the user saw. If about two checks turn up nothing, stop and report what is known.',
    get('PREFS_BLOCKED_COMMANDS') &&
      'When a permission check blocks an install, a schedule, a service change, a push or a pull request, do not look for another way around it. Record the exact one-line command for the user to run, say what it is for, and carry on with the rest.',
    get('PREFS_PRIVATE_STAYS_LOCAL') &&
      "Private chats, and anything captured from the user's own sessions, never go to an outside model or service, including for a second opinion.",
    get('PREFS_PUBLIC_REPOS') &&
      'In a public repository, commit with a no-reply identity and add no trailer that carries an email address. Pull request text is a short plain summary that names no private people, clients, projects or internal tooling. Run the privacy scan before every push; a hit blocks the push.',
    get('PREFS_PAUSE_WORD') &&
      `When the user says "${get('PREFS_PAUSE_WORD')}", stop every running agent in place, confirm each one stopped, and hold until the user says to resume. A new full task request right after a pause counts as the resume.`,
    get('PREFS_HABITS') && 'A statement is a claim until something shows it. Show the case that can fail, not only the passing one.',
    get('PREFS_HABITS') && 'When the user says a record is outdated, check it against reality before defending it.',
    'Say plainly when something was reasoned about rather than tested.',
  ]);

  return `# Working preferences

Written by ai-workstation-setup from your answers. Edit freely: re-running the
installer asks before replacing a changed file and keeps a backup.

${sections.join('\n\n')}
`;
}
