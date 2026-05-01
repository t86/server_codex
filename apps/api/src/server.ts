import fs from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import { closeDb } from "./db.js";
import { attachmentId } from "./ids.js";
import {
  archiveThread,
  createMessageInput,
  createThread,
  createThreadInput,
  createUserMessage,
  getThread,
  importAccounts,
  importAccountsInput,
  listAccounts,
  listMessages,
  listServerProfiles,
  listThreads,
  updateThread,
  updateThreadInput,
  type MessageAttachment
} from "./repositories.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true,
  credentials: true
});

await app.register(multipart, {
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 8
  }
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
  const input = updateThreadInput.parse(request.body ?? {});
  const thread = await updateThread(id, input);
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

app.post("/threads/:id/attachments", async (request, reply) => {
  const { id } = request.params as { id: string };
  const thread = await getThread(id);
  if (!thread) return reply.status(404).send({ error: "thread_not_found" });

  const files = await request.files();
  const attachments: MessageAttachment[] = [];
  const attachmentDir = path.join(thread.workspace_path, "attachments");
  await fs.mkdir(attachmentDir, { recursive: true, mode: 0o700 });

  for await (const file of files) {
    if (!file.mimetype.startsWith("image/")) {
      return reply.status(400).send({ error: "unsupported_attachment_type" });
    }

    const id = attachmentId();
    const originalName = file.filename || "image";
    const ext = sanitizeExtension(path.extname(originalName), file.mimetype);
    const storedName = `${id}${ext}`;
    const destination = path.join(attachmentDir, storedName);
    const bytes = await file.toBuffer();
    await fs.writeFile(destination, bytes, { mode: 0o600 });

    attachments.push({
      id,
      name: safeDisplayName(originalName),
      mimeType: file.mimetype,
      path: destination,
      size: bytes.length,
      url: `/api/threads/${thread.id}/attachments/${id}`
    });
  }

  return reply.status(201).send({ attachments });
});

app.get("/threads/:id/attachments/:attachmentId", async (request, reply) => {
  const { id, attachmentId } = request.params as { id: string; attachmentId: string };
  const thread = await getThread(id);
  if (!thread) return reply.status(404).send({ error: "thread_not_found" });
  if (!/^att_[0-9a-z]+$/.test(attachmentId)) {
    return reply.status(404).send({ error: "attachment_not_found" });
  }

  const attachmentDir = path.join(thread.workspace_path, "attachments");
  const entries = await fs.readdir(attachmentDir).catch(() => []);
  const filename = entries.find((entry) => entry.startsWith(`${attachmentId}.`));
  if (!filename) return reply.status(404).send({ error: "attachment_not_found" });

  const filePath = path.join(attachmentDir, filename);
  const content = await fs.readFile(filePath);
  return reply.type(mimeTypeForFile(filename)).send(content);
});

app.post("/threads/:id/messages", async (request, reply) => {
  const { id } = request.params as { id: string };
  const thread = await getThread(id);
  if (!thread) return reply.status(404).send({ error: "thread_not_found" });

  const input = createMessageInput.parse(request.body ?? {});
  const result = await createUserMessage(id, input.content, input.attachments);
  return reply.status(201).send(result);
});

app.get("/servers", async () => ({
  servers: await listServerProfiles()
}));

app.get("/accounts", async () => ({
  accounts: await listAccounts()
}));

app.post("/accounts/import", async (request, reply) => {
  const input = importAccountsInput.parse(request.body ?? {});
  const result = await importAccounts(input);
  return reply.status(201).send(result);
});

const close = async () => {
  await app.close();
  await closeDb();
};

process.on("SIGINT", () => void close().finally(() => process.exit(0)));
process.on("SIGTERM", () => void close().finally(() => process.exit(0)));

function safeDisplayName(filename: string) {
  return path.basename(filename).replace(/[^\w.\-()\u4e00-\u9fa5 ]/g, "_").slice(0, 180) || "image";
}

function sanitizeExtension(ext: string, mimeType: string) {
  const clean = ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(clean)) return clean;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function mimeTypeForFile(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

await app.listen({ port: config.port, host: "0.0.0.0" });
