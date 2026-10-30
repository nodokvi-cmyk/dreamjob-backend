import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OtpPurpose } from '../../shared/types/otp-purpose.js';

@Schema({ _id: false })
export class Director {
  @Prop({ type: String, required: true, trim: true, maxlength: 128 })
  fullName!: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 32 })
  phone?: string;
}

export const directorSchema = SchemaFactory.createForClass(Director);

@Schema({
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class Company {
  @Prop({ type: String, default: '', trim: true, maxlength: 128 })
  companyName!: string;

  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 128,
  })
  email!: string;

  @Prop({ type: String, required: false, unique: true, sparse: true })
  googleId?: string;

  @Prop({ type: directorSchema, required: false })
  director?: Director;

  @Prop({ type: Boolean, default: false })
  isVerified!: boolean;

  @Prop({ type: Boolean, default: false })
  approved!: boolean;

  @Prop({ type: String, required: false, select: false })
  password?: string;

  @Prop({ type: String, required: false, select: false })
  OTPCode?: string;

  @Prop({ type: Date, required: false, select: false })
  OTPCodeExpirationDate?: Date;

  @Prop({ type: String, enum: OtpPurpose, required: false, select: false })
  OTPPurpose?: OtpPurpose;

  @Prop({ type: Number, required: false, select: false })
  OTPAttempts?: number;

  @Prop({
    type: String,
    required: false,
    select: false,
    lowercase: true,
    trim: true,
    maxlength: 128,
  })
  pendingEmail?: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 32 })
  phone!: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 128 })
  location!: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 2000 })
  description!: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 256 })
  website!: string;

  @Prop({ type: [String], default: [] })
  operatingCities!: string[];

  @Prop({ type: String, default: '' })
  logoKey!: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Vacancy' }], default: [] })
  publishedVacancies!: Types.ObjectId[];

  declare readonly isProfileComplete: boolean;
}

export type CompanyDocument = HydratedDocument<Company>;

export const companySchema = SchemaFactory.createForClass(Company);

companySchema.virtual('isProfileComplete').get(function (
  this: CompanyDocument,
): boolean {
  return this.companyName !== '' && this.description !== '';
});
