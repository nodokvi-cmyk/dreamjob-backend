import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailSenderModule } from '../email-sender/email-sender.module.js';
import { User, userSchema } from '../users/schema/user.schema.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: userSchema }]),
    UsersModule,
    EmailSenderModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
