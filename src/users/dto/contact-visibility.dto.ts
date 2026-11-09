import { IsBoolean, IsOptional } from 'class-validator';

export class ContactVisibilityDto {
  @IsOptional()
  @IsBoolean()
  isEmailPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  isPhonePublic?: boolean;
}
