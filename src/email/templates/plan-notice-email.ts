import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import { createElement } from 'react';

export interface PlanNoticeEmailProps {
  subject: string;
  heading: string;
  paragraphs: string[];
  buttonLabel: string;
  buttonUrl: string;
}

export function PlanNoticeEmail({
  subject,
  heading,
  paragraphs,
  buttonLabel,
  buttonUrl,
}: PlanNoticeEmailProps) {
  return createElement(
    Html,
    { lang: 'en' },
    createElement(Head),
    createElement(Preview, null, subject),
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
        ...paragraphs.map((paragraph) =>
          createElement(
            Text,
            { key: paragraph, style: { fontSize: 15, color: '#3f3f46' } },
            paragraph,
          ),
        ),
        createElement(
          Button,
          {
            href: buttonUrl,
            style: {
              backgroundColor: '#18181b',
              color: '#ffffff',
              borderRadius: 6,
              padding: '12px 20px',
              fontSize: 15,
              textDecoration: 'none',
              display: 'inline-block',
              margin: '8px 0 16px',
            },
          },
          buttonLabel,
        ),
      ),
    ),
  );
}

export async function renderPlanNoticeEmail(props: PlanNoticeEmailProps) {
  const element = createElement(PlanNoticeEmail, props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { subject: props.subject, html, text };
}
