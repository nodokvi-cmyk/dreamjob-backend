import { IsBoolean } from 'class-validator';

export class CvVisibilityDto {
  @IsBoolean()
  isCvPublic!: boolean;
}
