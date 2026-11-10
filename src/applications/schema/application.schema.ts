import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schema/user.schema.js';
import { Vacancy } from '../../vacancies/schema/vacancy.schema.js';

export enum ApplicationStatus {
  SUBMITTED = 'submitted',
  VIEWED = 'viewed',
  INTERVIEW = 'interview',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
}

export enum PreviousOutcome {
  WITHDRAWN = 'withdrawn',
  REJECTED = 'rejected',
}

export const ENDED_APPLICATION_STATUSES = [
  ApplicationStatus.REJECTED,
  ApplicationStatus.WITHDRAWN,
] as const;

export const WITHDRAWABLE_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.VIEWED,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.ACCEPTED,
];

export const MAX_APPLICATION_SUBMISSIONS = 2;
export const MAX_APPLICATION_MESSAGE_WORDS = 100;
export const MAX_APPLICATION_MESSAGE_LENGTH = 800;

@Schema({ timestamps: true })
export class Application {
  @Prop({ type: Types.ObjectId, ref: User.name, required: false })
  user?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Vacancy.name, required: true })
  vacancy!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ApplicationStatus,
    default: ApplicationStatus.SUBMITTED,
  })
  status!: ApplicationStatus;

  @Prop({
    type: String,
    required: false,
    trim: true,
    maxlength: MAX_APPLICATION_MESSAGE_LENGTH,
  })
  message?: string;

  @Prop({ type: String, required: false })
  cvKey?: string;

  @Prop({ type: String, required: false })
  coverLetterKey?: string;

  @Prop({
    type: Number,
    default: 1,
    min: 1,
    max: MAX_APPLICATION_SUBMISSIONS,
  })
  submissions!: number;

  @Prop({ type: Boolean, default: false })
  locked!: boolean;

  @Prop({ type: String, enum: PreviousOutcome, required: false })
  previousOutcome?: PreviousOutcome;

  @Prop({ type: Date, required: true })
  appliedAt!: Date;

  @Prop({ type: Date, required: true })
  firstAppliedAt!: Date;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

export type ApplicationDocument = HydratedDocument<Application>;

export type ApplicationRecord = Application & { _id: Types.ObjectId };

export const applicationSchema = SchemaFactory.createForClass(Application);

applicationSchema.index(
  { user: 1, vacancy: 1 },
  { unique: true, partialFilterExpression: { user: { $exists: true } } },
);
applicationSchema.index({ vacancy: 1, appliedAt: -1 });
applicationSchema.index({ user: 1, appliedAt: -1 });
