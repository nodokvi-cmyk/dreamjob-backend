import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { EmailSenderModule } from '../email-sender/email-sender.module.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import {
  Notification,
  notificationSchema,
} from './schema/notification.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: notificationSchema },
      { name: User.name, schema: userSchema },
      { name: Company.name, schema: companySchema },
    ]),
    EmailSenderModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
