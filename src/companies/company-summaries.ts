import type { Model, Types } from 'mongoose';
import type { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import type { Company } from './schema/company.schema.js';

export type CompanySummary = { companyName: string; logoUrl: string };

export type CompanySummaries = {
  approvedIds: ReadonlySet<string>;
  byId: ReadonlyMap<string, CompanySummary>;
};

type CompanySummarySource = Pick<
  Company,
  'companyName' | 'logoKey' | 'approved'
> & { _id: Types.ObjectId };

const MISSING_COMPANY: CompanySummary = { companyName: '', logoUrl: '' };

export async function companySummaries(
  companyModel: Model<Company>,
  s3: Pick<AwsS3Service, 'publicUrl'>,
  companyIds: readonly Types.ObjectId[],
): Promise<CompanySummaries> {
  if (companyIds.length === 0) {
    return { approvedIds: new Set(), byId: new Map() };
  }

  const companies = await companyModel
    .find({ _id: { $in: companyIds } })
    .select('companyName logoKey approved')
    .lean<CompanySummarySource[]>();

  return {
    approvedIds: new Set(
      companies
        .filter(({ approved }) => approved)
        .map(({ _id }) => _id.toString()),
    ),
    byId: new Map(
      companies.map(({ _id, companyName, logoKey }) => [
        _id.toString(),
        { companyName, logoUrl: s3.publicUrl(logoKey) },
      ]),
    ),
  };
}

export function companyFieldsOf(
  companyId: Types.ObjectId,
  summaries: CompanySummaries,
): CompanySummary {
  return summaries.byId.get(companyId.toString()) ?? MISSING_COMPANY;
}
