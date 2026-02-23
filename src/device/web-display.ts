import fs from "fs";
import path from "path";
import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import serve from "koa-static";
import { dataDir } from "../utils/dir";
import { getImageMimeType } from "../utils/image";
import type { Status } from "./display";

type ButtonHandler = () => void;

interface WebDisplayOptions {
  host: string;
  port: number;
  onButtonPress: ButtonHandler;
  onButtonRelease: ButtonHandler;
}

export class WebDisplayServer {
  private app: Koa;
  private router: Router;
  private currentStatus: Status | null = null;
  private imageRevision = 0;
  private cameraFramePath: string | null = null;
  private host: string;
  private port: number;
  private onButtonPress: ButtonHandler;
  private onButtonRelease: ButtonHandler;
  private server: ReturnType<Koa["listen"]> | null = null;

  constructor(options: WebDisplayOptions) {
    this.host = options.host;
    this.port = options.port;
    this.onButtonPress = options.onButtonPress;
    this.onButtonRelease = options.onButtonRelease;
    this.app = new Koa();
    this.router = new Router();
    this.cameraFramePath = this.resolveCameraFramePath();

    const staticRoot = this.resolveWebRoot();
    this.app.use(bodyParser({ enableTypes: ["json"] }));
    this.registerRoutes(staticRoot);
    this.app.use(this.router.routes());
    this.app.use(this.router.allowedMethods());
    this.app.use(serve(staticRoot));

    this.server = this.app.listen(this.port, this.host, () => {
      console.log(
        `[WebDisplay] Simulator running at http://${this.host}:${this.port}`,
      );
    });
  }

  updateStatus(status: Status): void {
    const nextImage = status.image || "";
    const prevImage = this.currentStatus?.image || "";
    if (nextImage !== prevImage) {
      this.imageRevision += 1;
    }
    this.currentStatus = { ...status };
  }

  close(): void {
    this.server?.close();
    this.server = null;
  }

  private resolveWebRoot(): string {
    return path.resolve(__dirname, "../..", "web", "whisplay-display");
  }

  private registerRoutes(staticRoot: string): void {
    this.router.get("/", (ctx) => {
      ctx.set("Cache-Control", "no-store");
      ctx.type = "text/html";
      ctx.body = fs.createReadStream(path.join(staticRoot, "index.html"));
    });

    this.router.get("/state", (ctx) => {
      ctx.set("Cache-Control", "no-store");
      ctx.body = this.buildStatePayload();
    });

    this.router.get("/image", (ctx) => {
      ctx.set("Cache-Control", "no-store");
      if (!this.currentStatus?.image) {
        ctx.status = 404;
        ctx.body = "No image";
        return;
      }

      const safePath = this.resolveSafeImagePath(this.currentStatus.image);
      if (!safePath || !fs.existsSync(safePath)) {
        ctx.status = 404;
        ctx.body = "Image not found";
        return;
      }

      ctx.type = getImageMimeType(safePath);
      ctx.body = fs.createReadStream(safePath);
    });

    this.router.get("/camera", (ctx) => {
      ctx.set("Cache-Control", "no-store");
      if (!this.cameraFramePath) {
        ctx.status = 404;
        ctx.body = "Camera frame not configured";
        return;
      }
      if (!fs.existsSync(this.cameraFramePath)) {
        ctx.status = 404;
        ctx.body = "Camera frame not found";
        return;
      }
      ctx.type = getImageMimeType(this.cameraFramePath);
      ctx.body = fs.createReadStream(this.cameraFramePath);
    });

    this.router.post("/button", (ctx) => {
      const action = String((ctx.request.body as any)?.action || "");
      if (action === "press") {
        this.onButtonPress();
      } else if (action === "release") {
        this.onButtonRelease();
      }
      ctx.body = { ok: true };
    });
  }

  private buildStatePayload(): any {
    if (!this.currentStatus) {
      return { ready: false };
    }

    return {
      ready: true,
      status: this.currentStatus.status,
      emoji: this.currentStatus.emoji,
      text: this.currentStatus.text,
      scroll_speed: this.currentStatus.scroll_speed,
      scroll_sync: this.currentStatus.scroll_sync,
      brightness: this.currentStatus.brightness,
      RGB: this.currentStatus.RGB,
      battery_color: this.currentStatus.battery_color,
      battery_level: this.currentStatus.battery_level,
      image: this.currentStatus.image,
      camera_mode: this.currentStatus.camera_mode,
      capture_image_path: this.currentStatus.capture_image_path,
      network_connected: this.currentStatus.network_connected,
      rag_icon_visible: this.currentStatus.rag_icon_visible,
      image_revision: this.imageRevision,
    };
  }

  private resolveCameraFramePath(): string | null {
    const configured = process.env.WHISPLAY_WEB_CAMERA_PATH;
    const fallback = path.resolve(dataDir, "camera", "web_live.jpg");
    const candidate = configured
      ? path.resolve(configured)
      : fallback;
    const safe = this.resolveSafeImagePath(candidate);
    return safe || null;
  }

  private resolveSafeImagePath(imagePath: string): string | null {
    const resolved = path.resolve(imagePath);
    const base = path.resolve(dataDir);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      return null;
    }
    return resolved;
  }
}
