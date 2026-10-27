import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { AccountRole } from '../shared/decorators/account-role.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { ChangePasswordDto } from '../shared/dto/change-password.dto.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { strictThrottle } from '../shared/throttle/strict-throttle.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { CompaniesService } from './companies.service.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

@Controller('companies')
@UseGuards(IsAuthGuard, RolesGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @Roles(AuthRole.ADMIN)
  findAll(@Query() paginationDto: PaginationDto) {
    return this.companiesService.findAll(paginationDto);
  }

  @Get(':id')
  findOne(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    this.assertSelfOrAdmin(id, accountId, accountRole);
    return this.companiesService.findOne(id);
  }

  @Patch(':id/approve')
  @Roles(AuthRole.ADMIN)
  approve(@Param() { id }: IsValidMongoIdDto) {
    return this.companiesService.approve(id);
  }

  @Patch(':id')
  update(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
    @Body() updateCompanyDto: UpdateCompanyDto,
  ) {
    this.assertSelf(id, accountId, accountRole);
    return this.companiesService.update(id, updateCompanyDto);
  }

  @Patch(':id/password')
  @Throttle(strictThrottle)
  async changePassword(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    this.assertSelf(id, accountId, accountRole);
    await this.companiesService.changePassword(id, changePasswordDto);

    return { message: 'Password updated' };
  }

  @Delete(':id')
  remove(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    this.assertSelfOrAdmin(id, accountId, accountRole);
    return this.companiesService.remove(id);
  }

  private assertSelf(
    id: string,
    accountId: string,
    accountRole: AuthRole,
  ): void {
    if (accountRole !== AuthRole.COMPANY || accountId !== id) {
      throw new ForbiddenException('No permission');
    }
  }

  private assertSelfOrAdmin(
    id: string,
    accountId: string,
    accountRole: AuthRole,
  ): void {
    if (accountRole === AuthRole.ADMIN) return;
    this.assertSelf(id, accountId, accountRole);
  }
}
