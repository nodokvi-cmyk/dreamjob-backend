import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Application } from '../../applications/schema/application.schema.js';
import { Company } from '../../companies/schema/company.schema.js';
import { Publication } from '../../publications/schema/publication.schema.js';
import { User } from '../../users/schema/user.schema.js';
import { Vacancy } from '../../vacancies/schema/vacancy.schema.js';

export enum InvitationStatus {
  INVITED = 'invited',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
}

export const NO_INVITATION = 'none';

export type InvitationState = InvitationStatus | typeof NO_INVITATION;

export const MAX_INVITATION_MESSAGE_LENGTH = 500;
export const MAX_INVITATION_MESSAGE_WORDS = 100;

@Schema({ timestamps: true })
export class Invitation {
  @Prop({ type: Types.ObjectId, ref: Publication.name, required: true })
  publication!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Company.name, required: true })
  company!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Vacancy.name, required: true })
  vacancy!: Types.ObjectId;

  @Prop({
    type: String,
    enum: InvitationStatus,
    default: InvitationStatus.INVITED,
  })
  status!: InvitationStatus;

  @Prop({
    type: String,
    required: false,
    trim: true,
    maxlength: MAX_INVITATION_MESSAGE_LENGTH,
  })
  message?: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 128 })
  publicationTitle!: string;

  @Prop({ type: Types.ObjectId, ref: Application.name, required: false })
  application?: Types.ObjectId;

  @Prop({ type: Date, required: false })
  respondedAt?: Date;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

export type InvitationDocument = HydratedDocument<Invitation>;

export type InvitationRecord = Invitation & { _id: Types.ObjectId };

export const invitationSchema = SchemaFactory.createForClass(Invitation);

invitationSchema.index({ publication: 1, company: 1 }, { unique: true });
invitationSchema.index({ user: 1, createdAt: -1 });
invitationSchema.index({ company: 1, createdAt: -1 });
invitationSchema.index({ vacancy: 1 });
