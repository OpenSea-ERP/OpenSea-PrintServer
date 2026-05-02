import { describe, expect, it } from "vitest";
import { isValidIncomingMessage } from "./ws-client";

describe("isValidIncomingMessage", () => {
  describe("print-specific messages", () => {
    it("accepts a well-formed print command", () => {
      expect(
        isValidIncomingMessage({
          type: "print",
          jobId: "j-1",
          printerId: "POS-58mm",
          data: "AQID",
          copies: 1,
        }),
      ).toBe(true);
    });

    it("accepts request-printers", () => {
      expect(isValidIncomingMessage({ type: "request-printers" })).toBe(true);
    });

    it("rejects print command with copies out of range", () => {
      expect(
        isValidIncomingMessage({
          type: "print",
          jobId: "j",
          printerId: "p",
          data: "d",
          copies: 1000,
        }),
      ).toBe(false);
    });
  });

  describe("shared satellite messages (Satellite Contract v1)", () => {
    it("accepts a welcome message", () => {
      expect(
        isValidIncomingMessage({
          type: "welcome",
          terminalId: "agent-123",
          protocolVersion: "1.0",
          latestRelease: null,
        }),
      ).toBe(true);
    });

    it("accepts an app.release.published message for PRINT_SERVER kind", () => {
      expect(
        isValidIncomingMessage({
          type: "app.release.published",
          kind: "PRINT_SERVER",
          version: "1.6.0",
          downloadUrl:
            "https://github.com/OpenSea-ERP/OpenSea-PrintServer-Releases/releases/download/v1.6.0/OpenSea-PrintServer-Setup-1.6.0.exe",
          sha256: "a".repeat(64),
          releaseNotes: null,
          isCritical: false,
          releasedAt: "2026-05-02T19:00:00.000Z",
        }),
      ).toBe(true);
    });

    it("accepts release.published for OTHER kinds (client filters by kind itself)", () => {
      // Per the contract, the API broadcasts releases for every satellite
      // kind to every connected client; each client filters by `kind` and
      // ignores releases that are not its own. Validator must accept the
      // shape — the higher-level handler decides what to do with it.
      expect(
        isValidIncomingMessage({
          type: "app.release.published",
          kind: "EMPORION",
          version: "0.7.0",
          downloadUrl: "https://example/x.exe",
          sha256: "b".repeat(64),
          releaseNotes: null,
          isCritical: false,
          releasedAt: "2026-05-02T19:00:00.000Z",
        }),
      ).toBe(true);
    });

    it("rejects release.published with malformed sha256", () => {
      expect(
        isValidIncomingMessage({
          type: "app.release.published",
          kind: "PRINT_SERVER",
          version: "1.6.0",
          downloadUrl: "https://example/x.exe",
          sha256: "too-short",
          releaseNotes: null,
          isCritical: false,
          releasedAt: "2026-05-02T19:00:00.000Z",
        }),
      ).toBe(false);
    });

    it("rejects release.published with unknown kind", () => {
      expect(
        isValidIncomingMessage({
          type: "app.release.published",
          kind: "UNKNOWN_SATELLITE",
          version: "1.0",
          downloadUrl: "https://example/x",
          sha256: "a".repeat(64),
          releaseNotes: null,
          isCritical: false,
          releasedAt: "2026-05-02T19:00:00.000Z",
        }),
      ).toBe(false);
    });

    it("accepts a device.revoked message with valid reason", () => {
      expect(
        isValidIncomingMessage({
          type: "device.revoked",
          reason: "unpaired_by_admin",
          revokedBy: { userId: "u-1", email: "admin@x.com" },
          revokedAt: "2026-05-02T19:00:00.000Z",
        }),
      ).toBe(true);
    });

    it("rejects device.revoked with unknown reason", () => {
      expect(
        isValidIncomingMessage({
          type: "device.revoked",
          reason: "mystery",
          revokedBy: { userId: "u-1", email: "admin@x.com" },
          revokedAt: "2026-05-02T19:00:00.000Z",
        }),
      ).toBe(false);
    });
  });

  describe("hostile inputs", () => {
    it("rejects null", () => {
      expect(isValidIncomingMessage(null)).toBe(false);
    });

    it("rejects messages without a type", () => {
      expect(isValidIncomingMessage({ jobId: "x" })).toBe(false);
    });

    it("rejects messages with an unknown type", () => {
      expect(isValidIncomingMessage({ type: "wat" })).toBe(false);
    });
  });
});
