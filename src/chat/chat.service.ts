import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PublicationBoardFilterDto } from '../publications/dto/publication-filter.dto.js';
import { PublicationsService } from '../publications/publications.service.js';
import type { Viewer } from '../shared/types/viewer.js';
import type { AuthRole } from '../shared/types/auth-role.js';
import { VacancyFilterDto } from '../vacancies/dto/vacancy-filter.dto.js';
import { VacanciesService } from '../vacancies/vacancies.service.js';
import {
  describePublication,
  describeVacancy,
  MAX_CHAT_CARDS,
  publicationCard,
  vacancyCard,
} from './chat-cards.js';
import type { ChatCard } from './chat-cards.js';
import { systemPrompt } from './chat-prompt.js';
import {
  isToolName,
  MODEL_RESULT_LIMIT,
  parseArguments,
  parseFilter,
  PUBLICATION_TOOL_KEYS,
  SEARCH_VACANCIES,
  toolError,
  toolNamesFor,
  toolResult,
  toolsFor,
  VACANCY_TOOL_KEYS,
} from './chat-tools.js';
import { ChatDto, MAX_CHAT_TOTAL_LENGTH } from './dto/chat.dto.js';
import { LlmClient } from './llm-client.js';
import type { LlmCompletion, LlmMessage, LlmToolCall } from './llm-client.js';

const MAX_STEPS = 4;
const MAX_TOOL_CALLS_PER_STEP = 3;
const CHAT_BUDGET_MS = 25_000;
const MAX_CALL_MS = 15_000;
const MIN_CALL_MS = 2_000;
const FINAL_STEP_BELOW_MS = 8_000;
const EMPTY_REPLY =
  'Sorry, I could not put an answer together. Try asking again.';
const FOUND_REPLY = 'Here is what I found.';
const BUSY_REPLY =
  'The assistant is busy right now. Here are results that match your message.';
const FALLBACK_WORDS = 3;
const FALLBACK_MIN_WORD_LENGTH = 3;
const FALLBACK_STOP_WORDS = new Set([
  'about',
  'and',
  'any',
  'are',
  'can',
  'candidate',
  'candidates',
  'find',
  'for',
  'from',
  'have',
  'hello',
  'help',
  'job',
  'jobs',
  'looking',
  'need',
  'please',
  'position',
  'positions',
  'search',
  'show',
  'some',
  'the',
  'there',
  'vacancies',
  'vacancy',
  'want',
  'what',
  'with',
  'work',
  'you',
]);

function keywordsOf(message: string): string[] {
  const words = message
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (word) =>
        word.length >= FALLBACK_MIN_WORD_LENGTH &&
        !FALLBACK_STOP_WORDS.has(word),
    );

  return [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .slice(0, FALLBACK_WORDS);
}

export interface ChatReply {
  reply: string;
  cards: ChatCard[];
}

interface ToolOutcome {
  content: string;
  cards: ChatCard[] | null;
}

function failed(message: string): ToolOutcome {
  return { content: toolError(message), cards: null };
}

function uniqueCards(found: ChatCard[]): ChatCard[] {
  const byKey = new Map<string, ChatCard>();
  for (const card of found) {
    if (byKey.size >= MAX_CHAT_CARDS) break;
    byKey.set(`${card.type}:${card.id}`, card);
  }
  return [...byKey.values()];
}

