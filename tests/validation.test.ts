import { describe, it, expect } from "vitest";
import {
  isValidIncomingMessage,
  isValidApiUrl,
  safeLog,
  createRateLimiter,
  detectFormat,
  extractIpFromPort,
  detectorToCode,
  detectorToBackend,
  PrinterStatusCode,
  mapWindowsStatusWithPnp,
  classifyWindowsPrinterType,
  mapWindowsJobStatus,
  parseWindowsDate,
} from "../src/main/validation";

// ── isValidIncomingMessage ────────────────────────────────────────────────

describe("isValidIncomingMessage", () => {
  it("aceita request-printers", () => {
    expect(isValidIncomingMessage({ type: "request-printers" })).toBe(true);
  });

  it("aceita print válido com printerId legado", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "job-123",
        printerId: "HP LaserJet",
        data: "base64data",
        copies: 1,
      }),
    ).toBe(true);
  });

  it("aceita print válido com printerName preferido", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "job-456",
        printerName: "EPSON-TM-T20",
        data: "base64data",
        copies: 1,
      }),
    ).toBe(true);
  });

  it("aceita print carregando ambos printerName e printerId", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "job-789",
        printerName: "EPSON-TM-T20",
        printerId: "EPSON-TM-T20",
        data: "base64data",
        copies: 1,
      }),
    ).toBe(true);
  });

  it("aceita copies no limite máximo (999)", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        printerId: "p",
        data: "d",
        copies: 999,
      }),
    ).toBe(true);
  });

  it("rejeita null", () => {
    expect(isValidIncomingMessage(null)).toBe(false);
  });

  it("rejeita undefined", () => {
    expect(isValidIncomingMessage(undefined)).toBe(false);
  });

  it("rejeita string", () => {
    expect(isValidIncomingMessage("hello")).toBe(false);
  });

  it("rejeita type desconhecido", () => {
    expect(isValidIncomingMessage({ type: "unknown" })).toBe(false);
  });

  it("rejeita print sem jobId", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        printerId: "p",
        data: "d",
        copies: 1,
      }),
    ).toBe(false);
  });

  it("rejeita print com jobId vazio", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "",
        printerId: "p",
        data: "d",
        copies: 1,
      }),
    ).toBe(false);
  });

  it("rejeita print com jobId longo demais (>128)", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "x".repeat(129),
        printerId: "p",
        data: "d",
        copies: 1,
      }),
    ).toBe(false);
  });

  it("rejeita print sem printerName e sem printerId", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        data: "d",
        copies: 1,
      }),
    ).toBe(false);
  });

  it("rejeita print com printerName vazio e sem printerId", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        printerName: "",
        data: "d",
        copies: 1,
      }),
    ).toBe(false);
  });

  it("rejeita print com printerId vazio", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        printerId: "",
        data: "d",
        copies: 1,
      }),
    ).toBe(false);
  });

  it("rejeita print sem data", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        printerId: "p",
        copies: 1,
      }),
    ).toBe(false);
  });

  it("rejeita print com data vazio", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        printerId: "p",
        data: "",
        copies: 1,
      }),
    ).toBe(false);
  });

  it("rejeita copies = 0", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        printerId: "p",
        data: "d",
        copies: 0,
      }),
    ).toBe(false);
  });

  it("rejeita copies negativo", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        printerId: "p",
        data: "d",
        copies: -1,
      }),
    ).toBe(false);
  });

  it("rejeita copies > 999", () => {
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

  it("rejeita copies decimal", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        printerId: "p",
        data: "d",
        copies: 1.5,
      }),
    ).toBe(false);
  });

  it("rejeita copies string", () => {
    expect(
      isValidIncomingMessage({
        type: "print",
        jobId: "j",
        printerId: "p",
        data: "d",
        copies: "1",
      }),
    ).toBe(false);
  });
});

// ── isValidApiUrl ─────────────────────────────────────────────────────────

