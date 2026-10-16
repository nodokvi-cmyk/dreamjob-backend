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

export interface OtpEmailProps {
  code: string;
  expiresInMinutes: number;
}

export function OtpEmail({ code, expiresInMinutes }: OtpEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your DreamJob verification code is {code}</Preview>
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
            Verify your email
          </Heading>
          <Text style={{ fontSize: 15, color: '#3f3f46' }}>
            {`Use this code to finish signing up. It expires in ${expiresInMinutes} minutes.`}
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
  return { subject: 'Your DreamJob verification code', html, text };
}
