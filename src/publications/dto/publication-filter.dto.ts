import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
import {
  PUBLICATION_VIEW_STATUSES,
  type PublicationViewStatus,
} from '../schema/publication.schema.js';

export const PUBLICATION_LIST_SORTS = ['date', '-date'] as const;

export type PublicationListSort = (typeof PUBLICATION_LIST_SORTS)[number];

export class PublicationStatusFilterDto extends PaginationDto {
  @IsOptional()
  @IsIn(PUBLICATION_VIEW_STATUSES)
  status?: PublicationViewStatus;

  @IsOptional()
  @IsIn(PUBLICATION_LIST_SORTS)
  sort?: PublicationListSort;
}
