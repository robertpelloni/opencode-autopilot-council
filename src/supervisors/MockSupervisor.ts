import { BaseSupervisor } from './BaseSupervisor.js';
import type { Message } from '../types.js';

export class MockSupervisor extends BaseSupervisor {
  public async chat(messages: Message[]): Promise<string> {
    const lastMessage = messages[messages.length - 1];
    return `[Mock Response] I received: "${lastMessage?.content?.substring(0, 50)}...". Everything looks nominal from my simulation.`;
  }
}
