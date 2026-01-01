import { spawn, ChildProcess } from 'child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { Council } from './council.js';
import { OpenAISupervisor } from './supervisors/OpenAISupervisor.js';
import { AnthropicSupervisor } from './supervisors/AnthropicSupervisor.js';
import { GoogleSupervisor } from './supervisors/GoogleSupervisor.js';
import { DeepSeekSupervisor } from './supervisors/DeepSeekSupervisor.js';
import { MockSupervisor } from './supervisors/MockSupervisor.js';
import type { CouncilConfig, SupervisorConfig, DevelopmentContext } from './types.js';
import * as fs from 'fs';

interface Session {
    id: string;
    path: string;
    port: number;
    status: 'stopped' | 'starting' | 'running' | 'error';
    process: ChildProcess | null;
    client: any | null; // OpenCodeClient type is complex to import directly sometimes, using any for simplicity in manager
    council: Council | null;
    logs: string[];
    lastCheck: number;
}

export class SessionManager {
    private sessions: Map<string, Session> = new Map();
    private nextPort = 4096;

    constructor() {
        // Load existing sessions from disk if needed? For now, in-memory.
    }

    public getSessions() {
        return Array.from(this.sessions.values()).map(s => ({
            id: s.id,
            path: s.path,
            port: s.port,
            status: s.status,
            logs: s.logs.slice(-50), // Return last 50 logs
            lastCheck: s.lastCheck
        }));
    }

    public getLogs(id: string) {
        const session = this.sessions.get(id);
        return session ? session.logs : [];
    }

    public async addSession(repoPath: string) {
        const id = Math.random().toString(36).substring(7);
        const port = this.nextPort++;
        
        const session: Session = {
            id,
            path: repoPath,
            port,
            status: 'stopped',
            process: null,
            client: null,
            council: null,
            logs: [],
            lastCheck: 0
        };

        this.sessions.set(id, session);
        this.log(id, `Session created for ${repoPath} on port ${port}`);
        return session;
    }

    public async removeSession(id: string) {
        await this.stopSession(id);
        this.sessions.delete(id);
    }