describe("isValidApiUrl", () => {
  it("aceita http em dev", () => {
    expect(isValidApiUrl("http://localhost:3333", false)).toBe(true);
  });

  it("aceita https em dev", () => {
    expect(isValidApiUrl("https://api.example.com", false)).toBe(true);
  });

  it("aceita https em prod", () => {
    expect(isValidApiUrl("https://api.example.com", true)).toBe(true);
  });

  it("rejeita http em prod (isPackaged)", () => {
    expect(isValidApiUrl("http://localhost:3333", true)).toBe(false);
  });

  it("rejeita ftp", () => {
    expect(isValidApiUrl("ftp://server.com", false)).toBe(false);
  });

  it("rejeita string inválida", () => {
    expect(isValidApiUrl("not-a-url", false)).toBe(false);
  });

  it("rejeita vazio", () => {
    expect(isValidApiUrl("", false)).toBe(false);
  });

  it("rejeita file://", () => {
    expect(isValidApiUrl("file:///etc/passwd", false)).toBe(false);
  });

  it("rejeita javascript:", () => {
    expect(isValidApiUrl("javascript:alert(1)", false)).toBe(false);
  });
});

// ── safeLog ───────────────────────────────────────────────────────────────

describe("safeLog", () => {
  it("retorna (vazio) para null", () => {
    expect(safeLog(null)).toBe("(vazio)");
  });

  it("retorna (vazio) para undefined", () => {
    expect(safeLog(undefined)).toBe("(vazio)");
  });

  it("retorna (vazio) para string vazia", () => {
    expect(safeLog("")).toBe("(vazio)");
  });

  it("passa texto normal", () => {
    expect(safeLog("hello world")).toBe("hello world");
  });

  it("remove newlines", () => {
    expect(safeLog("line1\nline2\rline3")).toBe("line1_line2_line3");
  });

  it("remove tabs", () => {
    expect(safeLog("col1\tcol2")).toBe("col1_col2");
  });

  it("remove null bytes", () => {
    expect(safeLog("ab\x00cd")).toBe("ab_cd");
  });

  it("trunca no maxLen", () => {
    expect(safeLog("abcdefghij", 5)).toBe("abcde");
  });

  it("default maxLen = 64", () => {
    const long = "x".repeat(100);
    expect(safeLog(long)).toHaveLength(64);
  });
});

// ── createRateLimiter ─────────────────────────────────────────────────────

describe("createRateLimiter", () => {
  it("permite primeira chamada", () => {
    const rl = createRateLimiter();
    expect(rl("test", 1000)).toBe(true);
  });

  it("bloqueia chamada dentro do intervalo", () => {
    const rl = createRateLimiter();
    rl("test", 1000);
    expect(rl("test", 1000)).toBe(false);
  });

  it("permite canais diferentes", () => {
    const rl = createRateLimiter();
    rl("chan-a", 1000);
    expect(rl("chan-b", 1000)).toBe(true);
  });

  it("permite após intervalo expirar", async () => {
    const rl = createRateLimiter();
    rl("test", 50);
    await new Promise((r) => setTimeout(r, 60));
    expect(rl("test", 50)).toBe(true);
  });
});

// ── detectFormat ──────────────────────────────────────────────────────────

describe("detectFormat", () => {
  it("detecta PDF (%PDF)", () => {
    const buf = Buffer.from("%PDF-1.4 content");
    expect(detectFormat(buf)).toBe("pdf");
  });

  it("detecta PostScript (%!)", () => {
    const buf = Buffer.from("%!PS-Adobe-3.0");
    expect(detectFormat(buf)).toBe("postscript");
  });

  it("retorna raw para dados desconhecidos", () => {
    const buf = Buffer.from([0x1b, 0x40, 0x48, 0x65]); // ESC/POS
    expect(detectFormat(buf)).toBe("raw");
  });

  it("retorna raw para buffer vazio", () => {
    expect(detectFormat(Buffer.alloc(0))).toBe("raw");
  });

  it("retorna raw para buffer de 1 byte", () => {
    expect(detectFormat(Buffer.from([0x25]))).toBe("raw");
  });

  it("detecta PDF com bytes exatos", () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    expect(detectFormat(buf)).toBe("pdf");
  });

  it("detecta PS com bytes exatos", () => {
    const buf = Buffer.from([0x25, 0x21]);
    expect(detectFormat(buf)).toBe("postscript");
  });
});

// ── extractIpFromPort ─────────────────────────────────────────────────────

