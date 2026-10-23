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
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { Roles } from './decorators/roles.decorator.js';
import { UserId } from './decorators/user-id.decorator.js';
import { UserRoleParam } from './decorators/user-role.decorator.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserRole } from './schema/user.schema.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(IsAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  findAll(@Query() paginationDto: PaginationDto) {
    return this.usersService.findAll(paginationDto);
  }

  @Get(':id')
  findOne(
    @Param() { id }: IsValidMongoIdDto,
    @UserId() userId: string,
    @UserRoleParam() userRole: UserRole,
  ) {
    this.assertSelfOrAdmin(id, userId, userRole);
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param() { id }: IsValidMongoIdDto,
    @UserId() userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    this.assertSelf(id, userId);
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(
    @Param() { id }: IsValidMongoIdDto,
    @UserId() userId: string,
    @UserRoleParam() userRole: UserRole,
  ) {
    this.assertSelfOrAdmin(id, userId, userRole);
    return this.usersService.remove(id);
  }

  private assertSelf(id: string, userId: string): void {
    if (userId !== id) throw new ForbiddenException('No permission');
  }

  private assertSelfOrAdmin(
    id: string,
    userId: string,
    userRole: UserRole,
  ): void {
    if (userRole !== UserRole.ADMIN && userId !== id) {
      throw new ForbiddenException('No permission');
    }
  }
}
