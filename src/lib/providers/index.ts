import type { ProviderKind } from "@/lib/types";
import type { CourseRecordProvider } from "./types";
import { MockProvider } from "./mock";
import { UploadProvider } from "./upload";
import { SessionProvider } from "./session";
import type { FixtureId } from "./fixtures";

export * from "./types";
export { MockProvider } from "./mock";
export { UploadProvider, UploadError } from "./upload";
export { SessionProvider } from "./session";

export function createProvider(kind: ProviderKind, opts?: { fixture?: FixtureId }): CourseRecordProvider {
  switch (kind) {
    case "mock":
      return new MockProvider(opts?.fixture ?? "demo");
    case "upload":
      return new UploadProvider();
    case "session":
      return new SessionProvider();
    case "api":
      throw new Error("api provider 未實作：本系統不代為登入校務系統。");
  }
}
