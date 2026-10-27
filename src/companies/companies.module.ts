import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailClaimsModule } from '../email-claims/email-claims.module.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { Company, companySchema } from './schema/company.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Company.name, schema: companySchema }]),
    EmailClaimsModule,
  ],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
