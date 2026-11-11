import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApplicationStatus } from '../../applications/schema/application.schema.js';
import { AuthRole } from '../../shared/types/auth-role.js';

export enum NotificationType {
  NEW_APPLICATION = 'newApplication',
  APPLICATION_WITHDRAWN = 'applicationWithdrawn',
  VACANCY_APPROVED = 'vacancyApproved',
  VACANCY_REJECTED = 'vacancyRejected',
  COMPANY_APPROVED = 'companyApproved',
  COMPANY_REVOKED = 'companyRevoked',
  PLAN_ENDED = 'planEnded',
  APPLICATION_STATUS_CHANGED = 'applicationStatusChanged',
  APPLICANT_COMPANY_REVOKED = 'applicantCompanyRevoked',
}

export const NOTIFICATION_RECIPIENT_ROLES = [
  AuthRole.USER,
  AuthRole.COMPANY,
] as const;

export type NotificationRecipientRole =
  (typeof NOTIFICATION_RECIPIENT_ROLES)[number];

export const NOTIFICATION_LIFETIME_DAYS = 30;

@Schema({ _id: false })
export class NotificationData {
  @Prop({ type: String, required: false })
  vacancyTitle?: string;

  @Prop({ type: String, required: false })
  companyName?: string;

  @Prop({ type: String, enum: ApplicationStatus, required: false })
  status?: ApplicationStatus;

  @Prop({ type: String, required: false })
  reason?: string;

  @Prop({ type: String, required: false })
  planName?: string;

  @Prop({ type: Boolean, required: false })
  isReapply?: boolean;
}

export const notificationDataSchema =
  SchemaFactory.createForClass(NotificationData);

@Schema({ _id: false })
export class NotificationTarget {
  @Prop({ type: Types.ObjectId, required: false })
  vacancyId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false })
  applicationId?: Types.ObjectId;
}

export const notificationTargetSchema =
  SchemaFactory.createForClass(NotificationTarget);

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, required: true })
  recipient!: Types.ObjectId;

  @Prop({ type: String, enum: NOTIFICATION_RECIPIENT_ROLES, required: true })
  recipientRole!: NotificationRecipientRole;

  @Prop({ type: String, enum: NotificationType, required: true })
  type!: NotificationType;

  @Prop({ type: Boolean, default: false })
  read!: boolean;

  @Prop({ type: notificationDataSchema, required: false })
  data?: NotificationData;

  @Prop({ type: notificationTargetSchema, required: false })
  target?: NotificationTarget;

  @Prop({ type: Date, required: false })
  expiresAt?: Date;

  @Prop({ type: Date, required: false })
  lockedAt?: Date;

  @Prop({ type: Number, required: false, min: 0 })
  remainingMs?: number;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;

export type NotificationRecord = Notification & { _id: Types.ObjectId };

export const notificationSchema = SchemaFactory.createForClass(Notification);

notificationSchema.index({ recipient: 1, recipientRole: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
