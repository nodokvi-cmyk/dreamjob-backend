import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailClaimsModule } from '../email-claims/email-claims.module.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { User, userSchema } from './schema/user.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: userSchema }]),
    EmailClaimsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
