import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const LLM_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const LLM_MODEL = 'openai/gpt-oss-120b';
const LLM_TEMPERATURE = 0.3;
const LLM_MAX_REPLY_TOKENS = 700;

const CHAT_BUSY_MESSAGE =
  'The assistant is busy right now. Try again in a minute.';
const CHAT_UNAVAILABLE_MESSAGE = 'The assistant is not available right now.';

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface LlmToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

export interface LlmRequestOptions {
  toolChoice: 'auto' | 'none';
  timeoutMs: number;
}

export interface LlmCompletion {
  content: string | null;
  toolCalls: LlmToolCall[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseToolCall(value: unknown): LlmToolCall | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  if (!isRecord(value.function)) return null;

  const { name, arguments: args } = value.function;
  if (typeof name !== 'string') return null;

  return {
    id: value.id,
    type: 'function',
    function: {
      name,
      arguments: typeof args === 'string' ? args : '{}',
    },
  };
}

function parseCompletion(body: unknown): LlmCompletion | null {
  if (!isRecord(body) || !Array.isArray(body.choices)) return null;

  const choices: unknown[] = body.choices;
  const choice = choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;

  const { content, tool_calls: rawCalls } = choice.message;
  const calls: unknown[] = Array.isArray(rawCalls) ? rawCalls : [];

  return {
    content: typeof content === 'string' ? content : null,
    toolCalls: calls
      .map(parseToolCall)
      .filter((call): call is LlmToolCall => call !== null),
  };
}

@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);

  constructor(private readonly config: ConfigService) {}

  async complete(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    { toolChoice, timeoutMs }: LlmRequestOptions,
  ): Promise<LlmCompletion> {
    const apiKey = this.config.getOrThrow<string>('LLM_API_KEY');

    let response: Response;
    try {
      response = await fetch(LLM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages,
          temperature: LLM_TEMPERATURE,
          max_completion_tokens: LLM_MAX_REPLY_TOKENS,
          ...(tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      this.logger.error(
        `LLM request failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw new ServiceUnavailableException(CHAT_UNAVAILABLE_MESSAGE);
    }

    if (!response.ok) {
      this.logger.warn(`LLM answered with status ${response.status}`);
      throw new ServiceUnavailableException(
        response.status === 429 ? CHAT_BUSY_MESSAGE : CHAT_UNAVAILABLE_MESSAGE,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.error('LLM answered with a body that is not JSON');
      throw new ServiceUnavailableException(CHAT_UNAVAILABLE_MESSAGE);
    }

    this.logUsage(body);

    const completion = parseCompletion(body);
    if (!completion) {
      this.logger.error('LLM answered with an unexpected shape');
      throw new ServiceUnavailableException(CHAT_UNAVAILABLE_MESSAGE);
    }

    return completion;
  }

  private logUsage(body: unknown): void {
    if (!isRecord(body) || !isRecord(body.usage)) return;

    const { prompt_tokens: prompt, completion_tokens: reply } = body.usage;
    if (typeof prompt !== 'number' || typeof reply !== 'number') return;

    this.logger.log(`LLM tokens: prompt ${prompt}, reply ${reply}`);
  }
}
