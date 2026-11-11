import type { PlanNoticeEmailProps } from '../email/templates/plan-notice-email.js';
import { ApplicationStatus } from '../applications/schema/application.schema.js';
import {
  NotificationData,
  NotificationType,
} from './schema/notification.schema.js';

type EmailSource = {
  type: NotificationType;
  data: NotificationData;
  vacancyId?: string;
};

function statusChangeSentence(data: NotificationData): string | null {
  const company = data.companyName || 'The company';
  const vacancy = data.vacancyTitle ? `"${data.vacancyTitle}"` : 'a vacancy';

  switch (data.status) {
    case ApplicationStatus.INTERVIEW:
      return `${company} moved your application for ${vacancy} to the interview stage.`;
    case ApplicationStatus.ACCEPTED:
      return `${company} accepted your application for ${vacancy}.`;
    case ApplicationStatus.REJECTED:
      return `${company} rejected your application for ${vacancy}.`;
    default:
      return null;
  }
}

export function notificationEmail(
  { type, data, vacancyId }: EmailSource,
  frontendUri: string,
): PlanNoticeEmailProps | null {
  const dashboardUrl = `${frontendUri}/dashboard`;

  switch (type) {
    case NotificationType.COMPANY_APPROVED:
      return {
        subject: 'Your company is approved on GetDreamJob',
        heading: 'Your company is approved',
        paragraphs: [
          'Your company account was approved. You can now publish vacancies and manage applications.',
        ],
        buttonLabel: 'Go to dashboard',
        buttonUrl: dashboardUrl,
      };
    case NotificationType.COMPANY_REVOKED:
      return {
        subject: 'Your company approval on GetDreamJob was revoked',
        heading: 'Your company approval was revoked',
        paragraphs: [
          'An administrator revoked the approval of your company account.',
          'Your published vacancies stay visible, but you cannot create, edit or submit vacancies or manage applications until the company is approved again.',
        ],
        buttonLabel: 'Go to dashboard',
        buttonUrl: dashboardUrl,
      };
    case NotificationType.APPLICATION_STATUS_CHANGED: {
      const sentence = statusChangeSentence(data);
      if (!sentence) return null;

      return {
        subject: 'Update on your GetDreamJob application',
        heading: 'Your application was updated',
        paragraphs: [sentence],
        buttonLabel: 'View vacancy',
        buttonUrl: vacancyId
          ? `${frontendUri}/vacancies/${vacancyId}`
          : frontendUri,
      };
    }
    default:
      return null;
  }
}
