import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class EmailClaim {
  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 128,
  })
  email!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  ownerId!: Types.ObjectId;

  @Prop({ type: Date, index: { expireAfterSeconds: 0 } })
  expiresAt?: Date;
}

export const emailClaimSchema = SchemaFactory.createForClass(EmailClaim);
