import { IsBoolean } from 'class-validator';

export class ProfileVisibilityDto {
  @IsBoolean()
  isProfilePublic!: boolean;
}
