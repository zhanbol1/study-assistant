import { generateOpenAI, validateAnswer } from "../desktop/ai.mjs";
if (!process.env.OPENAI_API_KEY) {
  console.error("Live AI verification needs OPENAI_API_KEY in this terminal. Do not paste API keys into chat. The app can also store a key securely through Settings.");
  process.exit(2);
}
try {
  const result = await generateOpenAI({ key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: "Return a brief study tip. Use no sourceIds and an empty questions array.", messages: [{ role: "user", content: "Give one short study tip." }] });
  validateAnswer(result, [], "chat");
  console.log("Live OpenAI Responses verification passed. No coursework was sent.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
