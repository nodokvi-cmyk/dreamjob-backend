import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { User } from '../../users/schema/user.schema.js';
import {
  Currency,
  EmploymentType,
  EXPIRED_STATUS,
  WorkMode,
} from '../../vacancies/schema/vacancy.schema.js';

export enum PublicationStatus {
  PENDING = 'pending',
  PUBLISHED = 'published',
  REJECTED = 'rejected',
  CLOSED = 'closed',
}

export type PublicationViewStatus = PublicationStatus | typeof EXPIRED_STATUS;

export const PUBLICATION_VIEW_STATUSES: readonly PublicationViewStatus[] = [
  ...Object.values(PublicationStatus),
  EXPIRED_STATUS,
];

export const ACTIVE_PUBLICATION_STATUSES = [
  PublicationStatus.PENDING,
  PublicationStatus.PUBLISHED,
  PublicationStatus.REJECTED,
];

export const MAX_ACTIVE_PUBLICATIONS = 3;
export const PUBLICATION_LIFETIME_DAYS = 60;

@Schema({ timestamps: true })
export class Publication {
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 128 })
  title!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 3000 })
  about!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 64 })
  category!: string;

  @Prop({ type: [String], enum: EmploymentType, default: [] })
  employmentTypes!: EmploymentType[];

  @Prop({ type: [String], enum: WorkMode, default: [] })
  workModes!: WorkMode[];

  @Prop({ type: [String], default: [] })
  locations!: string[];

  @Prop({ type: Number, required: false, min: 1 })
  salaryMin?: number;

  @Prop({ type: Number, required: false, min: 1 })
  salaryMax?: number;

  @Prop({ type: String, enum: Currency, default: Currency.USD })
  currency!: Currency;

  @Prop({ type: [String], default: [] })
  skills!: string[];

  @Prop({ type: Number, required: false, min: 0, max: 60 })
  experienceYears?: number;

  @Prop({ type: Boolean, default: true })
  acceptingInvites!: boolean;

  @Prop({ type: String, default: '' })
  cvKey!: string;

  @Prop({ type: String, default: '' })
  coverLetterKey!: string;

  @Prop({
    type: String,
    enum: PublicationStatus,
    default: PublicationStatus.PENDING,
  })
  status!: PublicationStatus;

  @Prop({ type: String, required: false, trim: true, maxlength: 1000 })
  rejectionReason?: string;

  @Prop({ type: Date, required: false })
  expiresAt?: Date;

  @Prop({ type: Date, required: false })
  pausedAt?: Date;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

export type PublicationDocument = HydratedDocument<Publication>;

export type PublicationRecord = Publication & { _id: Types.ObjectId };

export const publicationSchema = SchemaFactory.createForClass(Publication);

publicationSchema.index({ user: 1, createdAt: -1 });
publicationSchema.index({ status: 1, createdAt: -1 });
