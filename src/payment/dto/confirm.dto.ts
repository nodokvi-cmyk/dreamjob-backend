import { IsString, Matches, MaxLength } from 'class-validator';

export class ConfirmDto {
  @IsString()
  @MaxLength(255)
  @Matches(/^cs_[A-Za-z0-9_]+$/)
  sessionId!: string;
}
