import { IsIn } from 'class-validator';
import {
  COMPANY_APPLICATION_STATUSES,
  type CompanyApplicationStatus,
} from '../schema/application.schema.js';

export class UpdateApplicationStatusDto {
  @IsIn(COMPANY_APPLICATION_STATUSES)
  status!: CompanyApplicationStatus;
}
