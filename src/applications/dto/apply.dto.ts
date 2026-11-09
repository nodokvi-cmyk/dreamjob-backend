import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { toBoolean, trim } from '../../shared/transforms/string.transforms.js';
import { MaxWords } from '../../shared/validation/max-words.js';
import {
  MAX_APPLICATION_MESSAGE_LENGTH,
  MAX_APPLICATION_MESSAGE_WORDS,
} from '../schema/application.schema.js';

export class ApplyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_APPLICATION_MESSAGE_LENGTH)
  @MaxWords(MAX_APPLICATION_MESSAGE_WORDS)
  message?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  useProfileCv?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  keepPrevious?: boolean;
}
