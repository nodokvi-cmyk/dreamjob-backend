import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AwsS3Module } from '../aws-s3/aws-s3.module.js';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { PublicationsController } from './publications.controller.js';
import { PublicationsService } from './publications.service.js';
import { Publication, publicationSchema } from './schema/publication.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Publication.name, schema: publicationSchema },
      { name: User.name, schema: userSchema },
      { name: Company.name, schema: companySchema },
    ]),
    AwsS3Module,
    NotificationsModule,
  ],
  controllers: [PublicationsController],
  providers: [PublicationsService],
  exports: [PublicationsService],
})
export class PublicationsModule {}
