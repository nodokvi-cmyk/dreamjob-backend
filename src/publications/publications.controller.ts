import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  publicationFileLimits,
  publicationFilePipe,
} from '../aws-s3/upload-file.js';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { AccountRole } from '../shared/decorators/account-role.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { AcceptingInvitesDto } from './dto/accepting-invites.dto.js';
import { CreatePublicationDto } from './dto/create-publication.dto.js';
import { PublicationStatusFilterDto } from './dto/publication-filter.dto.js';
import { RejectPublicationDto } from './dto/reject-publication.dto.js';
import { UpdatePublicationDto } from './dto/update-publication.dto.js';
import { PublicationsService } from './publications.service.js';

const cvInterceptor = FileInterceptor('cv', { limits: publicationFileLimits });
const coverLetterInterceptor = FileInterceptor('coverLetter', {
  limits: publicationFileLimits,
});

@Controller('publications')
export class PublicationsController {
  constructor(private readonly publicationsService: PublicationsService) {}

  @Post()
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  create(
    @AccountId() accountId: string,
    @Body() createPublicationDto: CreatePublicationDto,
  ) {
    return this.publicationsService.create(accountId, createPublicationDto);
  }

  @Get('mine')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  findMine(
    @AccountId() accountId: string,
    @Query() query: PublicationStatusFilterDto,
  ) {
    return this.publicationsService.listMine(accountId, query);
  }

  @Get('admin')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.ADMIN)
  findAllForAdmin(@Query() query: PublicationStatusFilterDto) {
    return this.publicationsService.listForAdmin(query);
  }

  @Get(':id')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.ADMIN)
  findOne(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.publicationsService.findOne(id, { accountId, accountRole });
  }

  @Get(':id/cv')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.ADMIN)
  getCv(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.publicationsService.fileUrl(
      id,
      { accountId, accountRole },
      'cvKey',
    );
  }

  @Get(':id/cover-letter')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.ADMIN)
  getCoverLetter(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.publicationsService.fileUrl(
      id,
      { accountId, accountRole },
      'coverLetterKey',
    );
  }

  @Patch(':id/approve')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.ADMIN)
  approve(@Param() { id }: IsValidMongoIdDto) {
    return this.publicationsService.approve(id);
  }

  @Patch(':id/reject')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.ADMIN)
  reject(
    @Param() { id }: IsValidMongoIdDto,
    @Body() { reason }: RejectPublicationDto,
  ) {
    return this.publicationsService.reject(id, reason);
  }

  @Patch(':id/close')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  close(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.publicationsService.close(id, accountId);
  }

  @Patch(':id/accepting-invites')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  setAcceptingInvites(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @Body() { acceptingInvites }: AcceptingInvitesDto,
  ) {
    return this.publicationsService.setAcceptingInvites(
      id,
      accountId,
      acceptingInvites,
    );
  }

  @Post(':id/extend')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  extend(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.publicationsService.extend(id, accountId);
  }

  @Patch(':id/cv')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  @UseInterceptors(cvInterceptor)
  setCv(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @UploadedFile(publicationFilePipe) file: Express.Multer.File,
  ) {
    return this.publicationsService.setFile(id, accountId, 'cvKey', file);
  }

  @Patch(':id/cover-letter')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  @UseInterceptors(coverLetterInterceptor)
  setCoverLetter(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @UploadedFile(publicationFilePipe) file: Express.Multer.File,
  ) {
    return this.publicationsService.setFile(
      id,
      accountId,
      'coverLetterKey',
      file,
    );
  }

  @Delete(':id/cv')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  removeCv(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.publicationsService.removeFile(id, accountId, 'cvKey');
  }

  @Delete(':id/cover-letter')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  removeCoverLetter(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
  ) {
    return this.publicationsService.removeFile(id, accountId, 'coverLetterKey');
  }

  @Patch(':id')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  update(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @Body() updatePublicationDto: UpdatePublicationDto,
  ) {
    return this.publicationsService.update(id, accountId, updatePublicationDto);
  }

  @Delete(':id')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  remove(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.publicationsService.remove(id, accountId);
  }
}
