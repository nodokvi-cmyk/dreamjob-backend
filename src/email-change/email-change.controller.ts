import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { strictThrottle } from '../shared/throttle/strict-throttle.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { EmailChangeService } from './email-change.service.js';
import { ChangeEmailDto } from './dto/change-email.dto.js';
import { CodeDto } from '../shared/dto/code.dto.js';

@Controller('auth')
@UseGuards(IsAuthGuard, RolesGuard)
@Throttle(strictThrottle)
export class EmailChangeController {
  constructor(private readonly emailChangeService: EmailChangeService) {}

  @Post('users/email-change/request')
  @HttpCode(HttpStatus.OK)
  @Roles(AuthRole.USER, AuthRole.ADMIN)
  requestUserEmailChange(
    @AccountId() accountId: string,
    @Body() changeEmailDto: ChangeEmailDto,
  ) {
    return this.emailChangeService.requestUserEmailChange(
      accountId,
      changeEmailDto,
    );
  }

  @Post('users/email-change/confirm-current')
  @HttpCode(HttpStatus.OK)
  @Roles(AuthRole.USER, AuthRole.ADMIN)
  confirmUserCurrentEmail(
    @AccountId() accountId: string,
    @Body() codeDto: CodeDto,
  ) {
    return this.emailChangeService.confirmUserCurrentEmail(accountId, codeDto);
  }

  @Post('users/email-change/confirm-new')
  @HttpCode(HttpStatus.OK)
  @Roles(AuthRole.USER, AuthRole.ADMIN)
  confirmUserNewEmail(
    @AccountId() accountId: string,
    @Body() codeDto: CodeDto,
  ) {
    return this.emailChangeService.confirmUserNewEmail(accountId, codeDto);
  }

  @Post('companies/email-change/request')
  @HttpCode(HttpStatus.OK)
  @Roles(AuthRole.COMPANY)
  requestCompanyEmailChange(
    @AccountId() accountId: string,
    @Body() changeEmailDto: ChangeEmailDto,
  ) {
    return this.emailChangeService.requestCompanyEmailChange(
      accountId,
      changeEmailDto,
    );
  }

  @Post('companies/email-change/confirm-current')
  @HttpCode(HttpStatus.OK)
  @Roles(AuthRole.COMPANY)
  confirmCompanyCurrentEmail(
    @AccountId() accountId: string,
    @Body() codeDto: CodeDto,
  ) {
    return this.emailChangeService.confirmCompanyCurrentEmail(
      accountId,
      codeDto,
    );
  }

  @Post('companies/email-change/confirm-new')
  @HttpCode(HttpStatus.OK)
  @Roles(AuthRole.COMPANY)
  confirmCompanyNewEmail(
    @AccountId() accountId: string,
    @Body() codeDto: CodeDto,
  ) {
    return this.emailChangeService.confirmCompanyNewEmail(accountId, codeDto);
  }
}
