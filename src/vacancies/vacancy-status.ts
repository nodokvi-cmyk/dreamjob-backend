import {
  EXPIRED_STATUS,
  NOT_SUBMITTED_STATUS,
  Vacancy,
  VacancyStatus,
  VacancyViewStatus,
} from './schema/vacancy.schema.js';

export function isNotSubmitted(
  vacancy: Pick<Vacancy, 'status' | 'submittedAt'>,
): boolean {
  return vacancy.status === VacancyStatus.PENDING && !vacancy.submittedAt;
}

export const UNAVAILABLE_VACANCY_STATUS = 'unavailable';

export function vacancyStatusForUser(
  vacancy: Pick<Vacancy, 'status' | 'deadline' | 'submittedAt'>,
) {
  if (
    vacancy.status === VacancyStatus.PENDING ||
    vacancy.status === VacancyStatus.REJECTED
  ) {
    return UNAVAILABLE_VACANCY_STATUS;
  }

  return vacancyViewStatus(vacancy);
}

export function vacancyViewStatus(
  vacancy: Pick<Vacancy, 'status' | 'deadline' | 'submittedAt'>,
): VacancyViewStatus {
  if (vacancy.status === VacancyStatus.CLOSED) return VacancyStatus.CLOSED;
  if (isNotSubmitted(vacancy)) return NOT_SUBMITTED_STATUS;

  return vacancy.deadline.getTime() <= Date.now()
    ? EXPIRED_STATUS
    : vacancy.status;
}
