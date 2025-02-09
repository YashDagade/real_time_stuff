import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fetch from "node-fetch";
import "dotenv/config";

// 1) Create Fastify
const server = Fastify({ logger: true });

// 2) Register CORS so that http://localhost:5173 can call our server
await server.register(fastifyCors, {
  origin: "*", // or ["http://localhost:5173"] for stricter
});

/**
 * /token route
 * Creates a Realtime session with:
 * - Model: gpt-4o-mini-realtime-preview-2024-12-17
 * - Voice: shimmer (female-like)
 * - instructions for Samantha
 * - modalities: ["audio","text"]
 * - input_audio_transcription: { model: "whisper-1" } so your mic input is transcribed
 */
server.get("/token", async (req, reply) => {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return reply
      .code(500)
      .send({ error: "Missing OPENAI_API_KEY in environment." });
  }

  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-realtime-preview-2024-12-17",
        modalities: ["audio", "text"],
        voice: "shimmer",
        instructions: `
          You are Samantha, a warm therapy assistant.
          You speak with a friendly, concise style.
          You can call highlightPastSummary, highlightClientSince, getTranscriptQuotes if needed.
        `,
        input_audio_transcription: {
          model: "whisper-1",
        },
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.log("OpenAI said:", text);
      return reply.code(500).send({ error: text });
    }

    const sessionData = await r.json();
    return reply.send(sessionData);
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// 4) Start on port 3000
const port = 3000;
server.listen({ port }).then(() => {
  console.log(`Fastify server listening on http://localhost:${port}`);
});
