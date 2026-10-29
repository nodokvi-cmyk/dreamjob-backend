import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CompaniesModule } from '../companies/companies.module.js';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { EmailClaimsModule } from '../email-claims/email-claims.module.js';
import { EmailSenderModule } from '../email-sender/email-sender.module.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleTokenVerifier } from './google-token-verifier.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: userSchema },
      { name: Company.name, schema: companySchema },
    ]),
    UsersModule,
    CompaniesModule,
    EmailClaimsModule,
    EmailSenderModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleTokenVerifier],
})
export class AuthModule {}
