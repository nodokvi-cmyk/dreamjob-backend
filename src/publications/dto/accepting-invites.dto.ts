import { IsBoolean } from 'class-validator';

export class AcceptingInvitesDto {
  @IsBoolean()
  acceptingInvites!: boolean;
}
