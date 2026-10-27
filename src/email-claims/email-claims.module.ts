import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailClaimsService } from './email-claims.service.js';
import { EmailClaim, emailClaimSchema } from './schema/email-claim.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailClaim.name, schema: emailClaimSchema },
    ]),
  ],
  providers: [EmailClaimsService],
  exports: [EmailClaimsService],
})
export class EmailClaimsModule {}
