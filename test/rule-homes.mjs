// Where every working-preferences rule lives: the always-loaded core file or one of the five
// on-demand skills. One row per rule the preferences module can write, in the order the single
// rules file used to list them. `old` is how the rule started in that file, `says` holds one
// phrase per bullet the rule now writes (`ifOld` marks one written only when the old rule held
// that clause), and `when` holds the answers that switch the rule on
// when ALL_ON does not. test/preferences.test.mjs checks every row against the renderer.

// Every preference answered so that the most rules are written: each yes-or-no question yes
// (the taste preset aside), the Simplified Technical English style, and a helper CLI.
export const ALL_ON = { PREFS_WRITING_STYLE: 'ste', PREFS_DELEGATE_RETRIEVAL: 'agy', PREFS_TASTE_PRESET: 'no' };

const WFO = 'writing-for-others';
const STATUS = 'status-and-away';
const PAGES = 'review-pages';
const WORKERS = 'running-workers';
const MODELS = 'models-and-research';

const row = (old, home, says = [old], when = undefined) => ({ old, home, says, ...(when ? { when } : {}) });

export const RULE_HOMES = [
  // Language and tone
  row('Write in plain, natural, friendly words', 'core'),
  row('Keep replies short.', 'core'),
  row('Give the result, not a commentary', 'core'),
  row('Do not use em dashes.', 'core'),
  row('Anything that goes to other people', WFO, ['is written as the user, in their professional voice', 'Leave out agent and tooling labels']),
  row('When writing in another language', WFO),
  row('Writing for other people leads with the real point', WFO, ['Lead with the real point.', 'Give each strong claim its reason or evidence', 'No corporate filler']),
  row('Before building a deck or document', WFO, ['agree its one-sentence point', 'draft it as plain paragraphs']),
  row('House style for everything written to the user', 'core'),
  row('One instruction per sentence, as a command.', 'core'),
  row('Use active voice and name who acts.', 'core'),
  row('Keep sentences short: 20 words', 'core'),
  row('Use simple tenses', 'core'),
  row('Use one word for one thing every time', 'core'),
  row('Use verbs, not noun phrases', 'core'),
  row('In a warning, state the risk in plain words first', 'core'),
  row('Relax the style for a warm opening', 'core'),
  row('The house style does not apply', 'core'),
  row('When several design systems are available', WFO),
  row('For copywriting and translation', WFO, ['get a refinement pass from a second AI model', 'Send it only the text being refined', 'Decide the final wording yourself']),
  row("End every reply with the next actions, the user's first.", 'core'),
  row('When the user says they are lost', 'core'),
  row('When asked for an opinion, give a real one', 'core'),
  row('When the user says "calm"', 'core'),

  // Reporting and status
  row('Open every status reply with one line of headline counts', STATUS),
  row('Then NEEDS YOU:', STATUS),
  row('Then AT RISK:', STATUS),
  row('Then always a table with To do, Doing and Done', STATUS),
  row('End with one Links line', STATUS, ['End with one Links line', 'Leave out any empty part except the table']),
  row('Open every status reply with the current work as one table', STATUS, undefined, { PREFS_STATUS: 'board' }),
  row('Answer a status request with a very short list', STATUS, undefined, { PREFS_STATUS: 'actions' }),
  row('Then group what is left by who acts', STATUS, undefined, { PREFS_STATUS: 'board' }),
  row('Use small text bars and boxes', STATUS, undefined, { PREFS_STATUS: 'board' }),
  row('Open every status reply with the answer', STATUS, undefined, { PREFS_STATUS: 'brief' }),
  row('Then give brief action items', STATUS, undefined, { PREFS_STATUS: 'brief' }),
  row('Show progress as counts', STATUS),
  row('When a number is uncertain', 'core'),
  row('Every finished item that produced something', 'core'),
  row('Once a day, at the top of the first status', STATUS, ['run a nothing-forgotten check', 'review-page answers not yet collected', 'Verify each item before calling it dropped']),
  row('When the user says they are away', STATUS, ['keep going on work that is already approved', 'hold every new decision', 'open with a short return brief']),

  // Decisions
  row('Bring the user genuine decisions only', 'core'),
  row('Put decisions on a Lavish decision-card page', 'core', undefined, { PREFS_DECISIONS: 'cards' }),
  row('Ask quick questions with the question tool', 'core'),
  row('Start each decision page from the template', PAGES, undefined, { PREFS_PAGES_ALL_CARDS: 'no' }),
  row('Create review pages without launching a browser tab', PAGES, [
    'without launching a browser tab',
    'Never re-run the open command',
    "open it once in the user's browser at hand-over",
    // Only with away mode on, as before: the old rule added this sentence only then.
    { text: 'While the user is away, open nothing', ifOld: 'While the user is away' },
  ]),
  row('Ask decisions with the question tool', 'core', undefined, { PREFS_DECISIONS: 'tool' }),
  row('Ask decisions in chat', 'core', undefined, { PREFS_DECISIONS: 'chat' }),
  row('Ask a simple yes-or-no question in plain chat', 'core'),
  row('When the user asks for a change to how something looks or feels', PAGES),
  row('Before describing a question as still open', 'core', undefined, { PREFS_DECISIONS: 'tool' }),
  row('Before calling a review page open', PAGES, [
    'Before calling a review page open',
    'collects answers: leave it running',
    'Never reopen a page the user ended',
    'does not mean answers were lost',
  ]),
  row('When work finishes, ask whether to close', 'core'),
  row('For ordinary judgment calls', 'core'),
  row('Always ask first for a decision only the user can make', 'core'),
  row('For a process or tooling question', 'core'),
  row('Ask before acting on judgment calls', 'core', undefined, { PREFS_AUTONOMY: 'ask' }),
  row("Keep the user's decisions in", 'core'),
  row('List what the user ruled out', 'core'),
  row('Every round of questions to the user runs the grilling method', 'core'),
  row('Keep it balanced.', 'core'),
  row('A gap only someone else can fill', WFO),
  row('Question the user hard about a plan', 'core', undefined, { PREFS_GRILL: 'gaps' }),

  // Review pages
  row('Every Lavish page starts from the card template', PAGES, ['Every Lavish page starts from the card template', 'Show one card at a time with a visual beside it']),
  row("This overrides lavish-axi's own design default", PAGES, ["overrides lavish-axi's own design default"]),
  row('For a diagram on a page, use the diagram-design skill.', PAGES),
  row('Every Lavish prototype, slide or doc page carries the hide tray', PAGES),
  row('End each card with a short "Based on" line', PAGES),
  row('Lay a decision page out horizontally', PAGES),
  row('For any visual choice, give every option its own preview', PAGES, ['give every option its own preview', "Never show only the recommended option's visual."]),
  row('Keep page text to the minimum', PAGES, ['Keep page text to the minimum', 'Let visuals carry the meaning']),
  row('Every review page also reads well on a phone', PAGES, ['reads well on a phone (390 px wide)', 'Check a 390 by 844 screenshot']),
  row('Give review pages a generous header', PAGES),

  // Review page delivery
  row('Before sending a page link', PAGES),
  row('Always give the user the page link in chat', PAGES),
  row('When a decision waits on a page', PAGES, ['build and check the page first', 'Do not ask the question anywhere else']),
  row('While waiting, prepare the next stage', PAGES),
  row('When several review pages are in progress', PAGES, ['hold the links until all open work is done', 'check the pages against each other']),

  // Working with a fleet
  row('Dispatch: give each worker a brief', WORKERS, ['Give each worker a brief that names the goal', 'separate workers in separate worktrees']),
  row('Supervise: workers report a status line', STATUS, ['Workers report a status line only at phase changes', 'Read the live state (status files, session lists)']),
  row('Before calling any work in progress', STATUS, ['check its live state first', 'After each merge, check the queue', 'Raise any wait longer than 30 minutes']),
  row("When the user must type in an agent's window", WORKERS),
  row('Land: each worker opens a pull request', WORKERS, ['opening a pull request and watching its checks']),
  row('A review page is for a genuine decision', PAGES, ['A review page is for a genuine decision', 'do not get a review page']),
  row('Decisions go to the user only at genuine forks', WORKERS, ['only at genuine forks', 'is never escalated as a decision']),

  // Building
  row('Before building something new', WORKERS),
  row('Then give one builder the whole goal', WORKERS),
  row('Run the full validation pipeline', WORKERS),
  row('Take a software project', WORKERS),
  row('Short paths:', WORKERS),
  row('At the start of real work', 'core'),
  row('Build product code test-first', WORKERS),
  row('Before building, read GLOSSARY.md', WORKERS),
  row('Before the user sees a prototype', PAGES),
  row('When a model is named for a task', WORKERS),

  // Ideas and priorities
  row('When the user is working on one topic', 'core'),
  row('"Check X" is a question', 'core'),
  row('Never hand the user a menu', 'core'),
  row('When the user shares an idea', 'core'),
  row('Reorder queued work', STATUS, ['Reorder queued work', 'Then tell the user the new order']),
  row('End every project reply with one plain line', 'core'),
  row('Prefer finishing over expanding', 'core'),
  row('State the case against a risky choice once', 'core'),

  // AI and model use
  row('Use the most capable model at medium effort by default', MODELS),
  row('Give the design of a new frontend look', MODELS),
  row('Give polish of a prototype', MODELS),
  row('Give investigations, diagnosis and plans', MODELS, ['Give investigations, diagnosis and plans', 'Re-run an investigation, diagnosis or plan']),
  row('Give small, clear tasks', MODELS),
  row('Run research on the most capable model', MODELS, ['Run research on the most capable model', 'The research agent plans and checks the work']),
  row('Give reading, lookup and summary sub-tasks', MODELS),
  row('Before planning, investigation or design work starts', MODELS, ['check the effort level the agent doing it actually runs at', 'An agent on a lower effort']),
  row('Use a balanced model at low effort', MODELS, undefined, { PREFS_MODEL_ROUTING: 'economical' }),
  row('Use medium effort for planning, design', MODELS, undefined, { PREFS_MODEL_ROUTING: 'economical' }),
  row('Use the most capable model at high effort for building', MODELS, undefined, { PREFS_MODEL_ROUTING: 'economical' }),
  row('Use medium effort by default, and high effort', MODELS, undefined, { PREFS_MODEL_ROUTING: 'balanced' }),
  row('Use a model above the one these rules pick', MODELS),
  row('Treat subscription limits as scarce', MODELS, ['Treat subscription limits as scarce', 'Pause heavy work near a limit']),
  row('Hand retrieval-heavy work', MODELS),

  // Research
  row('Do web research in a separate, visible browser', MODELS),
  row('Give each research task its own tab', MODELS, ['its own tab', 'Close each tab you opened', 'Report a site that needs the user to sign in']),
  row('Name the type of every source', MODELS, ['Name the type of every source', 'Skip content farms']),
  row('Treat tools, names and facts', MODELS),
  row('When asked to set something up', MODELS),
  row('Examples of the current leading models', MODELS),
  row('Before advising what to buy', MODELS, ["fetch each product's own pricing page", 'Mark every claim']),
  row('Research is not finished as a report', MODELS),

  // Safety
  row('Never put secrets, tokens, passwords', 'core'),
  row('Merge a pull request only when the user explicitly says', 'core'),
  row('You may merge your own pull requests', 'core', undefined, { PREFS_MERGE: 'green' }),
  row('Do not name a cause for a failure', 'core'),
  row('A request to investigate is not proof', 'core'),
  row('When a permission check blocks', 'core'),
  row('Private chats, and anything captured', 'core'),
  row('In a public repository, commit with a no-reply identity', WORKERS, ['commit with a no-reply identity', 'Pull request text in a public repository', 'run the privacy scan before every push']),
  row('When the user says "pause"', 'core'),
  row('A statement is a claim until something shows it.', 'core'),
  row('When the user says a record is outdated', 'core'),
  row('When asked to have something ready by a time', WORKERS),
  row('Say plainly when something was reasoned about', 'core'),
];
