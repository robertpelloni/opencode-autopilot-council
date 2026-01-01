import 'dotenv/config';
import { Council } from './council.js';
import { MockSupervisor } from './supervisors/MockSupervisor.js';
import { OpenAISupervisor } from './supervisors/OpenAISupervisor.js';
import { AnthropicSupervisor } from './supervisors/AnthropicSupervisor.js';
import { GoogleSupervisor } from './supervisors/GoogleSupervisor.js';
import { DeepSeekSupervisor } from './supervisors/DeepSeekSupervisor.js';
import type { DevelopmentContext, CouncilConfig, SupervisorConfig } from './types.js';

async function main() {
  console.log("Initializing OpenCode Autopilot Council...");

  // Example configuration - in a real plugin, this would come from user settings
  const supervisors: SupervisorConfig[] = [
    {
      name: "Mock-Critic",
      provider: "custom",
      modelName: "mock-v1"
    },
    // Uncomment to use real providers (requires .env variables)
    /*
    {
      name: "GPT-4o-Architect",
      provider: "openai",
      modelName: "gpt-4o"
    },
    {
      name: "Claude-Sonnet-Reviewer",
      provider: "anthropic",
      modelName: "claude-3-5-sonnet-20241022"
    }
    */
  ];

  const config: CouncilConfig = {
    supervisors: supervisors,
    debateRounds: 2,
    autoContinue: false
  };

  const council = new Council(config);

  // Register Supervisors based on config
  config.supervisors.forEach(conf => {
    switch (conf.provider) {
      case 'openai':
        council.registerSupervisor(new OpenAISupervisor(conf));
        break;
      case 'anthropic':
        council.registerSupervisor(new AnthropicSupervisor(conf));
        break;
      case 'google':
        council.registerSupervisor(new GoogleSupervisor(conf));
        break;
      case 'deepseek':
        council.registerSupervisor(new DeepSeekSupervisor(conf));
        break;
      case 'custom':
      default:
        council.registerSupervisor(new MockSupervisor(conf));
        break;
    }
  });

  await council.init();

  const mockContext: DevelopmentContext = {
    currentGoal: "Refactor the authentication middleware to support JWT and OAuth2.",
    recentChanges: ["Created auth.ts", "Installed jsonwebtoken package"],
    fileContext: {
      "src/auth.ts": "export const auth = (req, res, next) => { /* TODO */ }"
    },
    projectState: "Alpha"
  };

  console.log("\n--- Starting Discussion ---");
  const guidance = await council.discuss(mockContext);
  
  console.log("\n--- Final Guidance ---");
  console.log(JSON.stringify(guidance, null, 2));
}

main().catch(console.error);
