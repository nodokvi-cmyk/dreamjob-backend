import { applyDecorators } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';

const STRONG_PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s])[\x20-\x7E]+$/;

export const StrongPassword = () =>
  applyDecorators(
    IsString(),
    Length(8, 64),
    Matches(STRONG_PASSWORD_PATTERN, {
      message:
        'password must include an uppercase letter, a lowercase letter, a number and a symbol, and may contain only English letters, digits, spaces and standard symbols',
    }),
  );
