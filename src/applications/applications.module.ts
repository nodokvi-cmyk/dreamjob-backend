import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AwsS3Module } from '../aws-s3/aws-s3.module.js';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { Vacancy, vacancySchema } from '../vacancies/schema/vacancy.schema.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { Application, applicationSchema } from './schema/application.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Application.name, schema: applicationSchema },
      { name: Vacancy.name, schema: vacancySchema },
      { name: Company.name, schema: companySchema },
      { name: User.name, schema: userSchema },
    ]),
    AwsS3Module,
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
