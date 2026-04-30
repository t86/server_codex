import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import { closeDb } from "./db.js";
import {
  archiveThread,
  createMessageInput,
  createThread,
  createThreadInput,
  createUserMessage,
  getThread,
  listMessages,
  listServerProfiles,
  listThreads,
  renameThread,
  renameThreadInput
} from "./repositories.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true,
  credentials: true
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: "validation_error",
      issues: error.issues
    });
  }

  request.log.error(error);
  return reply.status(500).send({
    error: "internal_server_error"
  });
});

app.get("/health", async () => ({
  ok: true,
  service: "server-codex-api"
}));

app.get("/threads", async () => ({
  threads: await listThreads()
}));

app.post("/threads", async (request, reply) => {
  const input = createThreadInput.parse(request.body ?? {});
  const thread = await createThread(input);
  return reply.status(201).send({ thread });
});

app.get("/threads/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const thread = await getThread(id);
  if (!thread) return reply.status(404).send({ error: "thread_not_found" });
  return { thread };
});

app.patch("/threads/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const input = renameThreadInput.parse(request.body ?? {});
  const thread = await renameThread(id, input);
  if (!thread) return reply.status(404).send({ error: "thread_not_found" });
  return { thread };
});

app.delete("/threads/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const thread = await archiveThread(id);
  if (!thread) return reply.status(404).send({ error: "thread_not_found" });
  return reply.status(204).send();
});

app.get("/threads/:id/messages", async (request, reply) => {
  const { id } = request.params as { id: string };
  const thread = await getThread(id);
  if (!thread) return reply.status(404).send({ error: "thread_not_found" });
  return { messages: await listMessages(id) };
});

app.post("/threads/:id/messages", async (request, reply) => {
  const { id } = request.params as { id: string };
  const thread = await getThread(id);
  if (!thread) return reply.status(404).send({ error: "thread_not_found" });

  const input = createMessageInput.parse(request.body ?? {});
  const result = await createUserMessage(id, input.content);
  return reply.status(201).send(result);
});

app.get("/servers", async () => ({
  servers: await listServerProfiles()
}));

const close = async () => {
  await app.close();
  await closeDb();
};

process.on("SIGINT", () => void close().finally(() => process.exit(0)));
process.on("SIGTERM", () => void close().finally(() => process.exit(0)));

await app.listen({ port: config.port, host: "0.0.0.0" });
