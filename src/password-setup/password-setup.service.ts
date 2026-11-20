import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Company } from '../companies/schema/company.schema.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { User } from '../users/schema/user.schema.js';

@Injectable()
export class PasswordSetupService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
  ) {}

  async isBlocked(accountId: string, accountRole: AuthRole): Promise<boolean> {
    const withoutLogin = {
      password: { $exists: false },
      googleId: { $exists: false },
    };

    const found =
      accountRole === AuthRole.COMPANY
        ? await this.companyModel.exists({ _id: accountId, ...withoutLogin })
        : await this.userModel.exists({ _id: accountId, ...withoutLogin });

    return found !== null;
  }
}
