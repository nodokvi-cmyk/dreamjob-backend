import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { uploadFilePipe, uploadLimits } from '../aws-s3/upload-file.js';
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
import { CvVisibilityDto } from './dto/cv-visibility.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(IsAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(AuthRole.ADMIN)
  async findAll(@Query() paginationDto: PaginationDto) {
    const result = await this.usersService.findAll(paginationDto);

    return {
      ...result,
      items: result.items.map((user) => this.usersService.toResponse(user)),
    };
  }

  @Get(':id')
  async findOne(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    this.assertSelfOrAdmin(id, accountId, accountRole);
    return this.usersService.toResponse(await this.usersService.findOne(id));
  }

  @Get(':id/cv')
  getCv(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.usersService.getCvUrl(id, accountId, accountRole);
  }

  @Patch(':id')
  async update(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    this.assertSelf(id, accountId, accountRole);
    return this.usersService.toResponse(
      await this.usersService.update(id, updateUserDto),
    );
  }

  @Patch(':id/avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: uploadLimits }))
  setAvatar(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
    @UploadedFile(uploadFilePipe) file: Express.Multer.File,
  ) {
    this.assertSelf(id, accountId, accountRole);
    return this.usersService.setAvatar(id, file);
  }

  @Delete(':id/avatar')
  removeAvatar(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    this.assertSelf(id, accountId, accountRole);
    return this.usersService.removeAvatar(id);
  }

  @Patch(':id/cv')
  @UseInterceptors(FileInterceptor('cv', { limits: uploadLimits }))
  setCv(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
    @UploadedFile(uploadFilePipe) file: Express.Multer.File,
  ) {
    this.assertSelf(id, accountId, accountRole);
    return this.usersService.setCv(id, file);
  }

  @Delete(':id/cv')
  removeCv(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    this.assertSelf(id, accountId, accountRole);
    return this.usersService.removeCv(id);
  }

  @Patch(':id/cv-visibility')
  setCvVisibility(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
    @Body() { isCvPublic }: CvVisibilityDto,
  ) {
    this.assertSelf(id, accountId, accountRole);
    return this.usersService.setCvVisibility(id, isCvPublic);
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
    await this.usersService.changePassword(id, changePasswordDto);

    return { message: 'Password updated' };
  }

  @Delete(':id')
  async remove(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    this.assertSelfOrAdmin(id, accountId, accountRole);
    return this.usersService.toResponse(await this.usersService.remove(id));
  }

  private assertSelf(
    id: string,
    accountId: string,
    accountRole: AuthRole,
  ): void {
    if (accountRole === AuthRole.COMPANY || accountId !== id) {
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
