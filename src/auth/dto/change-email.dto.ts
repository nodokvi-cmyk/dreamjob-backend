import { AccountEmail } from '../../shared/validation/account-email.js';

export class ChangeEmailDto {
  @AccountEmail()
  newEmail!: string;
}
