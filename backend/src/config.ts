export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://triage:triage@localhost:5434/triage_mvp",
  groqApiKey: process.env.GROQ_API_KEY,
  port: Number(process.env.PORT ?? 3000),
};
