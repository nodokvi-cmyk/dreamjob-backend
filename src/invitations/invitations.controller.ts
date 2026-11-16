import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { strictThrottle } from '../shared/throttle/strict-throttle.js';
import { Throttle } from '../shared/throttle/throttle.decorator.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import {
  MyInvitationsFilterDto,
  SentInvitationsFilterDto,
} from './dto/invitation-filter.dto.js';
import { InvitationsService } from './invitations.service.js';

@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('publications/:id/invitations')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  invite(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @Body() createInvitationDto: CreateInvitationDto,
  ) {
    return this.invitationsService.invite(id, accountId, createInvitationDto);
  }

  @Get('invitations/sent')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  listSent(
    @AccountId() accountId: string,
    @Query() query: SentInvitationsFilterDto,
  ) {
    return this.invitationsService.listSent(accountId, query);
  }

  @Get('invitations/quota')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  quota(@AccountId() accountId: string) {
    return this.invitationsService.quota(accountId);
  }

  @Get('invitations/mine')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  listMine(
    @AccountId() accountId: string,
    @Query() query: MyInvitationsFilterDto,
  ) {
    return this.invitationsService.listMine(accountId, query);
  }

  @Patch('invitations/:id/accept')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  @Throttle(strictThrottle)
  accept(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.invitationsService.accept(id, accountId);
  }

  @Patch('invitations/:id/decline')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  decline(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.invitationsService.decline(id, accountId);
  }

  @Delete('invitations/:id')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  cancel(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.invitationsService.cancel(id, accountId);
  }
}
