import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { OptionalAuthGuard } from '../guards/optional-auth.guard.js';
import { OptionalViewer } from '../shared/decorators/optional-viewer.decorator.js';
import { strictThrottle } from '../shared/throttle/strict-throttle.js';
import { Throttle } from '../shared/throttle/throttle.decorator.js';
import type { Viewer } from '../shared/types/viewer.js';
import { ChatService } from './chat.service.js';
import { ChatDto } from './dto/chat.dto.js';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(OptionalAuthGuard)
  @Throttle(strictThrottle)
  send(@Body() dto: ChatDto, @OptionalViewer() viewer: Viewer | null) {
    return this.chatService.reply(dto, viewer);
  }
}
