# Triage Agent

An AI agent that handles customer-support tickets safely. It reads a ticket, looks up the customer and order, and proposes one action. Code checks the proposal against a deterministic risk policy, and a human approves anything risky before it runs.

> **The model proposes. Code decides. A human approves.**

![Dashboard](docs/screenshots/01-dashboard.png)

## The problem

An LLM that can issue refunds or send replies is dangerous if it acts on its own. This project explores a safer architecture for AI-powered customer support by separating model reasoning, business rules, and action execution.

## What it does

- **Classifies** each ticket (order status, refund, complaint, damaged item, spam, other).
- **Looks up facts** using read-only tools. The model never receives tools that directly write data.
- **Proposes one action:** reply, refund and reply, close as spam, or escalate.
- **Checks the proposal in code.** A deterministic risk policy validates confidence, order ownership, refund amounts, and output validity.
- **Pauses for a human** on risky actions. The reviewer can approve, edit, or reject the proposal.
- **Persists graph state** using LangGraph's PostgreSQL checkpointer, allowing interrupted workflows to resume.
- **Prevents duplicate operations** using idempotent refund execution.
- **Logs every step** (LLM calls, tool calls, policy decisions) and exposes the execution trace in the UI.
- **Evaluates agent quality** using deterministic scoring and LLM-as-a-Judge.
- **Tracks regressions** by comparing evaluation reports across versions.

## Screenshots

| Approval queue | Human review |
| --- | --- |
| ![Queue](docs/screenshots/02-queue.png) | ![Approval](docs/screenshots/03-approval.png) |

| Agent trace | Safe escalation |
| --- | --- |
| ![Trace](docs/screenshots/04-trace.png) | ![Escalation](docs/screenshots/05-escalation.png) |

## How it works

The agent is implemented as a LangGraph state graph. The thread ID is the ticket ID, and graph state is checkpointed in PostgreSQL.

```mermaid
flowchart TD
    START([start]) --> triage
    triage -->|invalid output| risk_gate
    triage -->|spam| propose
    triage -->|other categories| gather_context
    gather_context --> propose
    propose --> risk_gate
    risk_gate -->|escalate| finalize
    risk_gate -->|needs approval| await_approval
    risk_gate -->|safe to run| execute
    await_approval -->|approve or edit| execute
    await_approval -->|reject| finalize
    execute --> finalize
    finalize --> END([end])
```

### Graph nodes

| Node | Responsibility |
| --- | --- |
| `triage` | The model classifies the ticket and produces a confidence score. |
| `gather_context` | Retrieves customer and order information through read-only tools, with a maximum of 8 tool calls. |
| `propose` | Generates one structured action proposal. Spam handling is generated directly in code without another model call. |
| `risk_gate` | Applies the deterministic risk policy to decide whether to escalate, request approval, or execute. |
| `await_approval` | Pauses execution using LangGraph's `interrupt()` until a human approves, edits, or rejects the proposal. |
| `execute` | Runs application-controlled write operations such as `create_refund` and `draft_reply`. |
| `finalize` | Updates the final ticket status: `resolved`, `escalated`, or `rejected`. |

### Human-in-the-loop execution

Sensitive actions require explicit human approval.

The workflow uses LangGraph interrupts and PostgreSQL checkpointing to preserve execution state while waiting for a decision.

When a reviewer submits a decision:

- **Approve:** Executes the proposed action.
- **Edit:** Validates the edited proposal and executes it.
- **Reject:** Ends the workflow without executing the proposed action.

The graph resumes from the interrupted node rather than restarting the entire workflow.

## Risk rules

The policy in `backend/src/agent/policy.ts` is implemented as a pure function.

It has no database, model, or network dependencies. Rules are evaluated in order, and the first escalation condition wins.

### Escalation

No proposed action is executed. The ticket is escalated for human handling.

