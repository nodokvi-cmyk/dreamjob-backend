import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { ApplicationsService } from '../applications/applications.service.js';
import {
  Application,
  ApplicationStatus,
} from '../applications/schema/application.schema.js';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import {
  companyFieldsOf,
  companySummaries,
} from '../companies/company-summaries.js';
import { Company } from '../companies/schema/company.schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  NotificationData,
  NotificationType,
} from '../notifications/schema/notification.schema.js';
import { PLAN_SETTINGS } from '../payment/plan-settings.js';
import {
  boardFilter,
  isLivePublication,
  isOnBoard,
  isPublicationExpired,
} from '../publications/publication-status.js';
import {
  Publication,
  PublicationRecord,
  PublicationStatus,
} from '../publications/schema/publication.schema.js';
import { isDuplicateKeyError } from '../shared/mongo/is-duplicate-key-error.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { BillingPlan } from '../shared/types/billing-plan.js';
import {
  Vacancy,
  VacancyRecord,
  VacancyStatus,
} from '../vacancies/schema/vacancy.schema.js';
import { userFacingTitle } from '../vacancies/vacancy-card.js';
import { vacancyStatusForUser } from '../vacancies/vacancy-status.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import {
  MyInvitationsFilterDto,
  SentInvitationsFilterDto,
} from './dto/invitation-filter.dto.js';
import {
  Invitation,
  InvitationRecord,
  InvitationStatus,
  MAX_INVITATION_SENDS,
} from './schema/invitation.schema.js';

type InvitationFilter = QueryFilter<Invitation>;

type NewInvitation = Omit<
  Invitation,
  'status' | 'sends' | 'application' | 'respondedAt' | 'createdAt' | 'updatedAt'
>;

type InviteVacancy = Pick<
  VacancyRecord,
  '_id' | 'company' | 'status' | 'deadline' | 'title'
>;

type InboxVacancy = Pick<
  VacancyRecord,
  | '_id'
  | 'title'
  | 'company'
  | 'deadline'
  | 'status'
  | 'submittedAt'
  | 'approvedCard'
>;

type PublicationAccess = Pick<
  PublicationRecord,
  '_id' | 'status' | 'acceptingInvites' | 'expiresAt'
>;

type AcceptPublication = Pick<
  PublicationRecord,
  'status' | 'expiresAt' | 'pausedAt' | 'cvKey' | 'coverLetterKey'
>;

export type CompanyInvitation = {
  id: string;
  status: InvitationStatus;
  vacancyId: string;
  grantsAccess: boolean;
  canInvite: boolean;
};

type AccessSource = Pick<InvitationRecord, '_id' | 'status' | 'application'>;

const INBOX_VACANCY_PROJECTION =
  'title company deadline status submittedAt approvedCard';

