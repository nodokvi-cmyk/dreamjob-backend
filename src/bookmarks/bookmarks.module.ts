import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { Vacancy, vacancySchema } from '../vacancies/schema/vacancy.schema.js';
import { BookmarksController } from './bookmarks.controller.js';
import { BookmarksService } from './bookmarks.service.js';
import { Bookmark, bookmarkSchema } from './schema/bookmark.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bookmark.name, schema: bookmarkSchema },
      { name: Vacancy.name, schema: vacancySchema },
      { name: Company.name, schema: companySchema },
      { name: User.name, schema: userSchema },
    ]),
  ],
  controllers: [BookmarksController],
  providers: [BookmarksService],
  exports: [BookmarksService],
})
export class BookmarksModule {}
