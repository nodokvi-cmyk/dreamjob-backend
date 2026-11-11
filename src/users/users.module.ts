import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApplicationsModule } from '../applications/applications.module.js';
import { AwsS3Module } from '../aws-s3/aws-s3.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { EmailClaimsModule } from '../email-claims/email-claims.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { User, userSchema } from './schema/user.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: userSchema }]),
    EmailClaimsModule,
    AwsS3Module,
    CompaniesModule,
    ApplicationsModule,
    NotificationsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