function answer(content: string | null, cards: ChatCard[]): ChatReply {
  const text = content?.trim();
  return {
    reply: text || (cards.length > 0 ? FOUND_REPLY : EMPTY_REPLY),
    cards,
  };
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly llm: LlmClient,
    private readonly vacancies: VacanciesService,
    private readonly publications: PublicationsService,
  ) {}

  async reply(dto: ChatDto, viewer: Viewer | null): Promise<ChatReply> {
    const history = dto.messages;
    if (history[history.length - 1].role !== 'user') {
      throw new BadRequestException('The last message must be from the user');
    }

    const totalLength = history.reduce(
      (sum, message) => sum + message.content.length,
      0,
    );
    if (totalLength > MAX_CHAT_TOTAL_LENGTH) {
      throw new BadRequestException('The conversation is too long');
    }

    const role = viewer?.accountRole ?? null;
    const tools = toolsFor(role);
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt(role, new Date()) },
      ...history.map(({ role: messageRole, content }): LlmMessage => ({
        role: messageRole,
        content,
      })),
    ];
    const deadline = Date.now() + CHAT_BUDGET_MS;
    let cards: ChatCard[] = [];

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < MIN_CALL_MS) break;

      const isFinalStep =
        step === MAX_STEPS - 1 || remainingMs < FINAL_STEP_BELOW_MS;

      let completion: LlmCompletion;
      try {
        completion = await this.llm.complete(messages, tools, {
          toolChoice: isFinalStep ? 'none' : 'auto',
          timeoutMs: Math.min(MAX_CALL_MS, remainingMs),
        });
      } catch (error: unknown) {
        if (!(error instanceof ServiceUnavailableException)) throw error;
        if (cards.length > 0) return answer(null, cards);

        const fallback = await this.keywordFallback(
          history[history.length - 1].content,
          role,
          viewer,
        );
        if (fallback) return fallback;
        throw error;
      }

      const calls = isFinalStep
        ? []
        : completion.toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP);
      if (calls.length === 0) return answer(completion.content, cards);

      messages.push({
        role: 'assistant',
        content: completion.content,
        tool_calls: calls,
      });

      const outcomes: ToolOutcome[] = [];
      for (const call of calls) {
        const outcome = await this.runTool(call, role, viewer);
        outcomes.push(outcome);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: outcome.content,
        });
      }

      if (outcomes.some((outcome) => outcome.cards !== null)) {
        cards = uniqueCards(outcomes.flatMap((outcome) => outcome.cards ?? []));
      }
    }

    return answer(null, cards);
  }

  private async keywordFallback(
    message: string,
    role: AuthRole | null,
    viewer: Viewer | null,
  ): Promise<ChatReply | null> {
    const words = keywordsOf(message);
    const searchesVacancies = toolNamesFor(role)[0] === SEARCH_VACANCIES;
    if (!searchesVacancies && !viewer) return null;

    try {
      for (let count = words.length; count > 0; count -= 1) {
        const args = { q: words.slice(0, count).join(' ') };
        const outcome = searchesVacancies
          ? await this.searchVacancies(args, viewer)
          : viewer
            ? await this.searchPublications(args, viewer)
            : null;

        if (outcome?.cards?.length) {
          return { reply: BUSY_REPLY, cards: uniqueCards(outcome.cards) };
        }
      }
      return null;
    } catch (error: unknown) {
      this.logger.warn(
        `Chat fallback search failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return null;
    }
  }

  private async runTool(
    call: LlmToolCall,
    role: AuthRole | null,
    viewer: Viewer | null,
  ): Promise<ToolOutcome> {
    const { name } = call.function;
    if (!isToolName(name) || !toolNamesFor(role).includes(name)) {
      return failed('Unknown tool');
    }

    const args = parseArguments(call.function.arguments);
    if (!args) return failed('Arguments must be a JSON object');

    try {
      if (name === SEARCH_VACANCIES) {
        return await this.searchVacancies(args, viewer);
      }
      if (!viewer) return failed('Sign in required');
      return await this.searchPublications(args, viewer);
    } catch (error: unknown) {
      if (error instanceof HttpException) return failed(error.message);
      this.logger.error(
        `Chat tool ${name} failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return failed('Search failed');
    }
  }

  private async searchVacancies(
    args: Record<string, unknown>,
    viewer: Viewer | null,
  ): Promise<ToolOutcome> {
    const filter = await parseFilter(VacancyFilterDto, args, VACANCY_TOOL_KEYS);
    if (typeof filter === 'string') return failed(filter);

    const { items, total } = await this.vacancies.listPublic(filter, viewer);
    const found = items.map(vacancyCard);

    return {
      content: toolResult(
        total,
        found.length,
        found.slice(0, MODEL_RESULT_LIMIT).map(describeVacancy),
      ),
      cards: found,
    };
  }

  private async searchPublications(
    args: Record<string, unknown>,
    viewer: Viewer,
  ): Promise<ToolOutcome> {
    const filter = await parseFilter(
      PublicationBoardFilterDto,
      args,
      PUBLICATION_TOOL_KEYS,
    );
    if (typeof filter === 'string') return failed(filter);

    const { items, total } = await this.publications.listBoard(filter, viewer);
    const found = items.map(publicationCard);

    return {
      content: toolResult(
        total,
        found.length,
        found.slice(0, MODEL_RESULT_LIMIT).map(describePublication),
      ),
      cards: found,
    };
  }
}
