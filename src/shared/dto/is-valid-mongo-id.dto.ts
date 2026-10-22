import { IsMongoId } from 'class-validator';

export class IsValidMongoIdDto {
  @IsMongoId()
  id!: string;
}
