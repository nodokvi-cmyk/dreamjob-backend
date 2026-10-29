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
import { CreateCompanyDto } from '../companies/dto/create-company.dto.js';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { AccountRole } from '../shared/decorators/account-role.decorator.js';
import { strictThrottle } from '../shared/throttle/strict-throttle.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { AuthService } from './auth.service.js';
import { EmailDto } from './dto/email.dto.js';
import { GoogleSignInDto } from './dto/google-sign-in.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SignInDto } from './dto/sign-in.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('users/sign-up')
  @Throttle(strictThrottle)
  signUpUser(@Body() createUserDto: CreateUserDto) {
    return this.authService.signUpUser(createUserDto);
  }

  @Post('users/verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  verifyUserEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyUserEmail(verifyEmailDto);
  }

  @Post('users/sign-in')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  signInUser(@Body() signInDto: SignInDto) {
    return this.authService.signInUser(signInDto);
  }

  @Post('users/resend-code')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  resendUserCode(@Body() emailDto: EmailDto) {
    return this.authService.resendUserCode(emailDto);
  }

  @Post('users/google')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  signInUserWithGoogle(@Body() googleSignInDto: GoogleSignInDto) {
    return this.authService.signInUserWithGoogle(googleSignInDto);
  }

  @Post('companies/google')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  signInCompanyWithGoogle(@Body() googleSignInDto: GoogleSignInDto) {
    return this.authService.signInCompanyWithGoogle(googleSignInDto);
  }

  @Post('companies/sign-up')
  @Throttle(strictThrottle)
  signUpCompany(@Body() createCompanyDto: CreateCompanyDto) {
    return this.authService.signUpCompany(createCompanyDto);
  }

  @Post('companies/verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  verifyCompanyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyCompanyEmail(verifyEmailDto);
  }

  @Post('companies/sign-in')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  signInCompany(@Body() signInDto: SignInDto) {
    return this.authService.signInCompany(signInDto);
  }

  @Post('companies/resend-code')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  resendCompanyCode(@Body() emailDto: EmailDto) {
    return this.authService.resendCompanyCode(emailDto);
  }

  @Post('users/forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  forgotUserPassword(@Body() emailDto: EmailDto) {
    return this.authService.forgotUserPassword(emailDto);
  }

  @Post('users/reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  resetUserPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetUserPassword(resetPasswordDto);
  }

  @Post('companies/forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  forgotCompanyPassword(@Body() emailDto: EmailDto) {
    return this.authService.forgotCompanyPassword(emailDto);
  }

  @Post('companies/reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(strictThrottle)
  resetCompanyPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetCompanyPassword(resetPasswordDto);
  }

  @Get('me')
  @UseGuards(IsAuthGuard)
  getCurrentAccount(
    @AccountId() accountId: string,
    @AccountRole() accountRole: AuthRole,
  ) {
    return this.authService.getCurrentAccount(accountId, accountRole);
  }
}
