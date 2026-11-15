import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
import { InvitationStatus } from '../schema/invitation.schema.js';

export class SentInvitationsFilterDto extends PaginationDto {
  @IsOptional()
  @IsEnum(InvitationStatus)
  status?: InvitationStatus;

  @IsOptional()
  @IsMongoId()
  vacancyId?: string;
}

export class MyInvitationsFilterDto extends SentInvitationsFilterDto {
  @IsOptional()
  @IsMongoId()
  focus?: string;
}