| Reason | Trigger |
| --- | --- |
| `invalid_output` | Triage or proposal failed validation after retry, or required output is missing. |
| `loop_guard` | The model reaches the maximum of 8 tool calls. |
| `low_confidence` | Triage confidence is below 0.7. |
| `model_escalated` | The model itself proposes escalation. |
| `unverified_order` | The proposal references an order that was never retrieved. |
| `owner_mismatch` | A retrieved order does not belong to the requesting customer. |
| `bad_refund` | Refund amount is missing, zero, negative, or invalid. |
| `over_total` | Refund amount exceeds the order total. |

### Requires human approval

| Reason | Trigger |
| --- | --- |
| `refund` | Any refund and reply operation. |
| `spam_close` | Closing a ticket as spam. |
| `complaint_reply` | Sending a reply to a complaint. |
| `damaged_item_reply` | Sending a reply about a damaged product. |

### Automatic execution

A plain reply to other ticket categories, such as an order-status question, can execute automatically when it passes the risk policy.

## Evaluation Framework

Building an agent is only part of the problem. Understanding whether it behaves correctly and consistently is equally important.

This project includes a custom evaluation framework to measure triage classification quality and generated-summary quality, and to compare changes between agent versions.

### Evaluation architecture

```mermaid
flowchart TD
    A[Evaluation Dataset] --> B[Zod Dataset Validation]
    B --> C[Run Triage Agent]
    C --> D[Structured Prediction]

    D --> E[Deterministic Scorer]
    D --> F[LLM-as-a-Judge]

    E --> G[Evaluation Results]
    F --> G

    G --> H[Aggregate Metrics]
    H --> I[Save latest.json]
    I --> J[Compare with baseline.json]
    J --> K[Regression and Improvement Report]
```

### 1. Curated evaluation dataset

Location: `backend/evals/datasets/triage.json`

The dataset contains 20 curated customer-support scenarios.

Each test case includes:

- Customer email.
- Ticket subject.
- Customer message.
- Expected classification category.
- Scenario tags.

The scenarios cover:

| Category | Scenarios |
| --- | --- |
| Normal requests | Order status and delivery queries |
| Refunds | Refund requests and refund-related issues |
| Product issues | Damaged and incorrect products |
| Complaints | Delivery delays and customer dissatisfaction |
| Ambiguous requests | Missing information and unclear intent |
| Spam | Promotional and suspicious messages |
| Prompt injection | Attempts to override system instructions |
| Policy bypass | Attempts to bypass refund validation and authorization rules |

The dataset is validated before evaluation begins.

### 2. Deterministic scorer

Location: `backend/evals/scorers/triage.scorer.ts`

The deterministic scorer compares the predicted ticket category against the expected category.

```typescript
const passed = expected === actual;
```

It measures classification correctness without relying on another LLM.

### 3. LLM-as-a-Judge

Location: `backend/evals/judges/triage.judges.ts`

A separate LLM judge evaluates the quality of the generated triage summary against the original customer message.

Three dimensions are evaluated:

| Metric | What it measures |
| --- | --- |
| Accuracy | Whether the summary correctly represents the customer's request. |
| Faithfulness | Whether the summary contains only information supported by the original message. |
| Completeness | Whether the summary captures the important details and intent. |

Each dimension receives a score from 1 to 5 along with an explanation.

Judge failures are tracked separately from triage failures. This prevents an evaluation-provider failure from being incorrectly treated as an agent classification failure.

### 4. Evaluation metrics

The runner calculates:

| Metric | Description |
| --- | --- |
| Accuracy | Percentage of correctly classified cases. |
| Coverage | Percentage of evaluation cases where triage completed successfully. |
| Completed | Number of cases where the agent produced a valid prediction. |
| Failed | Number of incorrect classifications. |
| Errors | Number of cases where triage could not complete. |
| Judge accuracy | Average judge accuracy score. |
| Judge faithfulness | Average judge faithfulness score. |
| Judge completeness | Average judge completeness score. |

The runner also saves per-case predictions, classification status, judge scores, and judge feedback.

### 5. Evaluation results

