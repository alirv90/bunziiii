import Anthropic from "@anthropic-ai/sdk";
import index from "./index.html";

const client = new Anthropic();

const MODELS = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

Bun.serve({
  routes: {
    "/": index,

    "/api/models": {
      GET: () => Response.json({ models: MODELS }),
    },

    "/api/chat": {
      POST: async (req) => {
        const { messages, model, system } = await req.json() as {
          messages: Anthropic.MessageParam[];
          model: string;
          system?: string;
        };

        const stream = client.messages.stream({
          model: model ?? "claude-opus-4-6",
          max_tokens: 64000,
          thinking: { type: "adaptive" },
          system: system || "You are a helpful assistant.",
          // Cache the system prompt across requests
          ...(system && system.length > 100
            ? {
                system: [
                  {
                    type: "text",
                    text: system,
                    cache_control: { type: "ephemeral" },
                  },
                ],
              }
            : { system: system || "You are a helpful assistant." }),
          messages,
        });

        const encoder = new TextEncoder();

        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const event of stream) {
                if (
                  event.type === "content_block_delta" &&
                  event.delta.type === "text_delta"
                ) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "text", text: event.delta.text })}\n\n`
                    )
                  );
                } else if (
                  event.type === "content_block_delta" &&
                  event.delta.type === "thinking_delta"
                ) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "thinking", text: event.delta.thinking })}\n\n`
                    )
                  );
                } else if (event.type === "message_delta") {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "done", stop_reason: event.delta.stop_reason, usage: event.usage })}\n\n`
                    )
                  );
                }
              }
              const final = await stream.finalMessage();
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "usage",
                    usage: final.usage,
                  })}\n\n`
                )
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`
                )
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },

  development: {
    hmr: true,
    console: true,
  },

  port: 3000,
});

console.log("AI Playground running at http://localhost:3000");
