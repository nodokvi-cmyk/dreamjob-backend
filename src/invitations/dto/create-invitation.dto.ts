import { Transform } from 'class-transformer';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../shared/transforms/string.transforms.js';
import { MaxWords } from '../../shared/validation/max-words.js';
import {
  MAX_INVITATION_MESSAGE_LENGTH,
  MAX_INVITATION_MESSAGE_WORDS,
} from '../schema/invitation.schema.js';

export class CreateInvitationDto {
  @IsMongoId()
  vacancyId: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_INVITATION_MESSAGE_LENGTH)
  @MaxWords(MAX_INVITATION_MESSAGE_WORDS)
  message?: string;
}
