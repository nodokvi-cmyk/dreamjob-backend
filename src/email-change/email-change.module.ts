import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module.js';
import { EmailClaimsModule } from '../email-claims/email-claims.module.js';
import { EmailSenderModule } from '../email-sender/email-sender.module.js';
import { UsersModule } from '../users/users.module.js';
import { EmailChangeController } from './email-change.controller.js';
import { EmailChangeService } from './email-change.service.js';

@Module({
  imports: [UsersModule, CompaniesModule, EmailClaimsModule, EmailSenderModule],
  controllers: [EmailChangeController],
  providers: [EmailChangeService],
})
export class EmailChangeModule {}
