import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationsModule } from '../applications/applications.module.js';
import {
  Application,
  applicationSchema,
} from '../applications/schema/application.schema.js';
import { AwsS3Module } from '../aws-s3/aws-s3.module.js';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import {
  Publication,
  publicationSchema,
} from '../publications/schema/publication.schema.js';
import { Vacancy, vacancySchema } from '../vacancies/schema/vacancy.schema.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { Invitation, invitationSchema } from './schema/invitation.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invitation.name, schema: invitationSchema },
      { name: Publication.name, schema: publicationSchema },
      { name: Vacancy.name, schema: vacancySchema },
      { name: Company.name, schema: companySchema },
      { name: Application.name, schema: applicationSchema },
    ]),
    AwsS3Module,
    ApplicationsModule,
    NotificationsModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
