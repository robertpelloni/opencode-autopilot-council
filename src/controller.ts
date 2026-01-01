import 'dotenv/config';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { Council } from './council.js';
import { OpenAISupervisor } from './supervisors/OpenAISupervisor.js';
import { AnthropicSupervisor } from './supervisors/AnthropicSupervisor.js';
import { GoogleSupervisor } from './supervisors/GoogleSupervisor.js';
import { DeepSeekSupervisor } from './supervisors/DeepSeekSupervisor.js';
import { MockSupervisor } from './supervisors/MockSupervisor.js';
import type { CouncilConfig, SupervisorConfig, DevelopmentContext } from './types.js';

async function main() {
  console.log("Connecting to OpenCode...");
  
  // 1. Connect to OpenCode
  const client = createOpencodeClient({
    baseUrl: process.env.OPENCODE_URL || "http://localhost:4096",
  });

  try {
    // Check connection by listing projects or sessions
    await client.project.list();
    console.log(`Connected to OpenCode`);
  } catch (e) {
    console.error("Failed to connect to OpenCode. Make sure it is running.");
    console.error("Set OPENCODE_URL env var if it's not on localhost:4096");
    process.exit(1);
  }

  // 2. Get the active session
  const sessions = await client.session.list();
  if (!sessions.data || sessions.data.length === 0) {
    console.error("No active sessions found in OpenCode.");
    process.exit(1);
  }

  // Sort by last updated or created? The API returns a list. 
  // Let's assume the first one or the most recent one.
  // For now, we'll pick the first one.
  const session = sessions.data[0];
  if (!session) {
      console.error("Session is undefined");
      process.exit(1);
  }
  console.log(`Attaching to session: ${session.title} (${session.id})`);

  // 3. Gather Context from the Session
  const messages = await client.session.messages({ path: { id: session.id } });
  const history = messages.data || [];
  
  // Simple heuristic to find the goal: Last user message
  const lastUserMsg = [...history].reverse().find(m => m.info.role === 'user');
  const currentGoal = lastUserMsg 
    ? (lastUserMsg.parts.find(p => p.type === 'text') as any)?.text || "Unknown Goal"
    : "Review project state";

  console.log(`Detected Goal: ${currentGoal}`);

  // 4. Initialize Council
  const supervisors: SupervisorConfig[] = [];
  if (process.env.OPENAI_API_KEY) supervisors.push({ name: "GPT-Architect", provider: "openai", modelName: "gpt-4o" });
  if (process.env.ANTHROPIC_API_KEY) supervisors.push({ name: "Claude-Reviewer", provider: "anthropic", modelName: "claude-3-5-sonnet-20241022" });
  if (process.env.GOOGLE_API_KEY) supervisors.push({ name: "Gemini-Strategist", provider: "google", modelName: "gemini-pro" });
  if (process.env.DEEPSEEK_API_KEY) supervisors.push({ name: "DeepSeek-Analyst", provider: "deepseek", modelName: "deepseek-chat" });
  
  if (supervisors.length === 0) {
    console.warn("No API keys found. Using Mock Supervisor.");
    supervisors.push({ name: "Mock-Critic", provider: "custom", modelName: "mock-v1" });
  }

  const config: CouncilConfig = {
    supervisors,
    debateRounds: 2,
    autoContinue: false
  };

  const council = new Council(config);
  
  config.supervisors.forEach(conf => {
    switch (conf.provider) {
      case 'openai': council.registerSupervisor(new OpenAISupervisor(conf)); break;
      case 'anthropic': council.registerSupervisor(new AnthropicSupervisor(conf)); break;
      case 'google': council.registerSupervisor(new GoogleSupervisor(conf)); break;
      case 'deepseek': council.registerSupervisor(new DeepSeekSupervisor(conf)); break;
      default: council.registerSupervisor(new MockSupervisor(conf)); break;
    }
  });

  await council.init();

  console.log("Council is watching... (Press Ctrl+C to stop)");

  // Monitor Loop
  while (true) {
    try {
      // Refresh session status
      const sessionStatus = await client.session.get({ path: { id: session.id } });
      // Note: The SDK types might not expose 'status' directly on the get response if it's wrapped, 
      // but let's assume we can check if it's generating.
      // Actually, let's look at the last message.
      
      const messages = await client.session.messages({ path: { id: session.id } });
      const history = messages.data || [];
      
      if (history.length === 0) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const lastMsg = history[history.length - 1];
      
      // Check if the last message is from the Assistant (AI) and it's done generating.
      // We assume if we can fetch it, it's likely done or at least posted.
      // To be safe, we can check if the last message role is 'assistant'.
      
      if (lastMsg?.info.role === 'assistant') {
        console.log("AI has finished a turn. Council is deliberating...");

        // Gather Context
        // Heuristic: Find the last user message to define the "Current Goal"
        const lastUserMsg = [...history].reverse().find(m => m.info.role === 'user');
        const currentGoal = lastUserMsg 
            ? (lastUserMsg.parts.find(p => p.type === 'text') as any)?.text || "Unknown Goal"
            : "Review project state";

        const context: DevelopmentContext = {
            currentGoal,
            recentChanges: ["Session history analyzed"], // TODO: Diff analysis
            fileContext: {}, 
            projectState: "Active Development"
        };

        const guidance = await council.discuss(context);

        console.log("Sending guidance to OpenCode...");
        
        const guidanceText = `
## 🏛️ Council Guidance
**Approved:** ${guidance.approved ? '✅ Yes' : '❌ No'}

**Feedback:**
${guidance.feedback}

**Suggested Next Steps:**
${guidance.suggestedNextSteps.map(s => `- ${s}`).join('\n')}

*Please proceed with the next step.*
        `.trim();

        await client.session.prompt({
            path: { id: session.id },
            body: {
            parts: [{ type: "text", text: guidanceText }]
            }
        });
        
        console.log("Guidance sent. Waiting for AI execution...");
        
        // Wait a bit to ensure we don't loop instantly if the AI is fast or if we read our own message too fast
        // (Though our message will be 'user' role, so the loop check 'lastMsg.role === assistant' handles it)
        await new Promise(r => setTimeout(r, 10000)); 

      } else {
        // Last message was User (us or the human). Wait for AI to reply.
        // console.log("Waiting for AI...");
      }

    } catch (err) {
      console.error("Error in monitor loop:", err);
    }

    // Poll interval
    await new Promise(r => setTimeout(r, 60000));
  }
}

main().catch(console.error);
