import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  applicationUploadLimits,
  type ApplicationFiles,
} from '../aws-s3/upload-file.js';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { AccountRole } from '../shared/decorators/account-role.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { strictThrottle } from '../shared/throttle/strict-throttle.js';
import { Throttle } from '../shared/throttle/throttle.decorator.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { ApplicationsService } from './applications.service.js';
import { ApplicantsFilterDto } from './dto/applicants-filter.dto.js';
import { ApplyDto } from './dto/apply.dto.js';
import { MyApplicationsFilterDto } from './dto/my-applications-filter.dto.js';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto.js';

const applicationFilesInterceptor = FileFieldsInterceptor(
  [
    { name: 'cv', maxCount: 1 },
    { name: 'coverLetter', maxCount: 1 },
  ],
  { limits: applicationUploadLimits },
);

@Controller()
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get('applications/mine')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  listMine(
    @AccountId() accountId: string,
    @Query() query: MyApplicationsFilterDto,
  ) {
    return this.applicationsService.listMine(accountId, query);
  }

  @Get('vacancies/:id/applications')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  listApplicants(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @Query() query: ApplicantsFilterDto,
  ) {
    return this.applicationsService.listApplicants(id, accountId, query);
  }

  @Patch('applications/:id/status')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  updateStatus(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @Body() updateStatusDto: UpdateApplicationStatusDto,
  ) {
    return this.applicationsService.updateStatus(
      id,
      accountId,
      updateStatusDto,
    );
  }

  @Get('applications/:id/cv')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.COMPANY)
  getCv(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.applicationsService.fileUrl(
      id,
      { accountId, accountRole },
      'cvKey',
    );
  }

  @Get('applications/:id/cover-letter')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER, AuthRole.COMPANY)
  getCoverLetter(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.applicationsService.fileUrl(
      id,
      { accountId, accountRole },
      'coverLetterKey',
    );
  }

  @Post('vacancies/:id/applications')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  @Throttle(strictThrottle)
  @UseInterceptors(applicationFilesInterceptor)
  apply(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @Body() applyDto: ApplyDto,
    @UploadedFiles() files: ApplicationFiles | undefined,
  ) {
    return this.applicationsService.apply(id, accountId, applyDto, files);
  }

  @Patch('applications/:id/withdraw')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  @Throttle(strictThrottle)
  withdraw(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.applicationsService.withdraw(id, accountId);
  }
}
