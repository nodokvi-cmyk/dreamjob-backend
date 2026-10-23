import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EmailDto } from './email.dto.js';

export class SignInDto extends EmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  password!: string;
}
