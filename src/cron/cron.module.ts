import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Application,
  applicationSchema,
} from '../applications/schema/application.schema.js';
import { ApplicationsModule } from '../applications/applications.module.js';
import { AwsS3Module } from '../aws-s3/aws-s3.module.js';
import { BookmarksModule } from '../bookmarks/bookmarks.module.js';
import { InvitationsModule } from '../invitations/invitations.module.js';
import {
  Bookmark,
  bookmarkSchema,
} from '../bookmarks/schema/bookmark.schema.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import {
  EmailClaim,
  emailClaimSchema,
} from '../email-claims/schema/email-claim.schema.js';
import {
  Invitation,
  invitationSchema,
} from '../invitations/schema/invitation.schema.js';
import {
  Notification,
  notificationSchema,
} from '../notifications/schema/notification.schema.js';
import {
  Publication,
  publicationSchema,
} from '../publications/schema/publication.schema.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { UsersModule } from '../users/users.module.js';
import { Vacancy, vacancySchema } from '../vacancies/schema/vacancy.schema.js';
import { CronController } from './cron.controller.js';
import { CronSecretGuard } from './cron-secret.guard.js';
import { CronService } from './cron.service.js';
import { S3SweepService } from './s3-sweep.service.js';

@Module({
  imports: [
    AwsS3Module,
    UsersModule,
    CompaniesModule,
    ApplicationsModule,
    BookmarksModule,
    InvitationsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: userSchema },
      { name: Company.name, schema: companySchema },
      { name: EmailClaim.name, schema: emailClaimSchema },
      { name: Vacancy.name, schema: vacancySchema },
      { name: Application.name, schema: applicationSchema },
      { name: Publication.name, schema: publicationSchema },
      { name: Bookmark.name, schema: bookmarkSchema },
      { name: Notification.name, schema: notificationSchema },
      { name: Invitation.name, schema: invitationSchema },
    ]),
  ],
  controllers: [CronController],
  providers: [CronService, CronSecretGuard, S3SweepService],
})
export class CronModule {}