The repository includes two persisted evaluation reports:

- `backend/evals/reports/baseline.json` — `triage-v1`
- `backend/evals/reports/latest.json` — `triage-v2`

The recorded results:

| Metric | v1 Baseline | v2 Latest |
| --- | ---: | ---: |
| Evaluation cases | 5 | 5 |
| Completed cases | 5 | 5 |
| Correct classifications | 5 | 5 |
| Classification accuracy | 100% | 100% |
| Evaluation coverage | 100% | 100% |
| Successfully judged | 5 | 4 |
| Judge accuracy | 4.40 / 5 | 5.00 / 5 |
| Judge faithfulness | 4.40 / 5 | 5.00 / 5 |
| Judge completeness | 4.40 / 5 | 4.75 / 5 |

The v2 implementation improved all three recorded summary-quality scores while maintaining classification accuracy and coverage.

**Evaluation scope:** Although the dataset contains 20 scenarios, the current runner intentionally evaluates the first 5 cases using `dataset.slice(0, 5)` to manage Groq API rate limits. The results above represent the five-case evaluation, not the complete dataset.

The v2 report contains one judge error. Its quality scores are calculated from the four successfully judged cases, rather than treating the failed judge call as a score.

### 6. Baseline comparison and regression detection

Location: `backend/evals/compare.ts`

The comparison utility loads the baseline and latest reports and compares:

- Classification accuracy.
- Evaluation coverage.
- Average judge accuracy.
- Average judge faithfulness.
- Average judge completeness.
- Individual test-case classification results.
- Individual test-case quality scores.

It identifies:

- **Classification regressions:** Previously passing cases that no longer pass.
- **Classification improvements:** Previously failing cases that now pass.
- **Quality regressions:** Cases with reduced judge scores.
- **Quality improvements:** Cases with improved judge scores.
- **Evaluation errors:** Changes in test-case execution status.

This makes it possible to evaluate whether changes to the agent improve behavior without introducing regressions.

## Highlights

- **Human in the loop:** LangGraph pauses execution until a person decides, and the state is persisted in PostgreSQL.
- **Guardrails in code:** The risk policy is a pure function with no model, database, or network dependencies.
- **Least privilege:** The model receives read-only tools during context retrieval. Write operations are controlled by the application.
- **Safe execution:** Refunds are idempotent, preventing duplicate refund operations.
- **Controlled retries:** Invalid structured model output is retried once and then escalated.
- **Fault isolation:** Provider failures fail the run rather than being silently converted into policy escalations.
- **Offline testing:** A scripted fake model allows graph and policy behavior to be tested without a Groq API key.
- **Measurable reliability:** Evaluation combines deterministic scoring, LLM-as-a-Judge, persisted reports, and baseline comparisons.

## Tech stack

| Layer | Technologies |
| --- | --- |
| Language | TypeScript |
| Runtime | Bun |
| Agent framework | LangGraph.js |
| LLM provider | Groq (`openai/gpt-oss-20b`) |
| LLM integration | LangChain |
| Validation | Zod |
| Backend API | Fastify |
| Database | PostgreSQL |
| State persistence | LangGraph PostgreSQL Checkpointer |
| Frontend | React 19, Vite |
| UI | TanStack Query, Tailwind CSS |
| Evaluation | Custom evaluation runner, deterministic scorer, LLM-as-a-Judge |

## Run it

### Prerequisites

