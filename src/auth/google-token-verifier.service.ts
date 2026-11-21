import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
}

const NAME_MAX_LENGTH = 64;
const EMAIL_MAX_LENGTH = 128;

function firstFilled(...values: (string | undefined)[]): string | undefined {
  return values.map((value) => value?.trim()).find((value) => value);
}

@Injectable()
export class GoogleTokenVerifier {
  private readonly clientId: string;
  private readonly client: OAuth2Client;

  constructor(config: ConfigService) {
    this.clientId = config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.client = new OAuth2Client(this.clientId);
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    const ticket = await this.client
      .verifyIdToken({ idToken, audience: this.clientId })
      .catch(() => null);
    const payload = ticket?.getPayload();

    if (
      !payload?.email ||
      !payload.email_verified ||
      payload.email.length > EMAIL_MAX_LENGTH
    ) {
      throw new UnauthorizedException('Google sign-in failed');
    }

    const email = payload.email.toLowerCase();
    const firstName =
      firstFilled(payload.given_name, payload.name) ?? email.split('@')[0];

    return {
      googleId: payload.sub,
      email,
      firstName: firstName.slice(0, NAME_MAX_LENGTH),
      lastName: (payload.family_name ?? '').trim().slice(0, NAME_MAX_LENGTH),
    };
  }
}