describe("extractIpFromPort", () => {
  it("extrai IP de IP_192.168.1.100", () => {
    expect(extractIpFromPort("IP_192.168.1.100")).toBe("192.168.1.100");
  });

  it("extrai IP de TCP_10.0.0.1", () => {
    expect(extractIpFromPort("TCP_10.0.0.1")).toBe("10.0.0.1");
  });

  it("extrai IP de TCPMON:172.16.0.50", () => {
    expect(extractIpFromPort("TCPMON:172.16.0.50")).toBe("172.16.0.50");
  });

  it("extrai IP puro", () => {
    expect(extractIpFromPort("192.168.1.1")).toBe("192.168.1.1");
  });

  it("extrai IP de porta com sufixo IP_192.168.1.100_1", () => {
    expect(extractIpFromPort("IP_192.168.1.100_1")).toBe("192.168.1.100");
  });

  it("retorna null para USB001", () => {
    expect(extractIpFromPort("USB001")).toBeNull();
  });

  it("retorna null para LPT1:", () => {
    expect(extractIpFromPort("LPT1:")).toBeNull();
  });

  it("retorna null para vazio", () => {
    expect(extractIpFromPort("")).toBeNull();
  });

  it("retorna null para porta UNC", () => {
    expect(extractIpFromPort("\\\\server\\printer")).toBeNull();
  });

  it("extrai IP de WSD-xxx caso tenha IP", () => {
    expect(extractIpFromPort("WSD-192.168.1.5")).toBe("192.168.1.5");
  });
});

// ── detectorToCode / detectorToBackend ────────────────────────────────────

describe("detectorToCode", () => {
  it("ready → ONLINE (0)", () => {
    expect(detectorToCode("ready")).toBe(PrinterStatusCode.ONLINE);
  });

  it("offline → OFFLINE (1)", () => {
    expect(detectorToCode("offline")).toBe(PrinterStatusCode.OFFLINE);
  });

  it("error → ERROR (2)", () => {
    expect(detectorToCode("error")).toBe(PrinterStatusCode.ERROR);
  });

  it("unknown → UNKNOWN (3)", () => {
    expect(detectorToCode("unknown")).toBe(PrinterStatusCode.UNKNOWN);
  });
});

describe("detectorToBackend", () => {
  it("ready → ONLINE", () => {
    expect(detectorToBackend("ready")).toBe("ONLINE");
  });

  it("offline → OFFLINE", () => {
    expect(detectorToBackend("offline")).toBe("OFFLINE");
  });

  it("error → ERROR", () => {
    expect(detectorToBackend("error")).toBe("ERROR");
  });

  it("unknown → UNKNOWN", () => {
    expect(detectorToBackend("unknown")).toBe("UNKNOWN");
  });
});

// ── mapWindowsStatusWithPnp ───────────────────────────────────────────────

describe("mapWindowsStatusWithPnp", () => {
  it("USB com PnpStatus OK → ready", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 3,
        WorkOffline: false,
        PortName: "USB001",
        PnpStatus: "OK",
      }),
    ).toBe("ready");
  });

  it("USB com PnpStatus Error → offline", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 3,
        WorkOffline: false,
        PortName: "USB001",
        PnpStatus: "Error",
      }),
    ).toBe("offline");
  });

  it("USB desconectado (PnpStatus Degraded) → offline", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 3,
        WorkOffline: false,
        PortName: "USB002",
        PnpStatus: "Degraded",
      }),
    ).toBe("offline");
  });

  it("WorkOffline true → offline (independente de status)", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 3,
        WorkOffline: true,
        PortName: "TCP_192.168.1.1",
      }),
    ).toBe("offline");
  });

  it("PrinterStatus 3 (Idle) → ready", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 3,
        WorkOffline: false,
        PortName: "TCP_192.168.1.1",
      }),
    ).toBe("ready");
  });

  it("PrinterStatus 4 (Printing) → ready", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 4,
        WorkOffline: false,
        PortName: "LPT1",
      }),
    ).toBe("ready");
  });

  it("PrinterStatus 5 (Warmup) → ready", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 5,
        WorkOffline: false,
        PortName: "LPT1",
      }),
    ).toBe("ready");
  });

  it("PrinterStatus 6 (Stopped) → error", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 6,
        WorkOffline: false,
        PortName: "LPT1",
      }),
    ).toBe("error");
  });

  it("PrinterStatus 7 (Offline) → offline", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 7,
        WorkOffline: false,
        PortName: "LPT1",
      }),
    ).toBe("offline");
  });

  it("PrinterStatus 0 (Other) → unknown", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 0,
        WorkOffline: false,
        PortName: "LPT1",
      }),
    ).toBe("unknown");
  });

  it("PrinterStatus 2 (Unknown) → unknown", () => {
    expect(
      mapWindowsStatusWithPnp({
        PrinterStatus: 2,
        WorkOffline: false,
        PortName: "LPT1",
      }),
    ).toBe("unknown");
  });
});

