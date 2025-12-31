import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Part, ModelParams } from '@google/generative-ai';
import { BaseSupervisor } from './BaseSupervisor.js';
import type { Message, SupervisorConfig } from '../types.js';

export class GoogleSupervisor extends BaseSupervisor {
  private client: GoogleGenerativeAI;

  constructor(config: SupervisorConfig) {
    super(config);
    const apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error(`[${this.name}] Google API Key is required.`);
    }
    this.client = new GoogleGenerativeAI(apiKey);
  }

  public async chat(messages: Message[]): Promise<string> {
    try {
      const systemMessage = messages.find(m => m.role === 'system');
      
      const modelParams: ModelParams = { 
        model: this.config.modelName || 'gemini-1.5-pro'
      };

      if (systemMessage && systemMessage.content) {
        modelParams.systemInstruction = systemMessage.content;
      }

      const model = this.client.getGenerativeModel(modelParams);

      // Gemini's chat history format differs from OpenAI's.
      // We need to convert standard Message[] to Gemini's Content[] format.
      
      const chatHistory = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content } as Part],
        }));

      // If we need to start a chat session with history
      const chatSession = model.startChat({
        history: chatHistory.slice(0, -1), // All but the last message
        generationConfig: {
            temperature: this.config.temperature || 0.7,
        }
      });

      const lastMessage = chatHistory[chatHistory.length - 1];
      if (!lastMessage) {
          return "No user message found to respond to.";
      }

      const result = await chatSession.sendMessage(lastMessage.parts[0]?.text || "");
      const response = result.response;
      return response.text();

    } catch (error: any) {
      console.error(`[${this.name}] Google API Error:`, error.message);
      return `[Error] Failed to generate response: ${error.message}`;
    }
  }
}
