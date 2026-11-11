import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { AccountRole } from '../shared/decorators/account-role.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { LockNotificationDto } from './dto/lock-notification.dto.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.COMPANY)
  list(
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
    @Query() query: PaginationDto,
  ) {
    return this.notificationsService.list(accountId, accountRole, query);
  }

  @Get('badge')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.COMPANY)
  badge(@AccountId() accountId: string, @AccountRole() accountRole: AuthRole) {
    return this.notificationsService.badge(accountId, accountRole);
  }

  @Patch('seen')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.COMPANY)
  markSeen(
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.notificationsService.markSeen(accountId, accountRole);
  }

  @Delete()
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.COMPANY)
  clearAll(
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.notificationsService.clearAll(accountId, accountRole);
  }

  @Patch(':id/read')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.COMPANY)
  markRead(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.notificationsService.markRead(id, accountId, accountRole);
  }

  @Patch(':id/lock')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.COMPANY)
  setLock(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
    @Body() { locked }: LockNotificationDto,
  ) {
    return this.notificationsService.setLock(
      id,
      accountId,
      accountRole,
      locked,
    );
  }

  @Delete(':id')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.COMPANY)
  remove(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.notificationsService.remove(id, accountId, accountRole);
  }
}
