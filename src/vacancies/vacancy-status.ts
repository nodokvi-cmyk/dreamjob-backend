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

export function vacancyViewStatus(
  vacancy: Pick<Vacancy, 'status' | 'deadline' | 'submittedAt'>,
): VacancyViewStatus {
  if (vacancy.status === VacancyStatus.CLOSED) return VacancyStatus.CLOSED;
  if (isNotSubmitted(vacancy)) return NOT_SUBMITTED_STATUS;

  return vacancy.deadline.getTime() <= Date.now()
    ? EXPIRED_STATUS
    : vacancy.status;
}
