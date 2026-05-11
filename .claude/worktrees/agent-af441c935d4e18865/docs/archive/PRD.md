# Product Requirements Document: SiteForge v2

## 1. Product Overview
**Name**: SiteForge v2  
**Description**: An AI-native website and full-stack application generator that uses a multi-agent pipeline to transform user prompts into working, production-ready code. It provides real-time generation, live previews in isolated sandboxes, and chat-based iteration.
**Primary Goal**: To provide the fastest, most reliable way to go from a text description to a fully functioning React/Next.js codebase (and eventually full-stack Express/PostgreSQL apps) without sacrificing code quality.

## 2. Target Audience
- **Founders & Entrepreneurs**: Quickly building landing pages, MVPs, and prototypes.
- **Frontend Developers**: Generating boilerplate, initial component structures, and design systems rapidly to accelerate their workflow.
- **Designers**: Instantly translating high-level design ideas into functional, interactive prototypes.

## 3. Core Principles
- **Reliability > Quality > Speed**: If reliability drops below 90%, halt feature work and fix the pipeline first.
- **Iterative Refinement**: Users should be able to tweak specific components via chat without regenerating the entire site.
- **Production-Ready Output**: The generated code must be clean, use modern standards (Next.js App Router, Tailwind CSS v4, Lucide icons, Framer Motion), and be free of syntax or import errors.

## 4. Key Features & Functional Requirements

### 4.1. Multi-Agent Pipeline
- **Architect Agent**: Interprets the user's prompt and generates a structured "Blueprint" (JSON) outlining the pages, sections, and application layout.
- **Designer Agent**: Defines the design system, including typography, color palettes, spacing rhythm, and layout modes.
- **Developer Agent**: Generates the actual React components (.tsx files) in parallel based on the Architect's blueprint.
- **Validator/Verifier Agents**: 
  - Runs in 3 layers: Stream corrections (Layer A), AST Autofixing (Layer B), and Build Error parsing (Layer C).
  - Automatically fixes missing dependencies, import conflicts, string literal issues, and Next.js pattern errors without user intervention.

### 4.2. E2B Sandbox Environment
- Code is written directly to isolated, secure E2B cloud sandboxes.
- **Real-Time Preview**: The Next.js development server runs inside the sandbox, exposed via an iframe for instant user feedback.
- **Hot-Module Replacement (HMR)**: Iterations and fixes are hot-patched into the running sandbox without requiring full rebuilds.
- **Pre-warming & Speed**: Sandboxes are pre-warmed at T=0 and use prebuilt Docker templates to eliminate `npm install` overhead.

### 4.3. LLM Orchestration
- **Multi-Provider Strategy**: Uses Anthropic (Claude 3 Haiku / Sonnet) and Google (Gemini 2.5 Flash) simultaneously to maximize throughput and bypass rate limits.
- **Prompt Caching**: Utilizes Anthropic prompt caching to reduce Developer Agent costs and lower time-to-first-token.
- **Resilience**: Implements a circuit breaker pattern (e.g., 3 consecutive failures triggers a 5-minute fallback) to ensure pipeline stability.

### 4.4. Image Pipeline
- Contextually aware image generation injected securely into components.
- Graceful fallbacks and strict timeouts (15s) to ensure slow image generation does not block website rendering.

### 4.5. Project Management & Export
- **GitHub Sync**: Users can sync their generated projects directly to GitHub, with automatic repository creation and per-version commits.
- **Version History**: Supports rolling back to previous iterations.
- **Visual Edit Mode**: Clicking on an element in the preview highlights the corresponding source code.

## 5. Non-Functional Requirements (NFRs)
- **Performance (Speed)**: Time to first working preview (TTFP) must be <15s for the skeleton, and <30s for the fully enriched website.
- **Reliability**: Working preview reliability must exceed 95% in Phase 2+.
- **Auto-Fixing Rate**: The automated Validator pipeline must successfully resolve >70% of raw build errors.
- **Telemetry**: Comprehensive logging of token usage, prompt cache hit rates, and auto-fix success rates (written to `.siteforge/telemetry/`).

## 6. Future Roadmap (Phase 4)
- **Full-Stack Generation**: Expand from static sites to full-stack Express + PostgreSQL generation via Prisma.
- **Production Deployment**: Kubernetes deployment integration via OpenEverest Operator.
- **Custom Domains**: Allowing users to bind domains directly to their generated environments.
- **Rate Limiting & Auth**: Pro/Free tiers with Clerk authentication.