const NEWEST_FIRST = { createdAt: -1, _id: -1 } as const;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<Invitation>,
    @InjectModel(Publication.name)
    private readonly publicationModel: Model<Publication>,
    @InjectModel(Vacancy.name) private readonly vacancyModel: Model<Vacancy>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    @InjectModel(Application.name)
    private readonly applicationModel: Model<Application>,
    private readonly applications: ApplicationsService,
    private readonly notifications: NotificationsService,
    private readonly s3: AwsS3Service,
  ) {}

  toResponse(invitation: InvitationRecord) {
    return {
      id: invitation._id.toString(),
      status: invitation.status,
      sends: invitation.sends ?? 1,
      message: invitation.message ?? '',
      publication: invitation.publication.toString(),
      vacancy: invitation.vacancy.toString(),
      company: invitation.company.toString(),
      applicationId: invitation.application?.toString() ?? null,
      createdAt: invitation.createdAt,
      respondedAt: invitation.respondedAt ?? null,
    };
  }

  async invite(
    publicationId: string,
    companyId: string,
    { vacancyId, message }: CreateInvitationDto,
  ) {
    const company = await this.companyModel
      .findOne({ _id: companyId, approved: true })
      .select('companyName')
      .lean<Pick<Company, 'companyName'>>();
    if (!company) throw new ForbiddenException('Company is not approved');

    const publication = await this.publicationModel
      .findOne({ _id: publicationId, ...boardFilter(new Date()) })
      .select('user title')
      .lean<Pick<PublicationRecord, '_id' | 'user' | 'title'>>();
    if (!publication) throw new NotFoundException('Publication not found');

    const vacancy = await this.vacancyModel
      .findById(vacancyId)
      .select('company status deadline title')
      .lean<InviteVacancy>();
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    if (vacancy.company.toString() !== companyId) {
      throw new ForbiddenException('No permission');
    }
    if (
      vacancy.status !== VacancyStatus.PUBLISHED ||
      vacancy.deadline.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        'Only a published vacancy that has not expired can be used for an invitation',
      );
    }

    const { invitation, previous } = await this.createOrReinvite({
      publication: publication._id,
      user: publication.user,
      company: new Types.ObjectId(companyId),
      vacancy: vacancy._id,
      message: message || undefined,
      publicationTitle: publication.title,
    });

    await this.removeIfOrphaned(invitation, companyId, previous);

    if (!(await this.spendInvite(companyId))) {
      await this.undoSend(invitation, previous);
      const { limit } = await this.quota(companyId);
      throw new BadRequestException(
        `Monthly invitation limit reached (${limit}). It resets at the start of next month (UTC).`,
      );
    }

    await this.notifications.notify(
      publication.user.toString(),
      AuthRole.USER,
      {
        type: NotificationType.INVITATION_RECEIVED,
        data: {
          companyName: company.companyName,
          vacancyTitle: vacancy.title,
          publicationTitle: publication.title,
        },
        target: {
          vacancyId: vacancy._id.toString(),
          publicationId: publication._id.toString(),
          invitationId: invitation._id.toString(),
        },
      },
    );

    return this.toResponse(invitation);
  }

  async cancel(id: string, companyId: string) {
    const invitation = await this.invitationModel
      .findById(id)
      .lean<InvitationRecord>();
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.company.toString() !== companyId) {
      throw new ForbiddenException('No permission');
    }
    await this.assertCompanyApproved(companyId);
    if (invitation.status !== InvitationStatus.INVITED) {
      throw new BadRequestException(
        'Only an invitation that was not answered yet can be cancelled',
      );
    }

    const cancelled = await this.invitationModel
      .findOneAndUpdate(
        {
          _id: id,
          company: invitation.company,
          status: InvitationStatus.INVITED,
        },
        { $set: { status: InvitationStatus.CANCELLED } },
        { new: true },
      )
      .lean<InvitationRecord>();
    if (!cancelled) {
      throw new ConflictException('Invitation changed, try again');
    }

    return this.toResponse(cancelled);
  }

  async quota(companyId: string) {
    const company = await this.companyModel
      .findById(companyId)
      .select({ plan: 1, invitesMonth: 1, invitesUsed: 1 })
      .lean<Pick<Company, 'plan' | 'invitesMonth' | 'invitesUsed'>>();
    if (!company) throw new NotFoundException('Company not found');

    const now = new Date();

    return {
      used:
        company.invitesMonth === this.monthOf(now)
          ? (company.invitesUsed ?? 0)
          : 0,
      limit: this.inviteLimit(company.plan),
      resetsAt: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      ),
    };
  }

  async listSent(companyId: string, query: SentInvitationsFilterDto) {
    const { page, take, status, vacancyId } = query;
    const filter: InvitationFilter = {
      company: new Types.ObjectId(companyId),
      ...(status ? { status } : {}),
      ...(vacancyId ? { vacancy: new Types.ObjectId(vacancyId) } : {}),
    };

    const [invitations, total] = await Promise.all([
      this.findPage(filter, page, take),
      this.invitationModel.countDocuments(filter),
    ]);
    if (invitations.length === 0) return { items: [], total, page, take };

    const [vacancies, publications, approved] = await Promise.all([
      this.vacancyModel
        .find({ _id: { $in: invitations.map(({ vacancy }) => vacancy) } })
        .select('title')
        .lean<Pick<VacancyRecord, '_id' | 'title'>[]>(),
      this.publicationModel
        .find({
          _id: { $in: invitations.map(({ publication }) => publication) },
        })
        .select('status acceptingInvites expiresAt')
        .lean<PublicationAccess[]>(),
      this.isCompanyApproved(companyId),
    ]);
    const vacancyById = new Map(
      vacancies.map((vacancy) => [vacancy._id.toString(), vacancy]),
    );
    const publicationById = new Map(
      publications.map((publication) => [
        publication._id.toString(),
        publication,
      ]),
    );
    const granting = await this.accessGrantingIds(invitations);
    const now = new Date();

    return {
      items: invitations.map((invitation) => {
        const vacancy = vacancyById.get(invitation.vacancy.toString());
        const publication = publicationById.get(
          invitation.publication.toString(),
        );

        return {
          ...this.toResponse(invitation),
          vacancy: vacancy
            ? { id: vacancy._id.toString(), title: vacancy.title }
            : null,
          publication: publication
            ? {
                id: publication._id.toString(),
                title: invitation.publicationTitle,
              }
            : null,
          publicationAvailable: Boolean(
            approved &&
            publication &&
            this.canCompanySee(
              publication,
              granting.has(invitation._id.toString()),
              now,
            ),
          ),
        };
      }),
      total,
      page,
      take,
    };
  }

  async listMine(userId: string, query: MyInvitationsFilterDto) {
    const { take, status, vacancyId, focus } = query;
    const filter: InvitationFilter = {
      user: new Types.ObjectId(userId),
      status: status ?? { $ne: InvitationStatus.CANCELLED },
      ...(vacancyId ? { vacancy: new Types.ObjectId(vacancyId) } : {}),
    };
    const focusPage = focus
      ? await this.findFocusPage(filter, focus, take)
      : undefined;
    const page = focusPage ?? query.page;

    const [invitations, total] = await Promise.all([
      this.findPage(filter, page, take),
      this.invitationModel.countDocuments(filter),
    ]);
    if (invitations.length === 0) return { items: [], total, page, take };

    const [vacancies, publications, companies] = await Promise.all([
      this.vacancyModel
        .find({ _id: { $in: invitations.map(({ vacancy }) => vacancy) } })
        .select(INBOX_VACANCY_PROJECTION)
        .lean<InboxVacancy[]>(),
      this.publicationModel
        .find({
          _id: { $in: invitations.map(({ publication }) => publication) },
        })
        .select('title')
        .lean<Pick<PublicationRecord, '_id' | 'title'>[]>(),
      companySummaries(
        this.companyModel,
        this.s3,
        invitations.map(({ company }) => company),
      ),
    ]);
    const myApplications = await this.applications.myApplicationsFor(
      userId,
      vacancies,
      companies.approvedIds,
    );
    const vacancyById = new Map(
      vacancies.map((vacancy) => [vacancy._id.toString(), vacancy]),
    );
    const publicationById = new Map(
      publications.map((publication) => [
        publication._id.toString(),
        publication,
      ]),
    );

    return {
      items: invitations.map((invitation) => {
        const vacancyId = invitation.vacancy.toString();
        const vacancy = vacancyById.get(vacancyId);
        const publication = publicationById.get(
          invitation.publication.toString(),
        );
        const company = companyFieldsOf(invitation.company, companies);

        return {
          id: invitation._id.toString(),
          status: invitation.status,
          message: invitation.message ?? '',
          createdAt: invitation.createdAt,
          respondedAt: invitation.respondedAt ?? null,
          publication: publication
            ? { id: publication._id.toString(), title: publication.title }
            : null,
          vacancy: vacancy
            ? {
                id: vacancyId,
                title: userFacingTitle(vacancy),
                deadline: vacancy.deadline,
                status: vacancyStatusForUser(vacancy),
              }
            : null,
          company: {
            id: invitation.company.toString(),
            companyName: company.companyName,
            logoUrl: company.logoUrl,
            approved: companies.approvedIds.has(invitation.company.toString()),
          },
          application: myApplications.get(vacancyId) ?? null,
        };
      }),
      total,
      page,
      take,
    };
  }

  async accept(id: string, userId: string) {
    const invitation = await this.findAnswerable(id, userId);

    const publication = await this.publicationModel
      .findById(invitation.publication)
      .select('status expiresAt pausedAt cvKey coverLetterKey')
      .lean<AcceptPublication>();
    if (!publication) throw new NotFoundException('Publication not found');
    this.assertPublicationLive(publication);

    const { application, created } =
      await this.applications.applyFromInvitation(
        invitation.vacancy.toString(),
        userId,
        {
          cvKey: publication.cvKey || undefined,
          coverLetterKey: publication.coverLetterKey || undefined,
        },
      );

    const updated = await this.invitationModel
      .findOneAndUpdate(
        { _id: id, user: invitation.user, status: InvitationStatus.INVITED },
        {
          $set: {
            status: InvitationStatus.ACCEPTED,
            application: new Types.ObjectId(application.id),
            respondedAt: new Date(),
          },
        },
        { new: true },
      )
      .lean<InvitationRecord>();

    if (updated || created) {
      await this.notifyCompany(
        invitation,
        NotificationType.INVITATION_ACCEPTED,
        application.id,
        {
          isReapply: created && application.submissions > 1,
          alreadyApplied: !created,
        },
      );
    }

    return {
      invitation: updated ? this.toResponse(updated) : null,
      application,
    };
  }

  async decline(id: string, userId: string) {
    const invitation = await this.findAnswerable(id, userId);

    const updated = await this.invitationModel
      .findOneAndUpdate(
        { _id: id, user: invitation.user, status: InvitationStatus.INVITED },
        {
          $set: {
            status: InvitationStatus.DECLINED,
            respondedAt: new Date(),
          },
        },
        { new: true },
      )
      .lean<InvitationRecord>();
    if (!updated) throw new ConflictException('Invitation changed, try again');

    await this.notifyCompany(invitation, NotificationType.INVITATION_DECLINED);

    return this.toResponse(updated);
  }

  async statesFor(
    companyId: string,
    publicationIds: readonly Types.ObjectId[],
  ): Promise<Map<string, CompanyInvitation>> {
    if (publicationIds.length === 0) return new Map();

    const invitations = await this.invitationModel
      .find({
        company: new Types.ObjectId(companyId),
        publication: { $in: publicationIds },
      })
      .select('publication status sends vacancy application')
      .lean<
        (AccessSource &
          Pick<InvitationRecord, 'publication' | 'vacancy' | 'sends'>)[]
      >();
    const [granting, liveVacancies] = await Promise.all([
      this.accessGrantingIds(invitations),
      this.existingVacancyIds(
        invitations
          .filter(({ status }) => status === InvitationStatus.ACCEPTED)
          .map(({ vacancy }) => vacancy),
      ),
    ]);

    return new Map(
      invitations.map((invitation) => [
        invitation.publication.toString(),
        {
          id: invitation._id.toString(),
          status: invitation.status,
          vacancyId: invitation.vacancy.toString(),
          grantsAccess: granting.has(invitation._id.toString()),
          canInvite:
            (invitation.status === InvitationStatus.CANCELLED ||
              invitation.status === InvitationStatus.DECLINED ||
              (invitation.status === InvitationStatus.ACCEPTED &&
                !liveVacancies.has(invitation.vacancy.toString()))) &&
            (invitation.sends ?? 1) < MAX_INVITATION_SENDS,
        },
      ]),
    );
  }

  private async existingVacancyIds(
    vacancyIds: readonly Types.ObjectId[],
  ): Promise<Set<string>> {
    if (vacancyIds.length === 0) return new Set();

    const found = await this.vacancyModel
      .find({ _id: { $in: vacancyIds } })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();
    return new Set(found.map(({ _id }) => _id.toString()));
  }

  private async accessGrantingIds(
    invitations: readonly AccessSource[],
  ): Promise<Set<string>> {
    const granting = new Set(
      invitations
        .filter(({ status }) => status === InvitationStatus.INVITED)
        .map(({ _id }) => _id.toString()),
    );

    const accepted = invitations.filter(
      (
        invitation,
      ): invitation is AccessSource & { application: Types.ObjectId } =>
        invitation.status === InvitationStatus.ACCEPTED &&
        invitation.application !== undefined,
    );
    if (accepted.length === 0) return granting;

    const active = await this.applicationModel
      .find({
        _id: { $in: accepted.map(({ application }) => application) },
        status: { $ne: ApplicationStatus.WITHDRAWN },
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();
    const activeIds = new Set(active.map(({ _id }) => _id.toString()));

    for (const invitation of accepted) {
      if (activeIds.has(invitation.application.toString())) {
        granting.add(invitation._id.toString());
      }
    }

    return granting;
  }

  async removeForPublications(
    publicationIds: readonly (string | Types.ObjectId)[],
  ): Promise<void> {
    if (publicationIds.length === 0) return;

    await this.invitationModel.deleteMany({
      publication: { $in: publicationIds },
    });
  }

  async releaseForVacancy(vacancyId: string | Types.ObjectId): Promise<void> {
    await this.releaseMatching({ vacancy: vacancyId });
  }

  async releaseForVacancies(vacancyIds: string[]): Promise<void> {
    if (vacancyIds.length === 0) return;
    await this.releaseMatching({
      vacancy: { $in: vacancyIds.map((id) => new Types.ObjectId(id)) },
    });
  }

  private async releaseMatching(
    byVacancy: Record<string, unknown>,
  ): Promise<void> {
    await this.invitationModel.updateMany(
      { ...byVacancy, status: InvitationStatus.INVITED },
      { $set: { status: InvitationStatus.CANCELLED } },
    );
    await this.invitationModel.updateMany(
      {
        ...byVacancy,
        status: InvitationStatus.ACCEPTED,
        application: { $exists: true },
      },
      { $unset: { application: 1 } },
    );
  }

  async removeForCompany(companyId: string): Promise<void> {
    await this.invitationModel.deleteMany({
      company: new Types.ObjectId(companyId),
    });
  }

  private canCompanySee(
    publication: PublicationAccess,
    grantsAccess: boolean,
    now: Date,
  ): boolean {
    return (
      isOnBoard(publication, now) ||
      (grantsAccess && isLivePublication(publication, now))
    );
  }

  private async createOrReinvite(
    fields: NewInvitation,
  ): Promise<{ invitation: InvitationRecord; previous?: InvitationRecord }> {
    try {
      const created = await this.invitationModel.create(fields);

      return { invitation: created.toObject() };
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) throw error;
    }

    const pair = { publication: fields.publication, company: fields.company };
    const existing = await this.invitationModel
      .findOne(pair)
      .select('status sends vacancy')
      .lean<Pick<InvitationRecord, 'status' | 'sends' | 'vacancy'>>();
    const acceptedVacancyGone =
      existing?.status === InvitationStatus.ACCEPTED &&
      (await this.vacancyModel.exists({ _id: existing.vacancy })) === null;

    const changes = {
      status: InvitationStatus.INVITED,
      sends: MAX_INVITATION_SENDS,
      user: fields.user,
      vacancy: fields.vacancy,
      publicationTitle: fields.publicationTitle,
      ...(fields.message ? { message: fields.message } : {}),
    };
    const previous = await this.invitationModel
      .findOneAndUpdate(
        {
          ...pair,
          sends: { $not: { $gte: MAX_INVITATION_SENDS } },
          $or: [
            { status: InvitationStatus.CANCELLED },
            {
              status: InvitationStatus.DECLINED,
              vacancy: { $ne: fields.vacancy },
            },
            ...(acceptedVacancyGone && existing
              ? [
                  {
                    status: InvitationStatus.ACCEPTED,
                    vacancy: existing.vacancy,
                  },
                ]
              : []),
          ],
        },
        {
          $set: changes,
          $unset: {
            respondedAt: '',
            application: '',
            ...(fields.message ? {} : { message: '' }),
          },
        },
        { returnDocument: 'before' },
      )
      .lean<InvitationRecord>();
    if (previous) {
      const {
        respondedAt: _respondedAt,
        message: _message,
        application: _application,
        ...kept
      } = previous;
      return { invitation: { ...kept, ...changes }, previous };
    }

    throw new ConflictException(
      this.inviteConflictMessage(existing, fields, acceptedVacancyGone),
    );
  }

  private inviteConflictMessage(
    existing: Pick<InvitationRecord, 'status' | 'sends' | 'vacancy'> | null,
    fields: NewInvitation,
    acceptedVacancyGone: boolean,
  ): string {
    const ended =
      existing?.status === InvitationStatus.CANCELLED ||
      existing?.status === InvitationStatus.DECLINED ||
      acceptedVacancyGone;
    if (ended && (existing?.sends ?? 1) >= MAX_INVITATION_SENDS) {
      return `A publication can be invited at most ${MAX_INVITATION_SENDS} times`;
    }
    if (
      existing?.status === InvitationStatus.DECLINED &&
      existing.vacancy.equals(fields.vacancy)
    ) {
      return 'This invitation was declined, choose a different vacancy';
    }
    return 'You already invited this publication';
  }

  private async undoSend(
    invitation: InvitationRecord,
    previous?: InvitationRecord,
  ) {
    if (!previous) {
      await this.invitationModel.deleteOne({ _id: invitation._id });
      return;
    }

    const unset: Record<string, ''> = {};
    if (!previous.message) unset.message = '';
    if (!previous.respondedAt) unset.respondedAt = '';
    if (!previous.application) unset.application = '';

    await this.invitationModel.updateOne(
      {
        _id: invitation._id,
        status: {
          $in: [InvitationStatus.INVITED, InvitationStatus.CANCELLED],
        },
        sends: MAX_INVITATION_SENDS,
        vacancy: invitation.vacancy,
      },
      {
        $set: {
          status: previous.status,
          sends: previous.sends ?? 1,
          user: previous.user,
          vacancy: previous.vacancy,
          publicationTitle: previous.publicationTitle,
          ...(previous.message ? { message: previous.message } : {}),
          ...(previous.respondedAt
            ? { respondedAt: previous.respondedAt }
            : {}),
          ...(previous.application
            ? { application: previous.application }
            : {}),
        },
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
    );
  }

  private async removeIfOrphaned(
    invitation: InvitationRecord,
    companyId: string,
    previous?: InvitationRecord,
  ): Promise<void> {
    const [publicationExists, vacancyExists, companyExists] = await Promise.all(
      [
        this.publicationModel.exists({ _id: invitation.publication }),
        this.vacancyModel.exists({ _id: invitation.vacancy }),
        this.companyModel.exists({ _id: companyId }),
      ],
    );
    if (publicationExists && vacancyExists && companyExists) return;

    if (publicationExists && companyExists) {
      await this.undoSend(invitation, previous);
    } else {
      await this.invitationModel.deleteOne({ _id: invitation._id });
    }

    if (!publicationExists) {
      throw new NotFoundException('Publication not found');
    }
    throw new NotFoundException(
      vacancyExists ? 'Company not found' : 'Vacancy not found',
    );
  }

  private async spendInvite(companyId: string): Promise<boolean> {
    const company = await this.companyModel
      .findById(companyId)
      .select('plan')
      .lean<Pick<Company, 'plan'>>();
    if (!company) return false;

    const month = this.monthOf(new Date());
    const planFilter = company.plan
      ? { plan: company.plan }
      : { plan: { $exists: false } };

    const countInMonth = async (): Promise<boolean> => {
      const counted = await this.companyModel.updateOne(
        {
          _id: companyId,
          ...planFilter,
          invitesMonth: month,
          invitesUsed: { $lt: this.inviteLimit(company.plan) },
        },
        { $inc: { invitesUsed: 1 } },
      );

      return counted.modifiedCount > 0;
    };

    if (await countInMonth()) return true;

    const reset = await this.companyModel.updateOne(
      { _id: companyId, ...planFilter, invitesMonth: { $ne: month } },
      { $set: { invitesMonth: month, invitesUsed: 1 } },
    );
    if (reset.modifiedCount > 0) return true;

    return countInMonth();
  }

  private inviteLimit(plan: BillingPlan | undefined): number {
    return PLAN_SETTINGS[plan ?? BillingPlan.PAY_AS_YOU_PUBLISH].monthlyInvites;
  }

  private monthOf(date: Date): string {
    return date.toISOString().slice(0, 7);
  }

  private async findPage(
    filter: InvitationFilter,
    page: number,
    take: number,
  ): Promise<InvitationRecord[]> {
    return this.invitationModel
      .find(filter)
      .sort(NEWEST_FIRST)
      .skip((page - 1) * take)
      .limit(take)
      .lean<InvitationRecord[]>();
  }

  private async findFocusPage(
    filter: InvitationFilter,
    focus: string,
    take: number,
  ): Promise<number | undefined> {
    const [result] = await this.invitationModel.aggregate<{ index: number }>([
      { $match: filter },
      { $sort: NEWEST_FIRST },
      { $group: { _id: null, ids: { $push: '$_id' } } },
      {
        $project: {
          _id: 0,
          index: { $indexOfArray: ['$ids', new Types.ObjectId(focus)] },
        },
      },
    ]);
    if (!result || result.index < 0) return undefined;

    return Math.floor(result.index / take) + 1;
  }

  private async findAnswerable(
    id: string,
    userId: string,
  ): Promise<InvitationRecord> {
    const invitation = await this.invitationModel
      .findById(id)
      .lean<InvitationRecord>();
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.user.toString() !== userId) {
      throw new ForbiddenException('No permission');
    }
    if (invitation.status === InvitationStatus.CANCELLED) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== InvitationStatus.INVITED) {
      throw new BadRequestException('This invitation was already answered');
    }

    return invitation;
  }

  private assertPublicationLive(publication: AcceptPublication): void {
    if (isLivePublication(publication)) return;

    if (publication.status === PublicationStatus.CLOSED) {
      throw new ConflictException('Your publication is closed');
    }
    if (isPublicationExpired(publication)) {
      throw new ConflictException(
        'Your publication has expired. Extend it to accept this invitation',
      );
    }
    throw new ConflictException(
      'Your publication is under review. You can accept this invitation once it is published again',
    );
  }

  private async notifyCompany(
    invitation: InvitationRecord,
    type:
      | NotificationType.INVITATION_ACCEPTED
      | NotificationType.INVITATION_DECLINED,
    applicationId?: string,
    extra: Pick<NotificationData, 'isReapply' | 'alreadyApplied'> = {},
  ): Promise<void> {
    try {
      const vacancy = await this.vacancyModel
        .findById(invitation.vacancy)
        .select('title')
        .lean<Pick<VacancyRecord, 'title'>>();

      await this.notifications.notify(
        invitation.company.toString(),
        AuthRole.COMPANY,
        {
          type,
          data: {
            ...(vacancy ? { vacancyTitle: vacancy.title } : {}),
            publicationTitle: invitation.publicationTitle,
            ...extra,
          },
          target: {
            vacancyId: invitation.vacancy.toString(),
            invitationId: invitation._id.toString(),
            ...(applicationId ? { applicationId } : {}),
          },
        },
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to send a ${type} notification`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async isCompanyApproved(companyId: string): Promise<boolean> {
    const approved = await this.companyModel.exists({
      _id: companyId,
      approved: true,
    });

    return approved !== null;
  }

  private async assertCompanyApproved(companyId: string): Promise<void> {
    if (!(await this.isCompanyApproved(companyId))) {
      throw new ForbiddenException('Company is not approved');
    }
  }
}
