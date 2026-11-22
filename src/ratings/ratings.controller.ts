import {
  Body,
  Controller,
  Delete,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { IsAuthGuard } from '../guards/is-auth.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { AccountId } from '../shared/decorators/account-id.decorator.js';
import { Roles } from '../shared/decorators/roles.decorator.js';
import { IsValidMongoIdDto } from '../shared/dto/is-valid-mongo-id.dto.js';
import { strictThrottle } from '../shared/throttle/strict-throttle.js';
import { Throttle } from '../shared/throttle/throttle.decorator.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { RateCompanyDto } from './dto/rate-company.dto.js';
import { RatingsService } from './ratings.service.js';

@Controller('companies')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Put(':id/rating')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  @Throttle(strictThrottle)
  rate(
    @Param() { id }: IsValidMongoIdDto,
    @AccountId() accountId: string,
    @Body() { stars }: RateCompanyDto,
  ) {
    return this.ratingsService.rate(id, accountId, stars);
  }

  @Delete(':id/rating')
  @UseGuards(IsAuthGuard, RolesGuard)
  @Roles(AuthRole.USER)
  @Throttle(strictThrottle)
  remove(@Param() { id }: IsValidMongoIdDto, @AccountId() accountId: string) {
    return this.ratingsService.remove(id, accountId);
  }
}
