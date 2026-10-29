import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AwsS3Module } from '../aws-s3/aws-s3.module.js';
import { EmailClaimsModule } from '../email-claims/email-claims.module.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { Company, companySchema } from './schema/company.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Company.name, schema: companySchema }]),
    EmailClaimsModule,
    AwsS3Module,
  ],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