// ── classifyWindowsPrinterType ────────────────────────────────────────────

describe("classifyWindowsPrinterType", () => {
  it("PDF no nome → virtual", () => {
    expect(
      classifyWindowsPrinterType("Microsoft Print to PDF", "PORTPROMPT:"),
    ).toBe("virtual");
  });

  it("XPS no nome → virtual", () => {
    expect(
      classifyWindowsPrinterType(
        "Microsoft XPS Document Writer",
        "PORTPROMPT:",
      ),
    ).toBe("virtual");
  });

  it("OneNote no nome → virtual", () => {
    expect(classifyWindowsPrinterType("Send to OneNote 2016", "nul:")).toBe(
      "virtual",
    );
  });

  it("Fax no nome → virtual", () => {
    expect(classifyWindowsPrinterType("Fax", "SHRFAX:")).toBe("virtual");
  });

  it("porta TCP → network", () => {
    expect(classifyWindowsPrinterType("HP LaserJet", "TCP_192.168.1.100")).toBe(
      "network",
    );
  });

  it("porta IP_ → network", () => {
    expect(classifyWindowsPrinterType("Epson L3150", "IP_192.168.1.50")).toBe(
      "network",
    );
  });

  it("porta UNC → network", () => {
    expect(
      classifyWindowsPrinterType("Shared Printer", "\\\\server\\printer"),
    ).toBe("network");
  });

  it("porta USB → local", () => {
    expect(classifyWindowsPrinterType("Canon MP250", "USB001")).toBe("local");
  });

  it("porta LPT → local", () => {
    expect(classifyWindowsPrinterType("Generic Printer", "LPT1:")).toBe(
      "local",
    );
  });

  it('"Print to" no nome → virtual', () => {
    expect(classifyWindowsPrinterType("Print to File", "FILE:")).toBe(
      "virtual",
    );
  });
});

// ── mapWindowsJobStatus ───────────────────────────────────────────────────

describe("mapWindowsJobStatus", () => {
  it("Printing → printing", () => {
    expect(mapWindowsJobStatus("Printing")).toBe("printing");
  });

  it("Spooling → printing", () => {
    expect(mapWindowsJobStatus("Spooling")).toBe("printing");
  });

  it("Paused → paused", () => {
    expect(mapWindowsJobStatus("Paused")).toBe("paused");
  });

  it("Error → error", () => {
    expect(mapWindowsJobStatus("Error")).toBe("error");
  });

  it("Failed → error", () => {
    expect(mapWindowsJobStatus("Failed")).toBe("error");
  });

  it("Blocked → error", () => {
    expect(mapWindowsJobStatus("Blocked")).toBe("error");
  });

  it("Deleting → deleting", () => {
    expect(mapWindowsJobStatus("Deleting")).toBe("deleting");
  });

  it("Normal → queued (default)", () => {
    expect(mapWindowsJobStatus("Normal")).toBe("queued");
  });

  it("string vazia → queued", () => {
    expect(mapWindowsJobStatus("")).toBe("queued");
  });

  it("case insensitive: PRINTING → printing", () => {
    expect(mapWindowsJobStatus("PRINTING")).toBe("printing");
  });
});

// ── parseWindowsDate ──────────────────────────────────────────────────────

describe("parseWindowsDate", () => {
  it("parseia /Date(timestamp)/", () => {
    const result = parseWindowsDate("/Date(1700000000000)/");
    expect(result).toBe(new Date(1700000000000).toISOString());
  });

  it("parseia ISO string", () => {
    const iso = "2024-01-15T10:30:00.000Z";
    expect(parseWindowsDate(iso)).toBe(iso);
  });

  it("retorna ISO agora para null", () => {
    const result = parseWindowsDate(null);
    const date = new Date(result);
    expect(date.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("retorna ISO agora para undefined", () => {
    const result = parseWindowsDate(undefined);
    const date = new Date(result);
    expect(date.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("retorna ISO agora para string inválida", () => {
    const result = parseWindowsDate("not-a-date");
    const date = new Date(result);
    expect(date.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("retorna ISO válido sempre", () => {
    const result = parseWindowsDate("/Date(0)/");
    expect(result).toBe("1970-01-01T00:00:00.000Z");
  });
});
