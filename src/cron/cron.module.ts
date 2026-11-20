import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Application,
  applicationSchema,
} from '../applications/schema/application.schema.js';
import { AwsS3Module } from '../aws-s3/aws-s3.module.js';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import {
  EmailClaim,
  emailClaimSchema,
} from '../email-claims/schema/email-claim.schema.js';
import {
  Publication,
  publicationSchema,
} from '../publications/schema/publication.schema.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { Vacancy, vacancySchema } from '../vacancies/schema/vacancy.schema.js';
import { CronController } from './cron.controller.js';
import { CronSecretGuard } from './cron-secret.guard.js';
import { CronService } from './cron.service.js';
import { S3SweepService } from './s3-sweep.service.js';

@Module({
  imports: [
    AwsS3Module,
    MongooseModule.forFeature([
      { name: User.name, schema: userSchema },
      { name: Company.name, schema: companySchema },
      { name: EmailClaim.name, schema: emailClaimSchema },
      { name: Vacancy.name, schema: vacancySchema },
      { name: Application.name, schema: applicationSchema },
      { name: Publication.name, schema: publicationSchema },
    ]),
  ],
  controllers: [CronController],
  providers: [CronService, CronSecretGuard, S3SweepService],
})
export class CronModule {}
