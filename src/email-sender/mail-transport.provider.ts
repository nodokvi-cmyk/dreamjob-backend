import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export type MailTransport = Pick<Transporter, 'sendMail'>;

export const mailTransportProvider: FactoryProvider<MailTransport> = {
  provide: MAIL_TRANSPORT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    createTransport({
      host: config.getOrThrow<string>('EMAIL_HOST'),
      port: Number(config.getOrThrow<string>('EMAIL_PORT')),
      secure: false,
      requireTLS: true,
      auth: {
        user: config.getOrThrow<string>('EMAIL_USER'),
        pass: config.getOrThrow<string>('EMAIL_PASS'),
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    }),
};
