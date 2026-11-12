import type { Model, Types } from 'mongoose';
import type { Company } from './schema/company.schema.js';

export async function approvedCompanyIds(
  companyModel: Model<Company>,
  companyIds: readonly Types.ObjectId[],
): Promise<Set<string>> {
  if (companyIds.length === 0) return new Set();

  const approved = await companyModel
    .find({ _id: { $in: companyIds }, approved: true })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();

  return new Set(approved.map(({ _id }) => _id.toString()));
}
