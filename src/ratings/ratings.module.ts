import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { Rating, ratingSchema } from './schema/rating.schema.js';
import { RatingsController } from './ratings.controller.js';
import { RatingsService } from './ratings.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Rating.name, schema: ratingSchema },
      { name: Company.name, schema: companySchema },
    ]),
  ],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
