import { fetch } from 'expo/fetch';
import type { Tool } from '../agent/types';

export const webSearch: Tool = {
  name: 'web_search',
  description:
    'Search the web for current information. Returns titles, source URLs and excerpts. Cite the URLs in your answer.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A focused search query.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(args, signal) {
    if (
      !args ||
      typeof args !== 'object' ||
      !('query' in args) ||
      typeof args.query !== 'string' ||
      !args.query.trim() ||
      args.query.length > 400
    ) {
      throw new Error(
        'query must be a non-empty string of at most 400 characters.',
      );
    }
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Tavily-Access-Mode': 'keyless',
      },
      body: JSON.stringify({
        query: args.query.trim(),
        max_results: 5,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
      }),
    });
    if (!response.ok)
      throw new Error(
        `Search unavailable (${response.status}). Free keyless access may be rate limited; try again later.`,
      );
    const data = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    if (!Array.isArray(data.results))
      throw new Error(
        'Search returned no usable results. Keyless access may be rate limited.',
      );
    return data.results.slice(0, 5).map((result) => ({
      title: String(result.title ?? '').slice(0, 300),
      url: String(result.url ?? '').slice(0, 2000),
      snippet: String(result.content ?? '').slice(0, 2000),
    }));
  },
};
