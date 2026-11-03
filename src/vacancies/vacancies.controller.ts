import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  optionalUploadFilesPipe,
  uploadFilesPipe,
  uploadLimitsFor,
} from '../aws-s3/upload-file.js';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { OptionalAuthGuard } from '../guards/optional-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { AccountRole } from '../shared/decorators/account-role.decorator.js';
import { OptionalViewer } from '../shared/decorators/optional-viewer.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { AuthRole } from '../shared/types/auth-role.js';
import type { Viewer } from '../shared/types/viewer.js';
import { CreateVacancyDto } from './dto/create-vacancy.dto.js';
import { RejectVacancyDto } from './dto/reject-vacancy.dto.js';
import { UpdateVacancyDto } from './dto/update-vacancy.dto.js';
import {
  AdminVacanciesFilterDto,
  OwnVacanciesFilterDto,
  VacancyFilterDto,
} from './dto/vacancy-filter.dto.js';
import { VacancyPhotoParamsDto } from './dto/vacancy-photo-params.dto.js';
import { MAX_VACANCY_PHOTOS } from './schema/vacancy.schema.js';
import { VacanciesService } from './vacancies.service.js';

const photosInterceptor = FilesInterceptor('photos', MAX_VACANCY_PHOTOS, {
  limits: uploadLimitsFor(MAX_VACANCY_PHOTOS),
});

@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly vacanciesService: VacanciesService) {}

  @Get()
  findAll(@Query() query: VacancyFilterDto) {
    return this.vacanciesService.listPublic(query);
  }

  @Get('mine')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  findMine(
    @AccountId() accountId: string,
    @Query() query: OwnVacanciesFilterDto,
  ) {
    return this.vacanciesService.listOwn(accountId, query);
  }

  @Get('admin')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.ADMIN)
  findAllForAdmin(@Query() query: AdminVacanciesFilterDto) {
    return this.vacanciesService.listAll(query);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  findOne(
    @Param() { id }: IsValidMongoIdDto,
    @OptionalViewer() viewer: Viewer | null,
  ) {
    return this.vacanciesService.findOne(id, viewer);
  }

  @Post()
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  @UseInterceptors(photosInterceptor)
  create(
    @AccountId() accountId: string,
    @Body() createVacancyDto: CreateVacancyDto,
    @UploadedFiles(optionalUploadFilesPipe)
    files: Express.Multer.File[] | undefined,
  ) {
    return this.vacanciesService.create(accountId, createVacancyDto, files);
  }

  @Patch(':id/close')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  close(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.vacanciesService.close(id, accountId);
  }

  @Patch(':id/approve')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.ADMIN)
  approve(@Param() { id }: IsValidMongoIdDto) {
    return this.vacanciesService.approve(id);
  }

  @Patch(':id/reject')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.ADMIN)
  reject(
    @Param() { id }: IsValidMongoIdDto,
    @Body() { reason }: RejectVacancyDto,
  ) {
    return this.vacanciesService.reject(id, reason);
  }

  @Patch(':id')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  update(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @Body() updateVacancyDto: UpdateVacancyDto,
  ) {
    return this.vacanciesService.update(id, accountId, updateVacancyDto);
  }

  @Post(':id/photos')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  @UseInterceptors(photosInterceptor)
  addPhotos(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @UploadedFiles(uploadFilesPipe) files: Express.Multer.File[],
  ) {
    return this.vacanciesService.addPhotos(id, accountId, files);
  }

  @Delete(':id/photos/:photoId')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  removePhoto(
    @Param() { id, photoId }: VacancyPhotoParamsDto,
    @AccountId() accountId: string,
  ) {
    return this.vacanciesService.removePhoto(id, accountId, photoId);
  }

  @Delete(':id')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY, AuthRole.ADMIN)
  remove(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.vacanciesService.remove(id, accountId, accountRole);
  }
}
