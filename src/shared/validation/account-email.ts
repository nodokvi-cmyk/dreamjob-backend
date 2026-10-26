import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { trimLowercase } from '../transforms/string.transforms.js';

export const AccountEmail = () =>
  applyDecorators(Transform(trimLowercase), IsEmail(), MaxLength(128));
