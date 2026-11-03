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

export type VacancyViewStatus = VacancyStatus | typeof EXPIRED_STATUS;

export const VACANCY_VIEW_STATUSES: readonly VacancyViewStatus[] = [
  ...Object.values(VacancyStatus),
  EXPIRED_STATUS,
];

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

  @Prop({ type: String, required: false, trim: true, maxlength: 500 })
  rejectionReason?: string;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

export type VacancyDocument = HydratedDocument<Vacancy>;

export type VacancyRecord = Vacancy & { _id: Types.ObjectId };

export const vacancySchema = SchemaFactory.createForClass(Vacancy);

vacancySchema.index({ status: 1, createdAt: -1, deadline: 1 });
vacancySchema.index({ company: 1, createdAt: -1 });
