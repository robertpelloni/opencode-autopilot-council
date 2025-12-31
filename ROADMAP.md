# Project Roadmap

## Phase 1: Foundation (Current)
- [x] Initial Project Setup
- [x] Define Core Types (`src/types.ts`)
- [x] Implement Council Manager (`src/council.ts`)
- [x] Implement Base Supervisor Class (`src/supervisors/BaseSupervisor.ts`)

## Phase 2: Supervisor Integration (In Progress)
- [x] Mock Supervisor (for testing)
- [x] OpenAI Supervisor Implementation (`src/supervisors/OpenAISupervisor.ts`)
- [x] Anthropic Supervisor Implementation (`src/supervisors/AnthropicSupervisor.ts`)
- [x] Google Supervisor Implementation (`src/supervisors/GoogleSupervisor.ts`)
- [ ] DeepSeek Supervisor Implementation
- [ ] Other Providers (Grok, Moonshot, Qwen)

## Phase 3: Workflow & Orchestration
- [x] Basic Discussion Logic (Round-robin implemented in `Council`)
- [ ] Advanced Consensus Mechanism (Voting/Weighted)
- [ ] Auto-continue Hooks

## Phase 4: Interface & Visualization
- [x] CLI Interface (Entry point `src/index.ts`)
- [ ] Dashboard for Supervisor Status & Debate History
- [ ] Documentation & Submodule Tracking

## Phase 5: Testing & Refinement
- [ ] Unit Tests
- [ ] Integration Tests
- [ ] Performance Optimization
