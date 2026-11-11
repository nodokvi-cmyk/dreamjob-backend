import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationsModule } from '../applications/applications.module.js';
import { AwsS3Module } from '../aws-s3/aws-s3.module.js';
import { BookmarksModule } from '../bookmarks/bookmarks.module.js';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { Vacancy, vacancySchema } from './schema/vacancy.schema.js';
import { VacanciesController } from './vacancies.controller.js';
import { VacanciesService } from './vacancies.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Vacancy.name, schema: vacancySchema },
      { name: Company.name, schema: companySchema },
    ]),
    AwsS3Module,
    PaymentModule,
    ApplicationsModule,
    BookmarksModule,
    NotificationsModule,
  ],
  controllers: [VacanciesController],
  providers: [VacanciesService],
  exports: [VacanciesService],
})
export class VacanciesModule {}
