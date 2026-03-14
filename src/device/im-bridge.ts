import { EventEmitter } from "events";
import http, { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";
import { imageDir } from "../utils/dir";
import {
  setPendingCapturedImgForChat,
  hasPendingCapturedImgForChat,
  consumePendingCapturedImgForChat,
} from "../utils/image";
import dotenv from "dotenv";

dotenv.config();

type WhisplayIMPayload = {
  message?: string;
  messages?: Array<{ role: string; content: string }>;
  emoji?: string;
  imageBase64?: string;
};

type PendingPoll = {
  res: ServerResponse;
  timer: NodeJS.Timeout;
};

export class WhisplayIMBridgeServer extends EventEmitter {
  private server: http.Server | null = null;
  private port: number;
  private token: string;
  private inboxPath: string;
  private pollPath: string;
  private sendPath: string;
  private queue: WhisplayIMPayload[] = [];
  private pending: PendingPoll[] = [];

  constructor() {
    super();
    this.port = parseInt(process.env.WHISPLAY_IM_BRIDGE_PORT || "18888");
    this.inboxPath = process.env.WHISPLAY_IM_INBOX_PATH || "/whisplay-im/inbox";
    this.pollPath = process.env.WHISPLAY_IM_POLL_PATH || "/whisplay-im/poll";
    this.sendPath = process.env.WHISPLAY_IM_SEND_PATH || "/whisplay-im/send";
    this.token = process.env.WHISPLAY_IM_TOKEN || "";
  }

  start(): void {
    if (this.server) return;

    this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      const requestUrl = new URL(req.url || "", `http://localhost:${this.port}`);
      const pathname = requestUrl.pathname;

      if (this.token) {
        const auth = req.headers.authorization || "";
        if (auth !== `Bearer ${this.token}`) {
          res.statusCode = 401;
          res.end("Unauthorized");
          return;
        }
      }

      if (req.method === "GET" && pathname === this.pollPath) {
        const waitSec = parseInt(requestUrl.searchParams.get("waitSec") || "0");
        this.handlePoll(res, waitSec);
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body || "{}") as WhisplayIMPayload & {
            reply?: string;
          };
          if (pathname === this.inboxPath) {
            // Handle image in inbox: imageBase64 (data URL or raw base64)
            const imageBase64 = (payload as any).imageBase64 || "";
            if (imageBase64) {
              const localPath = this.saveBase64Image(imageBase64);
              if (localPath) {
                setPendingCapturedImgForChat(localPath);
                console.log(`[WhisplayIM] Inbox image saved as pending for chat: ${localPath}`);
                // Store local path so we can re-encode for poll response
                (payload as any)._localImagePath = localPath;
              }
            }
            this.enqueue(payload);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (pathname === this.sendPath) {
            const reply = payload.reply || payload.message || "";
            const imageBase64 = (payload as any).imageBase64 || "";
            const replyEvent: { reply: string; emoji: string; imagePath?: string } = {
              reply,
              emoji: payload.emoji || "",
            };
            if (imageBase64) {
              const localPath = this.saveBase64Image(imageBase64);
              if (localPath) {
                replyEvent.imagePath = localPath;
              }
            }
            if (reply || replyEvent.imagePath) {
              this.emit("reply", replyEvent);
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          res.statusCode = 404;
          res.end("Not Found");
        } catch (error) {
          res.statusCode = 400;
          res.end("Bad Request");
        }
      });
    });

    this.server.listen(this.port, () => {
      console.log(
        `[WhisplayIM] Bridge server listening on ${this.port}${this.inboxPath}`,
      );
    });
  }

  stop(): void {
    if (!this.server) return;
    this.server.close();
    this.server = null;
  }

  private enqueue(payload: WhisplayIMPayload): void {
    if (this.pending.length > 0) {
      const pending = this.pending.shift();
      if (pending) {
        clearTimeout(pending.timer);
        this.respondWithMessage(pending.res, payload);
      }
      return;
    }
    this.queue.push(payload);
  }

  private handlePoll(res: ServerResponse, waitSec: number): void {
    if (this.queue.length > 0) {
      const payload = this.queue.shift();
      this.respondWithMessage(res, payload || {});
      return;
    }

    if (waitSec <= 0) {
      this.respondWithMessage(res, {});
      return;
    }

    const timer = setTimeout(() => {
      this.pending = this.pending.filter((item) => item.res !== res);
      this.respondWithMessage(res, {});
    }, waitSec * 1000);

    this.pending.push({ res, timer });
  }

  private respondWithMessage(res: ServerResponse, payload: WhisplayIMPayload): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    const responseBody: any = {
      message: payload.message || "",
      messages: payload.messages || [],
    };
    // Re-encode locally saved image as base64 for poll response
    const localImagePath = (payload as any)._localImagePath || "";
    if (localImagePath && fs.existsSync(localImagePath)) {
      responseBody.imageBase64 = this.fileToBase64DataUrl(localImagePath);
    } else if (payload.imageBase64) {
      responseBody.imageBase64 = payload.imageBase64;
    }
    res.end(JSON.stringify(responseBody));
  }

  private fileToBase64DataUrl(filePath: string): string {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType =
        ext === ".png" ? "image/png"
        : ext === ".gif" ? "image/gif"
        : ext === ".webp" ? "image/webp"
        : "image/jpeg";
      const base64 = fs.readFileSync(filePath).toString("base64");
      return `data:${mimeType};base64,${base64}`;
    } catch {
      return "";
    }
  }

  private saveBase64Image(imageBase64: string): string {
    if (!imageBase64) return "";
    try {
      let data: string;
      let ext = ".jpg";
      if (imageBase64.startsWith("data:")) {
        const match = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          const format = match[1];
          data = match[2];
          ext = `.${format === "jpeg" ? "jpg" : format}`;
        } else {
          data = imageBase64.replace(/^data:[^;]+;base64,/, "");
        }
      } else {
        data = imageBase64;
      }
      const filename = `im-${Date.now()}${ext}`;
      const localPath = path.join(imageDir, filename);
      fs.writeFileSync(localPath, Buffer.from(data, "base64"));
      console.log(`[WhisplayIM] Saved base64 image to ${localPath}`);
      return localPath;
    } catch (err) {
      console.error(`[WhisplayIM] Failed to save base64 image: ${err}`);
      return "";
    }
  }
}
