import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { Company, companySchema } from './schema/company.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Company.name, schema: companySchema }]),
  ],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
