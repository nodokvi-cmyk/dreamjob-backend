import type { PublicationsService } from '../publications/publications.service.js';
import { excerpt } from '../shared/text/excerpt.js';
import type { VacanciesService } from '../vacancies/vacancies.service.js';

type VacancyItem = Awaited<
  ReturnType<VacanciesService['listPublic']>
>['items'][number];

type PublicationItem = Awaited<
  ReturnType<PublicationsService['listBoard']>
>['items'][number];

export const MAX_CHAT_CARDS = 10;
const MODEL_EXCERPT_LENGTH = 120;

export function vacancyCard(item: VacancyItem) {
  return {
    type: 'vacancy' as const,
    id: item.id,
    title: item.title,
    excerpt: item.excerpt,
    category: item.category,
    employmentType: item.employmentType,
    workMode: item.workMode,
    location: item.location,
    salaryMin: item.salaryMin,
    salaryMax: item.salaryMax,
    currency: item.currency,
    deadline: item.deadline,
    company: item.company,
    companyName: item.companyName,
    logoUrl: item.logoUrl,
  };
}

export function publicationCard(item: PublicationItem) {
  return {
    type: 'publication' as const,
    id: item.id,
    title: item.title,
    excerpt: item.excerpt,
    category: item.category,
    employmentTypes: item.employmentTypes,
    workModes: item.workModes,
    locations: item.locations,
    salaryMin: item.salaryMin,
    salaryMax: item.salaryMax,
    currency: item.currency,
    skills: item.skills,
    experienceYears: item.experienceYears,
    author: item.author,
    invitation: item.invitation,
  };
}

export type VacancyChatCard = ReturnType<typeof vacancyCard>;
export type PublicationChatCard = ReturnType<typeof publicationCard>;
export type ChatCard = VacancyChatCard | PublicationChatCard;

function day(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function describeVacancy(card: VacancyChatCard) {
  return {
    title: card.title,
    company: card.companyName,
    category: card.category,
    employmentType: card.employmentType,
    workMode: card.workMode,
    location: card.location,
    salaryMin: card.salaryMin,
    salaryMax: card.salaryMax,
    currency: card.currency,
    deadline: day(card.deadline),
    excerpt: excerpt(card.excerpt, MODEL_EXCERPT_LENGTH),
  };
}

export function describePublication(card: PublicationChatCard) {
  return {
    title: card.title,
    author: card.author
      ? `${card.author.firstName} ${card.author.lastName}`.trim()
      : null,
    category: card.category,
    employmentTypes: card.employmentTypes,
    workModes: card.workModes,
    locations: card.locations,
    salaryMin: card.salaryMin,
    salaryMax: card.salaryMax,
    currency: card.currency,
    skills: card.skills,
    experienceYears: card.experienceYears,
    invitation: card.invitation,
    excerpt: excerpt(card.excerpt, MODEL_EXCERPT_LENGTH),
  };
}
