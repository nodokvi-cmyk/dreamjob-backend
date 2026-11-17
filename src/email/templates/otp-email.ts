import { Section, Text } from '@react-email/components';
import { render } from '@react-email/render';
import { createElement } from 'react';
import { BRAND_COLORS, BRAND_FONTS, BRAND_RADIUS } from '../brand.js';
import type { EmailLinks } from '../brand.js';
import { EmailFinePrint, EmailLayout, EmailParagraph } from './email-layout.js';

export enum OtpEmailVariant {
  VERIFICATION = 'verification',
  PASSWORD_RESET = 'passwordReset',
  EMAIL_CHANGE_CURRENT = 'emailChangeCurrent',
  EMAIL_CHANGE_NEW = 'emailChangeNew',
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
  [OtpEmailVariant.EMAIL_CHANGE_CURRENT]: {
    subject: 'Confirm your GetDreamJob email change',
    heading: 'Confirm your email change',
    intro:
      'Use this code to confirm that you want to change the email of your GetDreamJob account to a new address.',
  },
  [OtpEmailVariant.EMAIL_CHANGE_NEW]: {
    subject: 'Confirm your new GetDreamJob email',
    heading: 'Confirm your new email',
    intro:
      'Use this code to confirm this address as the new email of your GetDreamJob account.',
  },
} satisfies Record<
  OtpEmailVariant,
  { subject: string; heading: string; intro: string }
>;

export function OtpEmail({
  code,
  expiresInMinutes,
  variant = OtpEmailVariant.VERIFICATION,
  links,
}: OtpEmailProps & { links: EmailLinks }) {
  const { subject, heading, intro } = copyByVariant[variant];

  return createElement(
    EmailLayout,
    { preview: `${subject} is ${code}`, heading, links },
    createElement(
      EmailParagraph,
      null,
      `${intro} It expires in ${expiresInMinutes} minutes.`,
    ),
    createElement(
      Section,
      { style: { textAlign: 'center', margin: '28px 0 8px' } },
      createElement(
        Text,
        {
          style: {
            display: 'inline-block',
            margin: 0,
            padding: '14px 28px',
            backgroundColor: BRAND_COLORS.porcelain,
            border: `2px solid ${BRAND_COLORS.ink}`,
            borderRadius: BRAND_RADIUS.control,
            fontFamily: BRAND_FONTS.display,
            fontSize: 36,
            fontWeight: 700,
            lineHeight: '1',
            letterSpacing: '10px',
            fontVariantNumeric: 'tabular-nums',
            color: BRAND_COLORS.ink,
          },
        },
        code,
      ),
    ),
    createElement(
      EmailFinePrint,
      null,
      'If you requested more than one code, only the newest one works. If you did not request this, you can ignore this email.',
    ),
  );
}

export async function renderOtpEmail(props: OtpEmailProps, links: EmailLinks) {
  const element = createElement(OtpEmail, { ...props, links });
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
