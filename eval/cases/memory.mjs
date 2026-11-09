// Natural source turns, held outside the answering model's current conversation.
// "writes" are gold labels for scripted tool calls, never supplied to the live model.
export function scoreAnswer(fixture, answer) {
  const abstains =
    /\bunknown\b|(?:don['’]t|do not) know|no (?:saved|stored) (?:information|preference)/i.test(
      answer,
    );
  return (
    new RegExp(fixture.answer, 'i').test(answer) &&
    (fixture.unknown || !abstains)
  );
}

export const cases = [
  {
    name: 'natural preference',
    turns: [
      {
        user: 'I usually manage my JavaScript projects with pnpm.',
        writes: [
          {
            key: 'user.package_manager',
            value: 'Uses pnpm for JavaScript projects.',
          },
        ],
      },
    ],
    query:
      'Which package manager do I normally use for JavaScript projects? Answer in English.',
    answer: 'pnpm',
    saved: ['pnpm'],
    maxMemories: 1,
  },
  {
    name: 'updated current state',
    turns: [
      {
        user: 'I live in Shanghai.',
        writes: [{ key: 'user.city', value: 'Lives in Shanghai.' }],
      },
      {
        user: 'I have moved to Shenzhen; that is where I live now.',
        writes: [{ key: 'user.city', value: 'Lives in Shenzhen.' }],
      },
    ],
    query:
      'What city do I live in now? Answer only the current city in English.',
    answer: 'Shenzhen',
    saved: ['Shenzhen'],
    forbiddenSaved: ['lives in Shanghai'],
    maxMemories: 1,
  },
  {
    name: 'conditional preference',
    turns: [
      {
        user: 'I prefer concise replies normally, but detailed explanations for architecture discussions.',
        writes: [
          {
            key: 'user.reply_style',
            value:
              'Prefers concise replies normally, but detailed explanations for architecture discussions.',
          },
        ],
      },
    ],
    query:
      'How do I prefer answers during architecture discussions? Answer in English.',
    answer: 'detail|thorough|in.depth',
    saved: ['concise', 'architecture', 'detail'],
  },
  {
    name: 'ownership and temporary request',
    turns: [
      {
        user: 'My colleague prefers long answers. For this reply only, keep it brief.',
        writes: [],
      },
    ],
    query:
      'What is my usual answer-length preference? If unknown, say "unknown".',
    answer: 'unknown|not know|not.*specified|haven.t.*shared',
    saved: [],
    unknown: true,
  },
  {
    name: 'avoid inferred diet',
    turns: [{ user: 'Find a vegetarian restaurant for tonight.', writes: [] }],
    query:
      'What is my long-term dietary preference? If unknown, say "unknown".',
    answer: 'unknown|not know|not.*specified|haven.t.*shared',
    saved: [],
    unknown: true,
  },
  {
    name: 'historical decision evidence',
    turns: [
      {
        user: 'We replaced the MaLiu Shell launcher with Node.js because maintaining cross-platform shell scripts was too costly.',
        writes: [
          {
            key: 'project.maliu.launcher',
            value: 'MaLiu uses a Node.js launcher.',
          },
        ],
      },
    ],
    query:
      'Why did we replace the MaLiu Shell launcher? Find our original reason and answer in English.',
    answer: 'maintain|maintenance|cross.platform',
    saved: ['Node'],
    evidence: true,
  },
  {
    name: 'forget atomic fact',
    turns: [
      {
        user: 'I live in Chengdu.',
        writes: [{ key: 'user.city', value: 'Lives in Chengdu.' }],
      },
      {
        user: 'Forget my saved city.',
        writes: [{ key: 'user.city', value: null }],
      },
    ],
    query:
      'Is there a saved atomic memory of my city? Search only atomic memory, not original conversations. If absent, say "unknown".',
    answer: 'unknown|no saved|no.*memory|not.*saved|not found',
    saved: [],
    unknown: true,
  },
  {
    name: 'unknown fact',
    turns: [],
    query: 'What city was I born in? If unknown, say "unknown".',
    answer: 'unknown|not know|haven.t.*shared',
    saved: [],
    unknown: true,
  },
  {
    name: 'quoted hypothetical is not a user fact',
    turns: [
      {
        user: 'In a fictional example, a user says "I live in Oslo." This is not about me.',
        writes: [],
      },
    ],
    query: 'What is my current home city? If unknown, say "unknown".',
    answer: 'unknown|not know|not.*specified|haven.t.*shared',
    saved: [],
    unknown: true,
  },
  {
    name: 'explicit remember request',
    turns: [
      {
        user: 'Remember that I prefer metric units.',
        writes: [{ key: 'user.units', value: 'Prefers metric units.' }],
      },
    ],
    query: 'Which measurement system do I prefer? Answer in English.',
    answer: 'metric',
    saved: ['metric'],
    maxMemories: 1,
  },
  {
    name: 'natural preference in Chinese',
    turns: [
      {
        user: '我平时用 pnpm 管理 JavaScript 项目。',
        writes: [
          {
            key: 'user.package_manager',
            value: '平时用 pnpm 管理 JavaScript 项目。',
          },
        ],
      },
    ],
    query:
      'Which package manager do I normally use for JavaScript projects? Answer in English.',
    answer: 'pnpm',
    saved: ['pnpm'],
    maxMemories: 1,
  },
  {
    name: 'unchanged fact avoids duplicate write',
    turns: [
      {
        user: 'I usually manage my JavaScript projects with pnpm.',
        writes: [
          {
            key: 'user.package_manager',
            value: 'Uses pnpm for JavaScript projects.',
          },
        ],
      },
      {
        user: 'I still usually manage my JavaScript projects with pnpm.',
        writes: [],
        expectNoWrite: true,
      },
    ],
    query:
      'Which package manager do I normally use for JavaScript projects? Answer in English.',
    answer: 'pnpm',
    saved: ['pnpm'],
    maxMemories: 1,
  },
];
