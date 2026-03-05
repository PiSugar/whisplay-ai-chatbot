import fs from "fs";
import path from "path";
import http from "http";
import { Socket } from "net";
import Koa from "koa";
import Router from "@koa/router";
import serve from "koa-static";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { dataDir, cameraFeedDir } from "../utils/dir";
import { getImageMimeType } from "../utils/image";
import {
  webAudioBridge,
  FRAME_AUDIO_CHUNK,
  FRAME_LIVE_CAMERA,
  FRAME_CAMERA_CAPTURE,
  type WebAudioBridgeServer,
} from "./web-audio-bridge";
import type { Status } from "./display";

type ButtonHandler = () => void;

interface WebDisplayOptions {
  host: string;
  port: number;
  onButtonPress: ButtonHandler;
  onButtonRelease: ButtonHandler;
}

export class WebDisplayServer implements WebAudioBridgeServer {
  private app: Koa;
  private router: Router;
  private currentStatus: Status | null = null;
  private imageRevision = 0;
  private cameraFramePath: string | null = null;
  private host: string;
  private port: number;
  private onButtonPress: ButtonHandler;
  private onButtonRelease: ButtonHandler;
  private server: http.Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private wsClients = new Set<WebSocket>();

  constructor(options: WebDisplayOptions) {
    this.host = options.host;
    this.port = options.port;
    this.onButtonPress = options.onButtonPress;
    this.onButtonRelease = options.onButtonRelease;
    this.app = new Koa();
    this.router = new Router();
    this.cameraFramePath = this.resolveCameraFramePath();

    const staticRoot = this.resolveWebRoot();
    this.registerRoutes(staticRoot);
    this.app.use(this.router.routes());
    this.app.use(this.router.allowedMethods());
    this.app.use(serve(staticRoot));

    this.server = http.createServer(this.app.callback());
    this.wsServer = new WebSocketServer({ server: this.server, path: "/ws" });
    this.wsServer.on("connection", (socket) => {
      this.wsClients.add(socket);
      if (this.currentStatus) {
        socket.send(JSON.stringify({ type: "state", payload: this.buildStatePayload() }));
      }
      socket.on("message", (message, isBinary) =>
        this.handleWsMessage(socket, message, isBinary),
      );
      socket.on("close", () => this.wsClients.delete(socket));
      socket.on("error", () => this.wsClients.delete(socket));
    });

    // Register this server with the web-audio bridge so it can send commands
    // to connected browser clients.
    webAudioBridge.setServer(this);

    this.server.listen(this.port, this.host, () => {
      console.log(
        `[WebDisplay] Simulator running at http://${this.host}:${this.port}`,
      );
    });
  }

  updateStatus(status: Status): void {
    const prevCameraMode = this.currentStatus?.camera_mode || false;
    const nextImage = status.image || "";
    const prevImage = this.currentStatus?.image || "";
    if (nextImage !== prevImage) {
      this.imageRevision += 1;
    }
    this.currentStatus = { ...status };
    const nextCameraMode = this.currentStatus.camera_mode;
    if (!prevCameraMode && nextCameraMode) {
      if (webAudioBridge.isCameraEnabled()) {
        // Use browser camera: tell the web client to start streaming frames.
        webAudioBridge.notifyCameraStreamState(true);
      } else {
        this.sendCameraDaemonCommand("start_stream");
      }
    } else if (prevCameraMode && !nextCameraMode) {
      if (webAudioBridge.isCameraEnabled()) {
        webAudioBridge.notifyCameraStreamState(false);
      } else {
        this.sendCameraDaemonCommand("stop_stream");
      }
    }
    this.broadcastState();
  }

  close(): void {
    webAudioBridge.setServer(null);
    this.wsServer?.close();
    this.wsServer = null;
    this.wsClients.clear();
    this.server?.close();
    this.server = null;
  }

  /** Broadcast a text or binary message to every connected browser client. */
  broadcastToWebClients(message: string | Buffer): void {
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /** Return the number of currently connected browser clients. */
  getWebClientCount(): number {
    return this.wsClients.size;
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
      image_icon_visible: this.currentStatus.image_icon_visible,
      image_revision: this.imageRevision,
    };
  }

  private broadcastState(): void {
    if (!this.currentStatus || this.wsClients.size === 0) {
      return;
    }
    const payload = JSON.stringify({ type: "state", payload: this.buildStatePayload() });
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private handleWsMessage(
    socket: WebSocket,
    message: RawData,
    isBinary: boolean,
  ): void {
    // ── Binary frames: audio / camera data from browser ─────────────────────
    if (isBinary) {
      const buf = Buffer.isBuffer(message)
        ? message
        : Buffer.from(message as ArrayBuffer);
      if (buf.length < 2) return;
      const frameType = buf[0];
      const payload = buf.slice(1);
      if (frameType === FRAME_AUDIO_CHUNK) {
        webAudioBridge.handleAudioChunk(payload);
      } else if (frameType === FRAME_LIVE_CAMERA) {
        webAudioBridge.handleLiveCameraFrame(payload);
      } else if (frameType === FRAME_CAMERA_CAPTURE) {
        webAudioBridge.handleCameraCaptureResult(payload);
      }
      return;
    }

    // ── Text / JSON frames ────────────────────────────────────────────────────
    let data: any;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (data?.type === "button") {
      const action = String(data.action || "");
      if (action === "press") {
        this.onButtonPress();
      } else if (action === "release") {
        this.onButtonRelease();
      }
      return;
    }
    if (data?.type === "record_complete") {
      webAudioBridge.handleRecordComplete();
      return;
    }
    if (data?.type === "play_complete") {
      webAudioBridge.handlePlayComplete();
      return;
    }
    if (data?.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    }
  }

  private resolveCameraFramePath(): string | null {
    const candidate = path.resolve(cameraFeedDir, "web_live.jpg");
    // Camera frames are produced by the Python camera module (camera.py/CameraThread)
    // and consumed here by web-display. This avoids direct camera device ownership in web-display.
    const safe = this.resolveSafeImagePath(candidate);
    return safe || null;
  }

  private sendCameraDaemonCommand(cmd: string): void {
    const port = parseInt(process.env.WHISPLAY_CAMERA_DAEMON_PORT || "18765", 10);
    const socket = new Socket();
    socket.setTimeout(600);
    socket.connect(port, "127.0.0.1", () => {
      socket.write(`${JSON.stringify({ cmd })}\n`);
      socket.end();
    });
    socket.on("error", () => {
      socket.destroy();
    });
    socket.on("timeout", () => {
      socket.destroy();
    });
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
