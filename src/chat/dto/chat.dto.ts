import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { trim } from '../../shared/transforms/string.transforms.js';

export const CHAT_MESSAGE_ROLES = ['user', 'assistant'] as const;

export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export const MAX_CHAT_MESSAGES = 12;
export const MAX_CHAT_MESSAGE_LENGTH = 3000;
export const MAX_CHAT_TOTAL_LENGTH = 8000;

export class ChatMessageDto {
  @IsIn(CHAT_MESSAGE_ROLES)
  role: ChatMessageRole;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
  content: string;
}

export class ChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CHAT_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];
}