- [Bun](https://bun.sh)
- Node.js 20+
- Docker
- A [Groq API key](https://console.groq.com/keys)

### 1. Clone the repository

```bash
git clone https://github.com/JayBhende05/triage-agent.git
cd triage-agent
```

### 2. Start PostgreSQL

```bash
cd backend
docker compose up -d
```

PostgreSQL runs on port `5434`.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Configure the following variables:

```env
DATABASE_URL=postgres://triage:triage@localhost:5434/triage_mvp
GROQ_API_KEY=your_groq_api_key
PORT=3000
```

### 4. Install dependencies and seed data

```bash
bun install
bun run seed
```

The seed script migrates the database and creates:

- 5 customers.
- 10 orders.
- 6 support tickets.

### 5. Start the backend

```bash
bun run start
```

The API runs at `http://localhost:3000`.

### 6. Start the frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` to access the dashboard.

Pick a ticket, press **Run agent**, and review the proposed action. Approve, edit, or reject it when the workflow pauses for human approval.

## Running evaluations

From the backend directory:

### Run the triage evaluation

```bash
bun run eval:triage
```

This command:

1. Loads and validates the evaluation dataset.
2. Runs the triage agent against the selected cases.
3. Compares predicted categories against expected categories.
4. Evaluates generated summaries using the LLM judge.
5. Calculates aggregate metrics.
6. Saves the latest evaluation report to `evals/reports/latest.json`.

### Compare evaluation versions

```bash
bun run eval:compare
```

This compares `baseline.json` and `latest.json`, reporting classification and quality regressions or improvements at both aggregate and individual test-case levels.

## Running tests

From the backend directory:

```bash
bun test
```

The test suite uses a scripted fake model to test graph execution, policy decisions, tools, and API behavior without requiring a Groq API key.

The PostgreSQL test database is required. Tests use a separate database named `triage_mvp_test` and refuse to run against a database that does not have the `_test` suffix.

## Try these tickets

| # | Scenario | Expected behavior |
| --- | --- | --- |
| 1 | Order status question | Reply automatically |
| 2 | Valid refund | Wait for approval, then execute one refund |
| 3 | Spam | Close as spam, subject to approval |
| 4 | Complaint | Reply requires approval |
| 5 | Someone else's order | Escalate |
| 6 | Refund above the order total | Escalate |

## Project layout

```text
triage-agent/
│
├── backend/
│   ├── src/
│   │   ├── agent/
│   │   │   ├── graph.ts
│   │   │   ├── policy.ts
│   │   │   ├── model.ts
│   │   │   ├── prompts.ts
│   │   │   ├── service.ts
│   │   │   ├── types.ts
│   │   │   └── checkpointer.ts
│   │   ├── api/
│   │   ├── db/
│   │   ├── tools/
│   │   └── lib/
│   │
│   ├── evals/
│   │   ├── datasets/
│   │   │   └── triage.json
│   │   ├── scorers/
│   │   │   ├── triage.scorer.ts
│   │   │   └── triage.scorer.test.ts
│   │   ├── judges/
│   │   │   └── triage.judges.ts
│   │   ├── reports/
│   │   │   ├── baseline.json
│   │   │   └── latest.json
│   │   ├── runner.ts
│   │   ├── compare.ts
│   │   └── types.ts
│   │
│   ├── tests/
│   └── package.json
│
├── frontend/
│   └── src/
│
├── docs/
│   └── screenshots/
│
└── README.md
```

## Engineering principles

This project explores several principles for building reliable AI agents:

- **Separation of concerns:** LLM reasoning is separated from deterministic business logic.
- **Least privilege:** The model uses read-only tools during context gathering.
- **Human oversight:** Sensitive operations require explicit approval.
- **Deterministic guardrails:** Critical business rules are enforced in application code.
- **Stateful execution:** Graph checkpointing enables interruption and resumption.
- **Fault isolation:** Model-output errors and provider failures are handled differently.
- **Measurable reliability:** Agent behavior is evaluated through deterministic metrics and LLM-based quality assessment.
- **Regression awareness:** Versioned reports help identify improvements and regressions across agent iterations.

## Future improvements

- Expand evaluation runs from 5 to the complete 20-case dataset.
- Add dedicated evaluation metrics for risk-policy decisions.
- Add more adversarial prompt-injection and authorization test cases.
- Track latency and token consumption.
- Integrate evaluation regression checks into CI.
- Maintain evaluation history across future agent versions.

---

**Built as an exploration of safe, observable, and measurable agentic systems.**