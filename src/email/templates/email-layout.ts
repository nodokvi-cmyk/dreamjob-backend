import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { BRAND, BRAND_COLORS, BRAND_FONTS, BRAND_RADIUS } from '../brand.js';
import type { EmailLinks } from '../brand.js';

export interface EmailLayoutProps {
  preview: string;
  heading: string;
  links: EmailLinks;
  children?: ReactNode;
}

const LOGO_SIZE = 40;

function EmailHeader({ links }: { links: EmailLinks }) {
  return createElement(
    Section,
    {
      style: {
        backgroundColor: BRAND_COLORS.enamel,
        borderRadius: `${BRAND_RADIUS.panel}px ${BRAND_RADIUS.panel}px 0 0`,
        borderBottom: `4px solid ${BRAND_COLORS.lineScarlet}`,
        padding: '20px 28px',
      },
    },
    createElement(
      Row,
      null,
      createElement(
        Column,
        { style: { width: LOGO_SIZE + 12, verticalAlign: 'middle' } },
        createElement(
          Link,
          { href: links.siteUrl },
          createElement(Img, {
            src: links.logoUrl,
            width: LOGO_SIZE,
            height: LOGO_SIZE,
            alt: BRAND.name,
            style: { display: 'block', borderRadius: 9 },
          }),
        ),
      ),
      createElement(
        Column,
        { style: { verticalAlign: 'middle' } },
        createElement(
          Link,
          {
            href: links.siteUrl,
            style: {
              fontFamily: BRAND_FONTS.display,
              fontSize: 26,
              fontWeight: 700,
              lineHeight: '1',
              color: BRAND_COLORS.onEnamel,
              textDecoration: 'none',
            },
          },
          createElement(
            'span',
            { style: { color: BRAND_COLORS.lineScarlet } },
            BRAND.namePrefix,
          ),
          BRAND.nameRest,
        ),
      ),
    ),
  );
}

function EmailFooter({ links }: { links: EmailLinks }) {
  return createElement(
    Section,
    {
      style: {
        backgroundColor: BRAND_COLORS.enamel,
        borderRadius: `0 0 ${BRAND_RADIUS.panel}px ${BRAND_RADIUS.panel}px`,
        padding: '22px 28px',
      },
    },
    createElement(
      Text,
      {
        style: {
          margin: '0 0 6px',
          fontFamily: BRAND_FONTS.display,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: BRAND_COLORS.onEnamel,
        },
      },
      `${BRAND.name} · ${BRAND.tagline}`,
    ),
    createElement(
      Text,
      {
        style: {
          margin: 0,
          fontSize: 12,
          lineHeight: '18px',
          color: BRAND_COLORS.onEnamelMuted,
        },
      },
      `You received this email because of activity on your ${BRAND.name} account. `,
      createElement(
        Link,
        {
          href: links.siteUrl,
          style: { color: BRAND_COLORS.onEnamel, textDecoration: 'underline' },
        },
        links.siteUrl.replace(/^https?:\/\//, ''),
      ),
    ),
  );
}

export function EmailLayout({
  preview,
  heading,
  links,
  children,
}: EmailLayoutProps) {
  return createElement(
    Html,
    { lang: 'en' },
    createElement(
      Head,
      null,
      createElement('meta', { name: 'color-scheme', content: 'light' }),
      createElement('meta', {
        name: 'supported-color-schemes',
        content: 'light',
      }),
      createElement('link', {
        rel: 'stylesheet',
        href: BRAND_FONTS.stylesheet,
      }),
    ),
    createElement(Preview, null, preview),
    createElement(
      Body,
      {
        style: {
          margin: 0,
          padding: '32px 12px',
          backgroundColor: BRAND_COLORS.porcelain,
          fontFamily: BRAND_FONTS.body,
          color: BRAND_COLORS.ink,
        },
      },
      createElement(
        Container,
        { style: { maxWidth: 560, margin: '0 auto' } },
        createElement(EmailHeader, { links }),
        createElement(
          Section,
          {
            style: {
              backgroundColor: BRAND_COLORS.surface,
              borderLeft: `1px solid ${BRAND_COLORS.border}`,
              borderRight: `1px solid ${BRAND_COLORS.border}`,
              padding: '36px 32px 32px',
            },
          },
          createElement(
            Heading,
            {
              as: 'h1',
              style: {
                margin: '0 0 16px',
                fontFamily: BRAND_FONTS.display,
                fontSize: 28,
                fontWeight: 700,
                lineHeight: '1.1',
                letterSpacing: '-0.01em',
                textTransform: 'uppercase',
                color: BRAND_COLORS.ink,
              },
            },
            heading,
          ),
          children,
        ),
        createElement(EmailFooter, { links }),
      ),
    ),
  );
}

export function EmailParagraph({ children }: { children?: ReactNode }) {
  return createElement(
    Text,
    {
      style: {
        margin: '0 0 14px',
        fontSize: 16,
        lineHeight: '1.6',
        color: BRAND_COLORS.ink,
      },
    },
    children,
  );
}

export function EmailFinePrint({ children }: { children?: ReactNode }) {
  return createElement(
    Text,
    {
      style: {
        margin: '20px 0 0',
        fontSize: 13,
        lineHeight: '20px',
        color: BRAND_COLORS.inkMuted,
      },
    },
    children,
  );
}

export function EmailButton({ href, label }: { href: string; label: string }) {
  return createElement(
    Button,
    {
      href,
      style: {
        display: 'inline-block',
        margin: '10px 0 4px',
        padding: '13px 22px',
        backgroundColor: BRAND_COLORS.primary,
        borderRadius: BRAND_RADIUS.control,
        color: BRAND_COLORS.surface,
        fontFamily: BRAND_FONTS.display,
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        textDecoration: 'none',
      },
    },
    `${label} →`,
  );
}
