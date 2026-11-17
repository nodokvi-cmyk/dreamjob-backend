import { render } from '@react-email/render';
import { createElement } from 'react';
import type { EmailLinks } from '../brand.js';
import { EmailButton, EmailLayout, EmailParagraph } from './email-layout.js';

export interface PlanNoticeEmailProps {
  subject: string;
  heading: string;
  paragraphs: string[];
  buttonLabel: string;
  buttonUrl: string;
}

export function PlanNoticeEmail({
  notice,
  links,
}: {
  notice: PlanNoticeEmailProps;
  links: EmailLinks;
}) {
  return createElement(
    EmailLayout,
    {
      preview: notice.paragraphs[0] ?? notice.subject,
      heading: notice.heading,
      links,
    },
    ...notice.paragraphs.map((paragraph) =>
      createElement(EmailParagraph, { key: paragraph }, paragraph),
    ),
    createElement(EmailButton, {
      href: notice.buttonUrl,
      label: notice.buttonLabel,
    }),
  );
}

export async function renderPlanNoticeEmail(
  notice: PlanNoticeEmailProps,
  links: EmailLinks,
) {
  const element = createElement(PlanNoticeEmail, { notice, links });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { subject: notice.subject, html, text };
}
