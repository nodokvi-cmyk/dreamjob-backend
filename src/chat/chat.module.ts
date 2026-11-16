import { Module } from '@nestjs/common';
import { PublicationsModule } from '../publications/publications.module.js';
import { VacanciesModule } from '../vacancies/vacancies.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { LlmClient } from './llm-client.js';

@Module({
  imports: [VacanciesModule, PublicationsModule],
  controllers: [ChatController],
  providers: [ChatService, LlmClient],
})
export class ChatModule {}
