import { IsBoolean } from 'class-validator';

export class LockNotificationDto {
  @IsBoolean()
  locked!: boolean;
}
