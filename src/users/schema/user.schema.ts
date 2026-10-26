import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OtpPurpose } from '../../shared/types/otp-purpose.js';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

@Schema({
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class User {
  @Prop({ type: String, enum: UserRole, default: UserRole.USER })
  role!: UserRole;

  @Prop({ type: String, required: true, trim: true, maxlength: 64 })
  firstName!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 64 })
  lastName!: string;

  @Prop({ type: Date, required: true })
  birthDate!: Date;

  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 128,
  })
  email!: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 32 })
  phone!: string;

  @Prop({ type: Boolean, default: false })
  isVerified!: boolean;

  @Prop({ type: String, required: false, select: false })
  password?: string;

  @Prop({ type: String, required: false, select: false })
  OTPCode?: string;

  @Prop({ type: Date, required: false, select: false })
  OTPCodeExpirationDate?: Date;

  @Prop({ type: String, enum: OtpPurpose, required: false, select: false })
  OTPPurpose?: OtpPurpose;

  @Prop({
    type: String,
    required: false,
    select: false,
    lowercase: true,
    trim: true,
    maxlength: 128,
  })
  pendingEmail?: string;

  @Prop({ type: String, default: '' })
  avatarKey!: string;

  @Prop({ type: String, default: '' })
  cvKey!: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Vacancy' }], default: [] })
  appliedVacancies!: Types.ObjectId[];

  declare readonly age: number;
}

export type UserDocument = HydratedDocument<User>;

export const userSchema = SchemaFactory.createForClass(User);

userSchema.virtual('age').get(function (this: UserDocument): number {
  const today = new Date();
  const birth = this.birthDate;
  const hadBirthday =
    today.getUTCMonth() > birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() &&
      today.getUTCDate() >= birth.getUTCDate());
  return (
    today.getUTCFullYear() - birth.getUTCFullYear() - (hadBirthday ? 0 : 1)
  );
});
