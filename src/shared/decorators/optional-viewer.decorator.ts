import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OptionalAuthRequest } from '../types/optional-auth-request.js';
import type { Viewer } from '../types/viewer.js';

export const OptionalViewer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Viewer | null => {
    const { accountId, accountRole } = context
      .switchToHttp()
      .getRequest<OptionalAuthRequest>();

    return accountId && accountRole ? { accountId, accountRole } : null;
  },
);
