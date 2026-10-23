import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { UserId } from '../users/decorators/user-id.decorator.js';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { AuthService } from './auth.service.js';
import { EmailDto } from './dto/email.dto.js';
import { SignInDto } from './dto/sign-in.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';

const strictThrottle = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @Throttle(strictThrottle)
  signUp(@Body() createUserDto: CreateUserDto) {
    return this.authService.signUp(createUserDto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto);
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  signIn(@Body() signInDto: SignInDto) {
    return this.authService.signIn(signInDto);
  }

  @Post('resend-code')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  resendVerificationCode(@Body() emailDto: EmailDto) {
    return this.authService.resendVerificationCode(emailDto);
  }

  @Get('me')
  @UseGuards(IsAuthGuard)
  getCurrentUser(@UserId() userId: string) {
    return this.authService.getCurrentUser(userId);
  }
}
