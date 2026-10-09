# @agentz/bench

Benchmarks of the suite's AI agents: price, speed and output of each model on
the same tasks, shown as a static site with the suite's design system.

```bash
pnpm dev:bench                                   # open the results (port 1490)
BENCH_MODELS=openai/gpt-6.1-sol pnpm bench:agent # add runs of a model
pnpm build:bench                                 # static site in dist/
```

## How a run works

The runner of ScriptZ (`modules/scriptz/bench/agentModels.run.ts`) is a demo
of the app that runs on its own:

- **Demo profiles** (`modules/scriptz/bench/profiles/`): settings, agent
  persona, folders with length targets, scripts, memory and ideas of a
  made-up user. Each profile, model and repetition gets a fresh SQLite
  database with the app's migrations, filled through the app's own storage
  functions.
- **Tasks** (`modules/scriptz/bench/tasks.ts`) take the app's real paths: the
  chat store with instructions, tools, fixed jobs and selections, the agent
  mode with its session line, the fact check of a line and learning from a
  finished script. Only the provider is replaced: the app's OpenRouter
  harness with the model under test.
- **Recorded per task:** the chat items the app would show, every tool call,
  every model step (provider, latency, first token, errors and retries), the
  cost OpenRouter billed (`usage.cost`, checked against
  `/api/v1/generation`), fixed checks and a blind rating by a judge model.

Runs are appended to `data/scriptz-agent.json`, so every new model adds to
the comparison. By default the page only counts runs of each task's newest
prompt state (instructions, tool schemas and message).

## Options

| Variable | Default | |
|---|---|---|
| `BENCH_MODELS` | the app's model | OpenRouter ids, comma separated |
| `BENCH_RUNS` | `2` | repetitions per model |
| `BENCH_PROFILES` | all | profile ids (`agentz`, `pflege`) |
| `BENCH_TASKS` | all | task ids, e.g. `agentz-hook,agentz-fact` |
| `BENCH_JUDGE` | `anthropic/claude-opus-5.5` | judge model, `off` to skip |
| `BENCH_REJUDGE` | | `1`: only rate stored runs without a rating |

The OpenRouter key comes from `OPENROUTER_API_KEY`, `.env.local` in the
repository root or `~/.agentz-secrets/openrouter-api-key`.

## Adding to it

- **A task:** an entry in `TASKS` with the request (as the app sends it),
  checks on what the user would see and a rubric for the judge.
- **A profile:** a file in `profiles/`, registered in `PROFILES` of the
  runner. Write new scripts; real user data never goes into this repository.