    public async startSession(id: string) {
        const session = this.sessions.get(id);
        if (!session) throw new Error("Session not found");
        if (session.status === 'running') return;

        session.status = 'starting';
        this.log(id, "Starting OpenCode...");

        // Spawn OpenCode
        // Assuming 'opencode' is in PATH. 
        // We pass the repo path and the port.
        // Command: opencode start <path> --port <port> --headless?
        // Let's try: opencode <path> --port <port>
        // Or if it's a node script: node ...
        // Since I don't know the exact CLI signature of 'opencode', I'll assume a standard one.
        // If 'opencode' is not found, this will fail.
        
        try {
            // We use 'cmd' on Windows to ensure we catch .cmd/.bat files
            const cmd = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
            
            // Note: We are assuming 'opencode' command exists. 
            // If the user is running this from a dev environment where opencode is not installed globally,
            // we might need to adjust this.
            
            const child = spawn(cmd, [session.path, '--port', session.port.toString()], {
                env: { ...process.env, PORT: session.port.toString() },
                shell: true
            });

            session.process = child;

            child.stdout?.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) this.log(id, `[OpenCode]: ${msg}`);
            });

            child.stderr?.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) this.log(id, `[OpenCode Err]: ${msg}`);
            });

            child.on('error', (err) => {
                this.log(id, `Failed to start OpenCode: ${err.message}`);
                session.status = 'error';
            });

            child.on('close', (code) => {
                this.log(id, `OpenCode exited with code ${code}`);
                session.status = 'stopped';
                session.process = null;
                session.client = null;
            });

            // Wait for it to be ready
            // We'll try to connect in the main loop or here.
            // Let's give it a few seconds then mark as running.
            setTimeout(() => {
                if (session.status === 'starting') {
                    session.status = 'running';
                    this.initializeClient(session);
                }
            }, 5000);

        } catch (e: any) {
            session.status = 'error';
            this.log(id, `Error spawning process: ${e.message}`);
            throw e;
        }
    }

    public async stopSession(id: string) {
        const session = this.sessions.get(id);
        if (!session) return;

        if (session.process) {
            this.log(id, "Stopping OpenCode...");
            session.process.kill();
            session.process = null;
        }
        session.status = 'stopped';
        session.client = null;
    }

    private async initializeClient(session: Session) {
        try {
            this.log(session.id, `Connecting to OpenCode on port ${session.port}...`);
            session.client = createOpencodeClient({
                baseUrl: `http://localhost:${session.port}`,
            });

            // Verify connection
            await session.client.project.list();
            this.log(session.id, "Connected to OpenCode SDK");

            // Initialize Council
            this.initializeCouncil(session);

        } catch (e: any) {
            this.log(session.id, `Failed to connect SDK: ${e.message}`);
            // We don't set status to error, we just retry later in the loop
        }
    }

    private initializeCouncil(session: Session) {
        const supervisors: SupervisorConfig[] = [];
        if (process.env.OPENAI_API_KEY) supervisors.push({ name: "GPT-Architect", provider: "openai", modelName: "gpt-4o" });
        if (process.env.ANTHROPIC_API_KEY) supervisors.push({ name: "Claude-Reviewer", provider: "anthropic", modelName: "claude-3-5-sonnet-20241022" });
        if (process.env.GOOGLE_API_KEY) supervisors.push({ name: "Gemini-Strategist", provider: "google", modelName: "gemini-pro" });
        if (process.env.DEEPSEEK_API_KEY) supervisors.push({ name: "DeepSeek-Analyst", provider: "deepseek", modelName: "deepseek-chat" });
        
        if (supervisors.length === 0) {
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

        council.init().then(() => {
            this.log(session.id, "Council initialized");
            session.council = council;
        }).catch(err => {
            this.log(session.id, `Council init failed: ${err.message}`);
        });
    }

    public init() {
        // Main Monitoring Loop
        setInterval(async () => {
            for (const session of this.sessions.values()) {
                if (session.status !== 'running') continue;
                
                // Update last check
                session.lastCheck = Date.now();

                if (!session.client || !session.council) {
                    // Try to re-init if missing
                    if (!session.client) await this.initializeClient(session);
                    continue;
                }

                try {
                    await this.processSessionLoop(session);
                } catch (e: any) {
                    this.log(session.id, `Loop error: ${e.message}`);
                }
            }
        }, 10000); // Check every 10 seconds
    }

    private async processSessionLoop(session: Session) {
        // 1. Get Active Session from OpenCode
        const sessionsList = await session.client.session.list();
        if (!sessionsList.data || sessionsList.data.length === 0) {
            // No active session in OpenCode
            return;
        }
        
        // Pick the first one
        const activeSession = sessionsList.data[0];
        
        // 2. Check Messages
        const messages = await session.client.session.messages({ path: { id: activeSession.id } });
        const history = messages.data || [];

        if (history.length === 0) return;

        const lastMsg = history[history.length - 1];

        // 3. Check if AI finished
        if (lastMsg?.info.role === 'assistant') {
            this.log(session.id, "AI finished turn. Council deliberating...");

            // Gather Context
            const lastUserMsg = [...history].reverse().find(m => m.info.role === 'user');
            const currentGoal = lastUserMsg 
                ? (lastUserMsg.parts.find((p: any) => p.type === 'text') as any)?.text || "Unknown Goal"
                : "Review project state";

            const context: DevelopmentContext = {
                currentGoal,
                recentChanges: ["Session history analyzed"],
                fileContext: {}, 
                projectState: "Active Development"
            };

            const guidance = await session.council!.discuss(context);

            this.log(session.id, `Council Guidance: ${guidance.approved ? 'Approved' : 'Rejected'}`);

            const guidanceText = `
## 🏛️ Council Guidance
**Approved:** ${guidance.approved ? '✅ Yes' : '❌ No'}

**Feedback:**
${guidance.feedback}

**Suggested Next Steps:**
${guidance.suggestedNextSteps.map(s => `- ${s}`).join('\n')}

*Please proceed with the next step.*
            `.trim();

            await session.client.session.prompt({
                path: { id: activeSession.id },
                body: {
                    parts: [{ type: "text", text: guidanceText }]
                }
            });
            
            this.log(session.id, "Guidance sent to OpenCode.");
            
            // Wait to avoid double-processing
            // In a real app, we'd track the last processed message ID
            await new Promise(r => setTimeout(r, 10000));
        }
    }

    private log(id: string, message: string) {
        const session = this.sessions.get(id);
        if (session) {
            const timestamp = new Date().toLocaleTimeString();
            session.logs.push(`[${timestamp}] ${message}`);
            // Keep logs trimmed
            if (session.logs.length > 1000) session.logs.shift();
        }
        console.log(`[Session ${id}] ${message}`);
    }
}
