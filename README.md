# Triage Agent

An AI agent that handles customer-support tickets safely. It reads a ticket, looks up the customer and order, and proposes one action. Code checks the proposal against a risk policy, and a human approves anything risky before it runs.

> **The model proposes. Code decides. A human approves.**

![Dashboard](docs/screenshots/01-dashboard.png)

## The problem

An LLM that can issue refunds or send replies is dangerous if it acts on its own. This project shows a safer design for that.

## What it does

- **Classifies** each ticket (order status, refund, complaint, damaged item, spam, other).
- **Looks up facts** with read-only tools. The model never sees the tools that write data.
- **Proposes one action**: reply, refund and reply, close as spam, or escalate.
- **Checks the proposal in code.** A pure risk policy escalates low confidence, wrong-owner orders, refunds above the order total, and bad output.
- **Pauses for a human** on risky actions. The reviewer can approve, edit or reject.
- **Logs every step** (LLM calls, tool calls, decisions) and shows it as a trace in the UI.

## Screenshots

| Approval queue | Human review |
| --- | --- |
| ![Queue](docs/screenshots/02-queue.png) | ![Approval](docs/screenshots/03-approval.png) |

| Agent trace | Safe escalation |
| --- | --- |
| ![Trace](docs/screenshots/04-trace.png) | ![Escalation](docs/screenshots/05-escalation.png) |

## How it works

```
triage -> gather_context -> propose -> risk_gate -+-> escalate
                                                  +-> await_approval (human) -> execute
                                                  +-> execute (safe actions)
```

## Highlights

- **Human in the loop:** LangGraph pauses the run until a person decides, and the state is saved in Postgres.
- **Guardrails in code:** the risk policy is a pure function with no model, database or network, so it is easy to test.
- **Safe by design:** refunds are idempotent, so no double refunds. Invalid model output is retried once, then escalated. A provider outage fails the run instead of hiding as an escalation.
- **Tested offline:** a scripted fake model lets the tests run with no API key.

## Tech stack

Bun, TypeScript, LangGraph.js, Groq (`openai/gpt-oss-20b`), Fastify, Zod, PostgreSQL, React 19, Vite, TanStack Query, Tailwind CSS.

## Run it

Needs [Bun](https://bun.sh), Node 20+, Docker, and a free [Groq API key](https://console.groq.com/keys).

```sh
# Terminal 1: backend
cd backend
docker compose up -d           # Postgres on :5434
cp .env.example .env           # add your GROQ_API_KEY
bun install
bun run seed                   # 5 customers, 10 orders, 6 tickets
bun run start                  # API on :3000

# Terminal 2: frontend
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

Open http://localhost:5173, pick a ticket, press **Run agent**, then approve, edit or reject the proposal.

Run the tests (no API key needed): `cd backend && bun test`

## Try these tickets

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Order status question | Replied automatically |
| 2 | Valid refund | Waits for approval, then one refund |
| 3 | Spam | Close as spam, needs approval |
| 4 | Complaint | Reply needs approval |
| 5 | Someone else's order | Escalated |
| 6 | Refund above the order total | Escalated |

## Project layout

```
backend/   agent graph, risk policy, tools, Fastify API, tests
frontend/  React approval dashboard
docs/      screenshots
```
