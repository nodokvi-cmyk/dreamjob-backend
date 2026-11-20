import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import {
  EmailClaim,
  emailClaimSchema,
} from '../email-claims/schema/email-claim.schema.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { CronController } from './cron.controller.js';
import { CronSecretGuard } from './cron-secret.guard.js';
import { CronService } from './cron.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: userSchema },
      { name: Company.name, schema: companySchema },
      { name: EmailClaim.name, schema: emailClaimSchema },
    ]),
  ],
  controllers: [CronController],
  providers: [CronService, CronSecretGuard],
})
export class CronModule {}
