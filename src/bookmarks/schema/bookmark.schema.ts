import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { User } from '../../users/schema/user.schema.js';
import { Vacancy } from '../../vacancies/schema/vacancy.schema.js';

@Schema({ timestamps: true })
export class Bookmark {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Vacancy.name, required: true })
  vacancy!: Types.ObjectId;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

export type BookmarkRecord = Bookmark & { _id: Types.ObjectId };

export const bookmarkSchema = SchemaFactory.createForClass(Bookmark);

bookmarkSchema.index({ user: 1, vacancy: 1 }, { unique: true });
bookmarkSchema.index({ user: 1, createdAt: -1 });
bookmarkSchema.index({ vacancy: 1 });
