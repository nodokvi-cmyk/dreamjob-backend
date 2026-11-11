import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { Company } from '../companies/schema/company.schema.js';
import { EmailSenderService } from '../email-sender/email-sender.service.js';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { User } from '../users/schema/user.schema.js';
import { notificationEmail } from './notification-email.js';
import {
  Notification,
  NotificationData,
  NOTIFICATION_LIFETIME_DAYS,
  NotificationRecipientRole,
  NotificationRecord,
  NotificationType,
} from './schema/notification.schema.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const NOTIFICATION_LIFETIME_MS = NOTIFICATION_LIFETIME_DAYS * MS_PER_DAY;
const BADGE_COUNT_CAP = 100;

type NotificationFilter = QueryFilter<Notification>;

type Owner = {
  recipient: Types.ObjectId;
  recipientRole: NotificationRecipientRole;
};

type SeenState = { notificationsSeenAt?: Date };

export type NotificationInput = {
  type: NotificationType;
  data?: NotificationData;
  target?: {
    vacancyId?: string;
    applicationId?: string;
  };
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    private readonly emailSender: EmailSenderService,
    private readonly config: ConfigService,
  ) {}

  async notify(
    recipient: string,
    recipientRole: NotificationRecipientRole,
    input: NotificationInput,
  ): Promise<void> {
    await this.notifyMany([recipient], recipientRole, input);
  }

  async notifyMany(
    recipients: readonly string[],
    recipientRole: NotificationRecipientRole,
    input: NotificationInput,
  ): Promise<void> {
    if (recipients.length === 0) return;

    const expiresAt = new Date(Date.now() + NOTIFICATION_LIFETIME_MS);
    const target = this.toTarget(input.target);
    const docs = recipients.map((recipient) => ({
      recipient: new Types.ObjectId(recipient),
      recipientRole,
      type: input.type,
      ...(input.data ? { data: input.data } : {}),
      ...(target ? { target } : {}),
      expiresAt,
    }));

    try {
      await this.notificationModel.insertMany(docs);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to create ${input.type} notifications`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    await this.sendEmails(recipients, recipientRole, input);
  }

  private async sendEmails(
    recipients: readonly string[],
    recipientRole: NotificationRecipientRole,
    input: NotificationInput,
  ): Promise<void> {
    const email = notificationEmail(
      {
        type: input.type,
        data: input.data ?? {},
        vacancyId: input.target?.vacancyId,
      },
      this.config.getOrThrow<string>('FRONTEND_URI'),
    );
    if (!email) return;

    try {
      const filter = { _id: { $in: recipients } };
      const accounts =
        recipientRole === AuthRole.USER
          ? await this.userModel
              .find(filter)
              .select('email')
              .lean<{ email: string }[]>()
          : await this.companyModel
              .find(filter)
              .select('email')
              .lean<{ email: string }[]>();

      await Promise.all(
        accounts.map(({ email: to }) =>
          this.emailSender.sendNotice(to, email).catch(() => {
            this.logger.warn(`${input.type} email was not sent`);
          }),
        ),
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to send ${input.type} emails`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async list(accountId: string, accountRole: AuthRole, query: PaginationDto) {
    const { page, take } = query;
    const now = new Date();
    const filter: NotificationFilter = {
      ...this.owner(accountId, accountRole),
      ...this.liveFilter(now),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * take)
        .limit(take)
        .lean<NotificationRecord[]>(),
      this.notificationModel.countDocuments(filter),
      this.notificationModel.countDocuments({ ...filter, read: false }),
    ]);

    return {
      items: items.map((item) => this.toResponse(item, now)),
      total,
      page,
      take,
      unreadCount,
    };
  }

  async badge(accountId: string, accountRole: AuthRole) {
    const owner = this.owner(accountId, accountRole);
    const seenAt = await this.findSeenAt(owner);
    const filter: NotificationFilter = {
      ...owner,
      ...this.liveFilter(new Date()),
      ...(seenAt ? { createdAt: { $gt: seenAt } } : {}),
    };

    const unseenCount = await this.notificationModel.countDocuments(filter, {
      limit: BADGE_COUNT_CAP,
    });

    return { unseenCount };
  }

  async markSeen(accountId: string, accountRole: AuthRole) {
    const owner = this.owner(accountId, accountRole);
    const update = { $set: { notificationsSeenAt: new Date() } };

    if (owner.recipientRole === AuthRole.USER) {
      await this.userModel.updateOne({ _id: owner.recipient }, update);
    } else {
      await this.companyModel.updateOne({ _id: owner.recipient }, update);
    }

    return { unseenCount: 0 };
  }

  async markRead(id: string, accountId: string, accountRole: AuthRole) {
    const now = new Date();
    const updated = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: id,
          ...this.owner(accountId, accountRole),
          ...this.liveFilter(now),
        },
        { $set: { read: true } },
        { new: true },
      )
      .lean<NotificationRecord>();
    if (!updated) throw new NotFoundException('Notification not found');

    return this.toResponse(updated, now);
  }

  async setLock(
    id: string,
    accountId: string,
    accountRole: AuthRole,
    locked: boolean,
  ) {
    const now = new Date();
    const owner = this.owner(accountId, accountRole);
    const current = await this.notificationModel
      .findOne({ _id: id, ...owner, ...this.liveFilter(now) })
      .lean<NotificationRecord>();
    if (!current) throw new NotFoundException('Notification not found');

    const isLocked = !current.expiresAt;
    if (isLocked === locked) return this.toResponse(current, now);

    const updated = current.expiresAt
      ? await this.notificationModel
          .findOneAndUpdate(
            { _id: id, ...owner, expiresAt: current.expiresAt },
            {
              $set: {
                lockedAt: now,
                remainingMs: Math.max(
                  current.expiresAt.getTime() - now.getTime(),
                  0,
                ),
              },
              $unset: { expiresAt: 1 },
            },
            { new: true },
          )
          .lean<NotificationRecord>()
      : await this.notificationModel
          .findOneAndUpdate(
            { _id: id, ...owner, expiresAt: { $exists: false } },
            {
              $set: {
                expiresAt: new Date(
                  now.getTime() +
                    (current.remainingMs ?? NOTIFICATION_LIFETIME_MS),
                ),
              },
              $unset: { lockedAt: 1, remainingMs: 1 },
            },
            { new: true },
          )
          .lean<NotificationRecord>();
    if (!updated) {
      throw new ConflictException('Notification changed, try again');
    }

    return this.toResponse(updated, now);
  }

  async remove(id: string, accountId: string, accountRole: AuthRole) {
    const now = new Date();
    const deleted = await this.notificationModel
      .findOneAndDelete({
        _id: id,
        ...this.owner(accountId, accountRole),
        ...this.liveFilter(now),
      })
      .lean<NotificationRecord>();
    if (!deleted) throw new NotFoundException('Notification not found');

    return this.toResponse(deleted, now);
  }

  async clearAll(accountId: string, accountRole: AuthRole) {
    const { deletedCount } = await this.notificationModel.deleteMany({
      ...this.owner(accountId, accountRole),
      expiresAt: { $gt: new Date() },
    });

    return { deleted: deletedCount };
  }

  async removeForRecipient(
    recipient: string,
    recipientRole: NotificationRecipientRole,
  ): Promise<void> {
    await this.notificationModel.deleteMany({
      recipient: new Types.ObjectId(recipient),
      recipientRole,
    });
  }

  private toResponse(notification: NotificationRecord, now: Date) {
    const { expiresAt } = notification;
    const remainingMs = expiresAt
      ? Math.max(expiresAt.getTime() - now.getTime(), 0)
      : (notification.remainingMs ?? NOTIFICATION_LIFETIME_MS);
    const underOneDay = remainingMs < MS_PER_DAY;

    return {
      id: notification._id.toString(),
      type: notification.type,
      read: notification.read,
      createdAt: notification.createdAt,
      data: notification.data ?? {},
      target: {
        vacancyId: notification.target?.vacancyId?.toString() ?? null,
        applicationId: notification.target?.applicationId?.toString() ?? null,
      },
      locked: !expiresAt,
      expiresAt: expiresAt ?? null,
      lockedAt: expiresAt ? null : (notification.lockedAt ?? null),
      daysLeft: underOneDay ? 0 : Math.ceil(remainingMs / MS_PER_DAY),
      hoursLeft: underOneDay ? Math.floor(remainingMs / MS_PER_HOUR) : null,
    };
  }

  private owner(accountId: string, accountRole: AuthRole): Owner {
    if (accountRole !== AuthRole.USER && accountRole !== AuthRole.COMPANY) {
      throw new ForbiddenException('No permission');
    }

    return {
      recipient: new Types.ObjectId(accountId),
      recipientRole: accountRole,
    };
  }

  private liveFilter(now: Date): NotificationFilter {
    return { expiresAt: { $not: { $lte: now } } };
  }

  private toTarget(target: NotificationInput['target']) {
    if (!target || (!target.vacancyId && !target.applicationId)) {
      return undefined;
    }

    return {
      ...(target.vacancyId
        ? { vacancyId: new Types.ObjectId(target.vacancyId) }
        : {}),
      ...(target.applicationId
        ? { applicationId: new Types.ObjectId(target.applicationId) }
        : {}),
    };
  }

  private async findSeenAt(owner: Owner): Promise<Date | undefined> {
    const account =
      owner.recipientRole === AuthRole.USER
        ? await this.userModel
            .findById(owner.recipient)
            .select('+notificationsSeenAt')
            .lean<SeenState>()
        : await this.companyModel
            .findById(owner.recipient)
            .select('+notificationsSeenAt')
            .lean<SeenState>();

    return account?.notificationsSeenAt;
  }
}
