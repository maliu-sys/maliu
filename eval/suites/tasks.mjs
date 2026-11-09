import { call, reply, scripted, turn } from '../helpers.mjs';

// A controlled task world, not a claim that the app already has calendar tools.
export function calendarOutcome(state) {
  return [
    [
      'target meeting moved',
      state.meetings.target.time === '2027-01-12T15:00:00+08:00',
    ],
    [
      'unrelated meeting preserved',
      state.meetings.other.time === '2027-01-12T10:00:00+08:00',
    ],
    [
      'exactly one correct notification',
      state.notifications.length === 1 &&
        state.notifications[0]?.id === 'target' &&
        state.notifications[0]?.time === state.meetings.target.time,
    ],
  ];
}
export const tasks = [
  {
    id: 'reschedule-and-notify',
    suite: 'tasks',
    modes: ['scripted', 'live'],
    async run(ctx) {
      const state = {
        meetings: {
          target: { time: '2027-01-12T14:00:00+08:00' },
          other: { time: '2027-01-12T10:00:00+08:00' },
        },
        notifications: [],
      };
      const tools = [
        {
          name: 'list_meetings',
          description: 'Read meetings and their IDs.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          execute: async () => structuredClone(state.meetings),
        },
        {
          name: 'move_meeting',
          description: 'Change one meeting time. Does not notify anyone.',
          parameters: {
            type: 'object',
            properties: { id: { type: 'string' }, time: { type: 'string' } },
            required: ['id', 'time'],
            additionalProperties: false,
          },
          execute: async ({ id, time }) => {
            if (!state.meetings[id] || typeof time !== 'string')
              throw new Error('Invalid meeting');
            state.meetings[id].time = time;
            return { updated: id, time };
          },
        },
        {
          name: 'notify_meeting',
          description:
            'Notify attendees of the current time of a meeting. Every call sends a new notification.',
          parameters: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
            additionalProperties: false,
          },
          execute: async ({ id }) => {
            if (!state.meetings[id]) throw new Error('Unknown meeting');
            state.notifications.push({ id, time: state.meetings[id].time });
            return { sent: true };
          },
        },
      ];
      const conversation = await turn(ctx, {
        prompt:
          'Move meeting target to January 12, 2027 at 15:00 in UTC+08:00, and notify its attendees once. Leave other meetings unchanged.',
        tools,
        complete:
          ctx.mode === 'live'
            ? ctx.complete
            : scripted(
                call('list_meetings', {}),
                call(
                  'move_meeting',
                  { id: 'target', time: '2027-01-12T15:00:00+08:00' },
                  'b',
                ),
                call('notify_meeting', { id: 'target' }, 'c'),
                reply('Done.'),
              ),
      });
      for (const [name, pass] of calendarOutcome(state)) ctx.check(name, pass);
      ctx.artifact('finalState', state);
      ctx.artifact('answer', conversation.messages.at(-1).content);
    },
  },
];
