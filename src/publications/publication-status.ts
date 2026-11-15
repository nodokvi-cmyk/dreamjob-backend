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

type BoardVisibility = Pick<
  Publication,
  'status' | 'acceptingInvites' | 'expiresAt'
>;

type LiveFields = Pick<Publication, 'status' | 'expiresAt'>;

export function boardFilter(now: Date): QueryFilter<Publication> {
  return {
    status: PublicationStatus.PUBLISHED,
    acceptingInvites: true,
    expiresAt: { $gt: now },
  };
}

export function isLivePublication(
  publication: LiveFields,
  now: Date = new Date(),
): boolean {
  return (
    publication.status === PublicationStatus.PUBLISHED &&
    publication.expiresAt !== undefined &&
    publication.expiresAt.getTime() > now.getTime()
  );
}

export function isOnBoard(
  publication: BoardVisibility,
  now: Date = new Date(),
): boolean {
  return publication.acceptingInvites && isLivePublication(publication, now);
}

export function expiredFilter(now: Date): QueryFilter<Publication> {
  return {
    status: { $ne: PublicationStatus.CLOSED },
    expiresAt: { $lte: now },
    pausedAt: { $exists: false },
  };
}
