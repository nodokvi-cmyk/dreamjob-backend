export const BRAND = {
  name: 'GetDreamJob',
  namePrefix: 'Get',
  nameRest: 'DreamJob',
  tagline: 'Jobs in Georgia',
  logoKey: 'brand/logo-v1.png',
} as const;

export const BRAND_COLORS = {
  enamel: '#0b1230',
  onEnamel: '#f4f6fb',
  onEnamelMuted: '#b3bddc',
  porcelain: '#f4f6fb',
  surface: '#ffffff',
  ink: '#0b1230',
  inkMuted: '#4a5677',
  border: '#d6dceb',
  primary: '#d71a2a',
  lineScarlet: '#e21d2d',
  cobaltInk: '#1747c7',
} as const;

export const BRAND_FONTS = {
  display:
    "'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', Arial, sans-serif",
  body: "Barlow, 'Segoe UI', Roboto, Arial, sans-serif",
  stylesheet:
    'https://fonts.googleapis.com/css2?family=Barlow:wght@400;600&family=Barlow+Condensed:wght@600;700&display=swap',
} as const;

export const BRAND_RADIUS = {
  control: 12,
  panel: 17,
} as const;

export interface EmailLinks {
  siteUrl: string;
  logoUrl: string;
}
