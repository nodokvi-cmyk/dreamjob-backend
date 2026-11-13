import type { ApplicationStatus } from '../applications/schema/application.schema.js';
import {
  type CompanySummaries,
  companyFieldsOf,
} from '../companies/company-summaries.js';
import { excerpt } from '../shared/text/excerpt.js';
import type {
  VacancyCardSnapshot,
  VacancyRecord,
} from './schema/vacancy.schema.js';
import { isHiddenFromUsers, vacancyStatusForUser } from './vacancy-status.js';

export const VACANCY_CARD_PROJECTION =
  'title description category employmentType workMode location salaryMin salaryMax currency deadline company status submittedAt approvedCard createdAt';

export type VacancyCardSource = Pick<
  VacancyRecord,
  | '_id'
  | 'title'
  | 'description'
  | 'category'
  | 'employmentType'
  | 'workMode'
  | 'location'
  | 'salaryMin'
  | 'salaryMax'
  | 'currency'
  | 'deadline'
  | 'company'
  | 'status'
  | 'submittedAt'
  | 'approvedCard'
  | 'createdAt'
>;

export type MyApplicationSummary = {
  id: string;
  status: ApplicationStatus;
  canReapply: boolean;
  submissions: number;
};

export type UserCardContext = {
  companies: CompanySummaries;
  applications: ReadonlyMap<string, MyApplicationSummary>;
  bookmarked: ReadonlySet<string>;
};

type CardSnapshotSource = Pick<
  VacancyRecord,
  | 'title'
  | 'description'
  | 'category'
  | 'employmentType'
  | 'workMode'
  | 'location'
  | 'salaryMin'
  | 'salaryMax'
  | 'currency'
>;

export function cardSnapshotOf(
  vacancy: CardSnapshotSource,
): VacancyCardSnapshot {
  return {
    title: vacancy.title,
    category: vacancy.category,
    employmentType: vacancy.employmentType,
    workMode: vacancy.workMode,
    location: vacancy.location,
    ...(vacancy.salaryMin === undefined
      ? {}
      : { salaryMin: vacancy.salaryMin }),
    ...(vacancy.salaryMax === undefined
      ? {}
      : { salaryMax: vacancy.salaryMax }),
    currency: vacancy.currency,
    excerpt: excerpt(vacancy.description),
  };
}

export function userFacingTitle(
  vacancy: Pick<VacancyRecord, 'title' | 'status' | 'approvedCard'>,
): string {
  if (!isHiddenFromUsers(vacancy)) return vacancy.title;

  return vacancy.approvedCard?.title ?? vacancy.title;
}

export function cardFields(vacancy: VacancyCardSource, forUsers: boolean) {
  const shown =
    (forUsers && isHiddenFromUsers(vacancy)
      ? vacancy.approvedCard
      : undefined) ?? cardSnapshotOf(vacancy);

  return {
    id: vacancy._id.toString(),
    title: shown.title,
    excerpt: shown.excerpt,
    category: shown.category,
    employmentType: shown.employmentType,
    workMode: shown.workMode,
    location: shown.location,
    salaryMin: shown.salaryMin ?? null,
    salaryMax: shown.salaryMax ?? null,
    currency: shown.currency,
    deadline: vacancy.deadline,
    createdAt: vacancy.createdAt,
    company: vacancy.company.toString(),
  };
}

export function cardMarks(
  vacancy: Pick<VacancyRecord, '_id' | 'company'>,
  context: UserCardContext,
) {
  const vacancyId = vacancy._id.toString();

  return {
    companyApproved: context.companies.approvedIds.has(
      vacancy.company.toString(),
    ),
    myApplication: context.applications.get(vacancyId) ?? null,
    isBookmarked: context.bookmarked.has(vacancyId),
  };
}

export function userVacancyCard(
  vacancy: VacancyCardSource,
  context: UserCardContext,
) {
  return {
    ...cardFields(vacancy, true),
    ...companyFieldsOf(vacancy.company, context.companies),
    status: vacancyStatusForUser(vacancy),
    ...cardMarks(vacancy, context),
  };
}
