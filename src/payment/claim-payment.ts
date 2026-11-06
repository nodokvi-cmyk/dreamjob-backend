import type { Model } from 'mongoose';
import { isDuplicateKeyError } from '../shared/mongo/is-duplicate-key-error.js';
import type { Payment } from './schema/payment.schema.js';

export async function claimPayment(
  paymentModel: Model<Payment>,
  sessionId: string,
  record: Omit<Payment, 'stripeSessionId'>,
): Promise<boolean> {
  try {
    const existing = await paymentModel.findOneAndUpdate(
      { stripeSessionId: sessionId },
      { $setOnInsert: record },
      { upsert: true, new: false },
    );
    return existing === null;
  } catch (error: unknown) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}
