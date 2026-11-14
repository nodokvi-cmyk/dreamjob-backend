import type { QueryFilter } from 'mongoose';
import { EXPIRED_STATUS } from '../vacancies/schema/vacancy.schema.js';
import {
  Publication,
  PublicationStatus,
  PublicationViewStatus,
} from './schema/publication.schema.js';

type ExpiryFields = Pick<Publication, 'status' | 'expiresAt' | 'pausedAt'>;

export function isPublicationExpired(
  publication: ExpiryFields,
  now: Date = new Date(),
): boolean {
  return (
    publication.status !== PublicationStatus.CLOSED &&
    !publication.pausedAt &&
    publication.expiresAt !== undefined &&
    publication.expiresAt.getTime() <= now.getTime()
  );
}

export function publicationViewStatus(
  publication: ExpiryFields,
  now: Date = new Date(),
): PublicationViewStatus {
  return isPublicationExpired(publication, now)
    ? EXPIRED_STATUS
    : publication.status;
}

export function notExpiredFilter(now: Date): QueryFilter<Publication> {
  return {
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: now } },
      { pausedAt: { $exists: true } },
    ],
  };
}

export function expiredFilter(now: Date): QueryFilter<Publication> {
  return {
    status: { $ne: PublicationStatus.CLOSED },
    expiresAt: { $lte: now },
    pausedAt: { $exists: false },
  };
}
