import fs from "fs";
import path from "path";
import type { SavingsPlanExtraction } from "../schemas/savings-plan.ts";
import type { CiPlanExtraction } from "../schemas/critical-illness.ts";
import type { IulExtraction } from "../schemas/iul.ts";

export type SessionStatus = "created" | "parsing" | "parsed" | "chatting" | "generating" | "done" | "error";
export type PlanDataType = SavingsPlanExtraction | CiPlanExtraction | IulExtraction;

export interface UploadedFile {
  path: string;
  name: string;
  type: "savings" | "ci" | "iul";
}

export interface ExtractionEntry {
  pdfName: string;
  pdfPath?: string;  // 关键: 用于 normalize() 计算 source.pdfHash
  planType: string;
  data: PlanDataType | null;
  error?: string;
}

export interface Session {
  id: string;
  ownerId: string;
  files: UploadedFile[];
  status: SessionStatus;
  extractions: ExtractionEntry[];
  chatHistory: { role: "user" | "assistant"; content: string }[];
  pptPath?: string;
  markdownPath?: string;
  previewPaths?: string[];
  previewPdfPath?: string;
  slideCount?: number;
  createdAt: string;
}

export interface SessionStore {
  save(session: Session): void;
  load(id: string): Session | undefined;
}

export class FileSessionStore implements SessionStore {
  private cache = new Map<string, Session>();
  private accessOrder: string[] = [];

  constructor(
    private readonly sessionDir: string,
    private readonly maxSessions: number,
    private readonly onEvict?: (sessionId: string) => void,
  ) {
    fs.mkdirSync(this.sessionDir, { recursive: true });
  }

  save(session: Session): void {
    this.touch(session.id);
    this.cache.set(session.id, session);
    const destination = this.filePath(session.id);
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(session, null, 2));
    fs.renameSync(temporary, destination);
  }

  load(id: string): Session | undefined {
    const cached = this.cache.get(id);
    if (cached) {
      this.touch(id);
      return cached;
    }
    const filePath = this.filePath(id);
    if (!fs.existsSync(filePath)) return undefined;
    const session = JSON.parse(fs.readFileSync(filePath, "utf8")) as Session;
    if (!session.ownerId) session.ownerId = "local";
    this.cache.set(id, session);
    this.touch(id);
    return session;
  }

  private filePath(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error("Invalid session id");
    return path.join(this.sessionDir, `${id}.json`);
  }

  private touch(id: string): void {
    const index = this.accessOrder.indexOf(id);
    if (index !== -1) this.accessOrder.splice(index, 1);
    this.accessOrder.push(id);
    while (this.accessOrder.length > this.maxSessions) {
      const evicted = this.accessOrder.shift();
      if (!evicted) continue;
      this.cache.delete(evicted);
      const filePath = this.filePath(evicted);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
      this.onEvict?.(evicted);
    }
  }
}
