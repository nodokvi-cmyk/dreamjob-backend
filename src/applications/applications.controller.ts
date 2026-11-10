import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
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
import { Roles } from '../shared/decorators/roles.decorator.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { strictThrottle } from '../shared/throttle/strict-throttle.js';
import { Throttle } from '../shared/throttle/throttle.decorator.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { ApplicationsService } from './applications.service.js';
import { ApplyDto } from './dto/apply.dto.js';

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
