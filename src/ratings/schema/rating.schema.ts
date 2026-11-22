import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Company } from '../../companies/schema/company.schema.js';
import { User } from '../../users/schema/user.schema.js';

@Schema({ timestamps: true })
export class Rating {
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: Company.name, required: true })
  company!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  stars!: number;
}

export const ratingSchema = SchemaFactory.createForClass(Rating);

ratingSchema.index({ user: 1, company: 1 }, { unique: true });
ratingSchema.index({ company: 1 });
