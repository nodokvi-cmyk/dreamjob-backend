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

export type OtpEmailVariant = 'verification' | 'passwordReset';

export interface OtpEmailProps {
  code: string;
  expiresInMinutes: number;
  variant?: OtpEmailVariant;
}

const copyByVariant = {
  verification: {
    subject: 'Your DreamJob verification code',
    heading: 'Verify your email',
    intro: 'Use this code to finish signing up.',
  },
  passwordReset: {
    subject: 'Your DreamJob password reset code',
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
  variant = 'verification',
}: OtpEmailProps) {
  const { subject, heading, intro } = copyByVariant[variant];
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${subject} is ${code}`}</Preview>
      <Body
        style={{ backgroundColor: '#f4f4f5', fontFamily: 'Arial, sans-serif' }}
      >
        <Container
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 8,
            margin: '24px auto',
            padding: 32,
            maxWidth: 480,
          }}
        >
          <Heading as="h1" style={{ fontSize: 22, margin: '0 0 16px' }}>
            {heading}
          </Heading>
          <Text style={{ fontSize: 15, color: '#3f3f46' }}>
            {`${intro} It expires in ${expiresInMinutes} minutes.`}
          </Text>
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Text
              style={{
                display: 'inline-block',
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: 8,
                padding: '12px 24px',
                backgroundColor: '#f4f4f5',
                borderRadius: 6,
              }}
            >
              {code}
            </Text>
          </Section>
          <Text style={{ fontSize: 13, color: '#71717a' }}>
            If you did not request this, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderOtpEmail(props: OtpEmailProps) {
  const element = <OtpEmail {...props} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return {
    subject: copyByVariant[props.variant ?? 'verification'].subject,
    html,
    text,
  };
}
