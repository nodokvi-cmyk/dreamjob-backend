import { IsUUID } from 'class-validator';
import { IsValidMongoIdDto } from '../../shared/dto/is-valid-mongo-id.dto.js';

export class VacancyPhotoParamsDto extends IsValidMongoIdDto {
  @IsUUID('4')
  photoId!: string;
}
