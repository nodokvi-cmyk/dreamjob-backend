import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import { createElement } from 'react';

export enum OtpEmailVariant {
  VERIFICATION = 'verification',
  PASSWORD_RESET = 'passwordReset',
}

export interface OtpEmailProps {
  code: string;
  expiresInMinutes: number;
  variant?: OtpEmailVariant;
}

const copyByVariant = {
  [OtpEmailVariant.VERIFICATION]: {
    subject: 'Your GetDreamJob verification code',
    heading: 'Verify your email',
    intro: 'Use this code to verify your email.',
  },
  [OtpEmailVariant.PASSWORD_RESET]: {
    subject: 'Your GetDreamJob password reset code',
    heading: 'Reset your password',
    intro: 'Use this code to reset your password.',
  },
} satisfies Record<
  OtpEmailVariant,
  { subject: string; heading: string; intro: string }
>;

export function OtpEmail({
  code,
  expiresInMinutes,
  variant = OtpEmailVariant.VERIFICATION,
}: OtpEmailProps) {
  const { subject, heading, intro } = copyByVariant[variant];

  return createElement(
    Html,
    { lang: 'en' },
    createElement(Head),
    createElement(Preview, null, `${subject} is ${code}`),
    createElement(
      Body,
      {
        style: { backgroundColor: '#f4f4f5', fontFamily: 'Arial, sans-serif' },
      },
      createElement(
        Container,
        {
          style: {
            backgroundColor: '#ffffff',
            borderRadius: 8,
            margin: '24px auto',
            padding: 32,
            maxWidth: 480,
          },
        },
        createElement(
          Heading,
          { as: 'h1', style: { fontSize: 22, margin: '0 0 16px' } },
          heading,
        ),
        createElement(
          Text,
          { style: { fontSize: 15, color: '#3f3f46' } },
          `${intro} It expires in ${expiresInMinutes} minutes.`,
        ),
        createElement(
          Section,
          { style: { textAlign: 'center', margin: '24px 0' } },
          createElement(
            Text,
            {
              style: {
                display: 'inline-block',
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: 8,
                padding: '12px 24px',
                backgroundColor: '#f4f4f5',
                borderRadius: 6,
              },
            },
            code,
          ),
        ),
        createElement(
          Text,
          { style: { fontSize: 13, color: '#71717a' } },
          'If you requested more than one code, only the newest one works. If you did not request this, you can ignore this email.',
        ),
      ),
    ),
  );
}

export async function renderOtpEmail(props: OtpEmailProps) {
  const element = createElement(OtpEmail, props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return {
    subject:
      copyByVariant[props.variant ?? OtpEmailVariant.VERIFICATION].subject,
    html,
    text,
  };
}
