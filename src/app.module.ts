import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ApplicationsModule } from './applications/applications.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BookmarksModule } from './bookmarks/bookmarks.module.js';
import { ChatModule } from './chat/chat.module.js';
import { EmailChangeModule } from './email-change/email-change.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { validateEnv } from './config/env.validation.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PasswordSetupModule } from './password-setup/password-setup.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { PublicationsModule } from './publications/publications.module.js';
import { RateLimitGuard } from './shared/throttle/rate-limit.guard.js';
import { SharedRateCounter } from './shared/throttle/shared-rate-counter.js';
import { UsersModule } from './users/users.module.js';
import { VacanciesModule } from './vacancies/vacancies.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
    PasswordSetupModule,
    UsersModule,
    CompaniesModule,
    VacanciesModule,
    ApplicationsModule,
    BookmarksModule,
    AuthModule,
    EmailChangeModule,
    PaymentModule,
    NotificationsModule,
    PublicationsModule,
    InvitationsModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SharedRateCounter,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
