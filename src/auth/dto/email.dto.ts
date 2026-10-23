import { PickType } from '@nestjs/mapped-types';
import { CreateUserDto } from '../../users/dto/create-user.dto.js';

export class EmailDto extends PickType(CreateUserDto, ['email']) {}
