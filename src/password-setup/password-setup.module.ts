import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { PasswordSetupService } from './password-setup.service.js';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: userSchema },
      { name: Company.name, schema: companySchema },
    ]),
  ],
  providers: [PasswordSetupService],
  exports: [PasswordSetupService],
})
export class PasswordSetupModule {}
