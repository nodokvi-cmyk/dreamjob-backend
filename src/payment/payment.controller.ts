import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { strictThrottle } from '../shared/throttle/strict-throttle.js';
import { Throttle } from '../shared/throttle/throttle.decorator.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { ConfirmDto } from './dto/confirm.dto.js';
import { PaymentService } from './payment.service.js';

const webhookThrottle = { default: { limit: 300, ttl: 60_000 } };

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('checkout')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  @Throttle(strictThrottle)
  checkout(@AccountId() accountId: string, @Body() { plan }: CheckoutDto) {
    return this.paymentService.createPlanCheckout(accountId, plan);
  }

  @Get('confirm')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  confirm(@AccountId() accountId: string, @Query() { sessionId }: ConfirmDto) {
    return this.paymentService.confirmCheckout(accountId, sessionId);
  }

  @Post('portal')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.COMPANY)
  @Throttle(strictThrottle)
  portal(@AccountId() accountId: string) {
    return this.paymentService.createPortalSession(accountId);
  }

  @Post('webhook')
  @HttpCode(200)
  @Throttle(webhookThrottle)
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.paymentService.handleWebhook(request.rawBody, signature);
  }
}
