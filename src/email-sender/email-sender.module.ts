import { Module } from '@nestjs/common';
import { EmailSenderService } from './email-sender.service.js';
import { mailTransportProvider } from './mail-transport.provider.js';

@Module({
  providers: [mailTransportProvider, EmailSenderService],
  exports: [EmailSenderService],
})
export class EmailSenderModule {}
