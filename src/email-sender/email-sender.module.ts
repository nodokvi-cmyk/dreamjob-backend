import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { EmailSenderService } from './email-sender.service.js';
import { mailTransportProvider } from './mail-transport.provider.js';

@Module({
  imports: [UsersModule],
  providers: [mailTransportProvider, EmailSenderService],
  exports: [EmailSenderService],
})
export class EmailSenderModule {}
