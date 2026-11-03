import { PartialType } from '@nestjs/mapped-types';
import { CreateVacancyDto } from './create-vacancy.dto.js';

export class UpdateVacancyDto extends PartialType(CreateVacancyDto) {}
