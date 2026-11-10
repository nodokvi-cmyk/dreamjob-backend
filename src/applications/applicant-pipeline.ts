import type {
  AggregateOptions,
  PipelineStage,
  QueryFilter,
  Types,
} from 'mongoose';
import {
  searchWords,
  wordStartPattern,
} from '../shared/mongo/search-patterns.js';
import type { ApplicantSort } from './dto/applicants-filter.dto.js';
import { Application, ApplicationStatus } from './schema/application.schema.js';

type ApplicationFilter = QueryFilter<Application>;
type SortDirection = 1 | -1;

export const MAX_APPLICANT_SEARCH_WORDS = 5;

const APPLICANT_PROJECTION = {
  firstName: 1,
  lastName: 1,
  birthDate: 1,
  email: 1,
  phone: 1,
  avatarKey: 1,
} as const;

const NAME_COLLATION = { locale: 'en', strength: 2 } as const;

const IS_VISIBLE = {
  $and: [
    { $ne: ['$status', ApplicationStatus.WITHDRAWN] },
    { $ne: [{ $ifNull: ['$applicant', null] }, null] },
  ],
};

const isNameSort = (sort: ApplicantSort): boolean =>
  sort === 'name' || sort === '-name';

const isAgeSort = (sort: ApplicantSort): boolean =>
  sort === 'age' || sort === '-age';

export const applicantSearchWords = (q: string | undefined): string[] =>
  q ? searchWords(q, MAX_APPLICANT_SEARCH_WORDS) : [];

function lookupApplicant(usersCollection: string): PipelineStage[] {
  return [
    {
      $lookup: {
        from: usersCollection,
        localField: 'user',
        foreignField: '_id',
        pipeline: [{ $project: APPLICANT_PROJECTION }],
        as: 'applicant',
      },
    },
    { $set: { applicant: { $first: '$applicant' } } },
  ];
}

function searchStages(words: readonly string[]): PipelineStage[] {
  if (words.length === 0) return [];

  return [
    {
      $match: {
        status: { $ne: ApplicationStatus.WITHDRAWN },
        $and: words.map((word) => {
          const pattern = wordStartPattern(word);

          return {
            $or: [
              { 'applicant.firstName': { $regex: pattern, $options: 'i' } },
              { 'applicant.lastName': { $regex: pattern, $options: 'i' } },
            ],
          };
        }),
      },
    },
  ];
}

function sortStages(sort: ApplicantSort): PipelineStage[] {
  if (isNameSort(sort)) {
    const direction: SortDirection = sort === 'name' ? 1 : -1;

    return [
      {
        $set: {
          sortRank: { $cond: [IS_VISIBLE, 1, 0] },
          sortName: {
            $cond: [
              { $eq: ['$applicant.lastName', ''] },
              '$applicant.firstName',
              '$applicant.lastName',
            ],
          },
        },
      },
      {
        $sort: {
          sortRank: -1,
          sortName: direction,
          'applicant.firstName': direction,
          _id: -1,
        },
      },
    ];
  }

  if (isAgeSort(sort)) {
    const direction: SortDirection = sort === 'age' ? -1 : 1;

    return [
      {
        $set: {
          sortRank: {
            $cond: [
              IS_VISIBLE,
              {
                $cond: [
                  { $eq: [{ $type: '$applicant.birthDate' }, 'date'] },
                  2,
                  1,
                ],
              },
              0,
            ],
          },
        },
      },
      { $sort: { sortRank: -1, 'applicant.birthDate': direction, _id: -1 } },
    ];
  }

  const direction: SortDirection = sort === 'date' ? 1 : -1;

  return [{ $sort: { appliedAt: direction, _id: -1 } }];
}

function orderedStages(
  match: ApplicationFilter,
  sort: ApplicantSort,
  words: readonly string[],
  usersCollection: string,
): { stages: PipelineStage[]; lookupDone: boolean } {
  const lookupDone = isNameSort(sort) || isAgeSort(sort) || words.length > 0;

  return {
    lookupDone,
    stages: [
      { $match: match },
      ...(lookupDone ? lookupApplicant(usersCollection) : []),
      ...searchStages(words),
      ...sortStages(sort),
    ],
  };
}

export function applicantAggregateOptions(
  sort: ApplicantSort,
): AggregateOptions {
  return isNameSort(sort) ? { collation: NAME_COLLATION } : {};
}

export function applicantPagePipeline(
  match: ApplicationFilter,
  sort: ApplicantSort,
  words: readonly string[],
  skip: number,
  limit: number,
  usersCollection: string,
): PipelineStage[] {
  const { stages, lookupDone } = orderedStages(
    match,
    sort,
    words,
    usersCollection,
  );

  return [
    ...stages,
    { $skip: skip },
    { $limit: limit },
    ...(lookupDone ? [] : lookupApplicant(usersCollection)),
  ];
}

export function applicantFocusPipeline(
  match: ApplicationFilter,
  sort: ApplicantSort,
  words: readonly string[],
  focusId: Types.ObjectId,
  usersCollection: string,
): PipelineStage[] {
  const { stages } = orderedStages(match, sort, words, usersCollection);

  return [
    ...stages,
    { $group: { _id: null, ids: { $push: '$_id' } } },
    { $project: { _id: 0, index: { $indexOfArray: ['$ids', focusId] } } },
  ];
}

export function applicantCountPipeline(
  match: ApplicationFilter,
  words: readonly string[],
  usersCollection: string,
): PipelineStage[] {
  return [
    { $match: match },
    ...lookupApplicant(usersCollection),
    ...searchStages(words),
    { $count: 'total' },
  ];
}
