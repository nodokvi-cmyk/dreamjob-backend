import { IsEnum, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
import {
  InvitationStatus,
  USER_VISIBLE_INVITATION_STATUSES,
} from '../schema/invitation.schema.js';

class InvitationListFilterDto extends PaginationDto {
  @IsOptional()
  @IsMongoId()
  vacancyId?: string;
}

export class SentInvitationsFilterDto extends InvitationListFilterDto {
  @IsOptional()
  @IsEnum(InvitationStatus)
  status?: InvitationStatus;
}

export class MyInvitationsFilterDto extends InvitationListFilterDto {
  @IsOptional()
  @IsIn(USER_VISIBLE_INVITATION_STATUSES)
  status?: (typeof USER_VISIBLE_INVITATION_STATUSES)[number];

  @IsOptional()
  @IsMongoId()
  focus?: string;
}
