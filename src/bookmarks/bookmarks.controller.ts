import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { BookmarksService } from './bookmarks.service.js';

@Controller()
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Get('bookmarks')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  list(@AccountId() accountId: string, @Query() query: PaginationDto) {
    return this.bookmarksService.list(accountId, query);
  }

  @Post('vacancies/:id/bookmark')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  add(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.bookmarksService.add(id, accountId);
  }

  @Delete('vacancies/:id/bookmark')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  remove(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.bookmarksService.remove(id, accountId);
  }
}
