import { IntersectionType } from '@nestjs/mapped-types';
import { CodeDto } from '../../shared/dto/code.dto.js';
import { EmailDto } from './email.dto.js';

export class VerifyEmailDto extends IntersectionType(EmailDto, CodeDto) {}
