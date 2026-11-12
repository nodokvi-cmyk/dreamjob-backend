import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Company } from '../../companies/schema/company.schema.js';

export enum VacancyStatus {
  PENDING = 'pending',
  PUBLISHED = 'published',
  REJECTED = 'rejected',
  CLOSED = 'closed',
}

export const EXPIRED_STATUS = 'expired';
export const NOT_SUBMITTED_STATUS = 'notSubmitted';

export type AdminVacancyViewStatus = VacancyStatus | typeof EXPIRED_STATUS;

export type VacancyViewStatus =
  AdminVacancyViewStatus | typeof NOT_SUBMITTED_STATUS;

export const ADMIN_VACANCY_VIEW_STATUSES: readonly AdminVacancyViewStatus[] = [
  ...Object.values(VacancyStatus),
  EXPIRED_STATUS,
];

export const VACANCY_VIEW_STATUSES: readonly VacancyViewStatus[] = [
  ...ADMIN_VACANCY_VIEW_STATUSES,
  NOT_SUBMITTED_STATUS,
];

export enum CreditSource {
  PLAN = 'plan',
  PURCHASED = 'purchased',
}

export const VACANCY_WINDOW_DAYS = 60;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export enum EmploymentType {
  FULL_TIME = 'full-time',
  PART_TIME = 'part-time',
  INTERNSHIP = 'internship',
  TEMPORARY = 'temporary',
}

export enum WorkMode {
  REMOTE = 'remote',
  ONSITE = 'onsite',
  HYBRID = 'hybrid',
}

export enum Currency {
  USD = 'USD',
  GEL = 'GEL',
  EUR = 'EUR',
}

export const MAX_VACANCY_PHOTOS = 3;

@Schema({ _id: false })
export class VacancyCardSnapshot {
  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, required: true })
  category!: string;

  @Prop({ type: String, enum: EmploymentType, required: true })
  employmentType!: EmploymentType;

  @Prop({ type: String, enum: WorkMode, required: true })
  workMode!: WorkMode;

  @Prop({ type: String, default: '' })
  location!: string;

  @Prop({ type: Number, required: false })
  salaryMin?: number;

  @Prop({ type: Number, required: false })
  salaryMax?: number;

  @Prop({ type: String, enum: Currency, required: true })
  currency!: Currency;

  @Prop({ type: String, default: '' })
  excerpt!: string;
}

export const vacancyCardSnapshotSchema =
  SchemaFactory.createForClass(VacancyCardSnapshot);

@Schema({ timestamps: true })
export class Vacancy {
  @Prop({ type: String, required: true, trim: true, maxlength: 128 })
  title!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 5000 })
  description!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 64 })
  category!: string;

  @Prop({ type: String, enum: EmploymentType, required: true })
  employmentType!: EmploymentType;

  @Prop({ type: String, enum: WorkMode, required: true })
  workMode!: WorkMode;

  @Prop({ type: String, default: '', trim: true, maxlength: 128 })
  location!: string;

  @Prop({ type: Number, required: false, min: 1 })
  salaryMin?: number;

  @Prop({ type: Number, required: false, min: 1 })
  salaryMax?: number;

  @Prop({ type: String, enum: Currency, default: Currency.USD })
  currency!: Currency;

  @Prop({ type: [String], default: [] })
  requirements!: string[];

  @Prop({ type: Date, required: true })
  deadline!: Date;

  @Prop({ type: [String], default: [] })
  photoKeys!: string[];

  @Prop({ type: Types.ObjectId, ref: Company.name, required: true })
  company!: Types.ObjectId;

  @Prop({
    type: String,
    enum: VacancyStatus,
    default: VacancyStatus.PENDING,
  })
  status!: VacancyStatus;

  @Prop({ type: String, required: false, trim: true, maxlength: 1000 })
  rejectionReason?: string;

  @Prop({ type: Date, required: false })
  submittedAt?: Date;

  @Prop({ type: String, enum: CreditSource, required: false })
  creditSource?: CreditSource;

  @Prop({ type: Date, required: false })
  firstPublishedAt?: Date;

  @Prop({ type: Date, required: false })
  freeWindowEndsAt?: Date;

  @Prop({ type: Date, required: false })
  windowPausedAt?: Date;

  @Prop({ type: String, required: false })
  checkoutSessionId?: string;

  @Prop({ type: vacancyCardSnapshotSchema, required: false })
  approvedCard?: VacancyCardSnapshot;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

export type VacancyDocument = HydratedDocument<Vacancy>;

export type VacancyRecord = Vacancy & { _id: Types.ObjectId };

export const vacancySchema = SchemaFactory.createForClass(Vacancy);

vacancySchema.index({ status: 1, createdAt: -1, deadline: 1 });
vacancySchema.index({ company: 1, createdAt: -1 });
