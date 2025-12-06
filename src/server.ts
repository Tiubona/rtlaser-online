import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ==== LOG GLOBAL DE TODAS AS REQUISIÇÕES ====
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log("🌐 Requisição recebida:", {
    method: req.method,
    url: req.originalUrl,
    query: req.query,
    headers: {
      "user-agent": req.headers["user-agent"],
      "x-forwarded-for": req.headers["x-forwarded-for"],
    },
  });
  next();
});

const PORT = Number(process.env.PORT) || 3002;

// ===== Tipos =====

type AfterHoursConfig = {
  robotEnabled: boolean;
  atendimentoInicio: string;
  atendimentoFim: string;
  maxAutoReplies: number;
};

type HealthResponse = {
  status: "ok";
  port: number;
  robotEnabled: boolean;
  chatguru?: {
    instanceId?: string | null;
  };
};

type EmergencyEmail = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
};

type ChatGuruConfig = {
  apiUrl: string;
  accountId: string;
  instanceId: string;
};

type DiagnosticLogEntry = {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
  context?: string;
};

// ===== Estado em memória =====

const afterHoursConfig: AfterHoursConfig = {
  robotEnabled: true,
  atendimentoInicio: "09:00",
  atendimentoFim: "19:00",
  maxAutoReplies: 10,
};

let emergencyEmails: EmergencyEmail[] = [];

// remetente configurável via painel (fallback: env)
let emailConfigFrom: string | null = process.env.EMERGENCY_EMAIL_FROM || null;

// ChatGuru configurável via painel (fallback: env)
const chatguruConfig: ChatGuruConfig = {
  apiUrl: process.env.CHATGURU_API_URL || "",
  accountId: process.env.CHATGURU_ACCOUNT_ID || "",
  instanceId: process.env.CHATGURU_INSTANCE_ID || "",
};

// logs de diagnóstico em memória
const diagnosticLogs: DiagnosticLogEntry[] = [];

function addLog(level: "info" | "warn" | "error", message: string, context?: string) {
  const entry: DiagnosticLogEntry = {
    id: Date.now().toString() + Math.random().toString(16).slice(2),
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
  };
  diagnosticLogs.unshift(entry);
  if (diagnosticLogs.length > 100) {
    diagnosticLogs.pop();
  }
}

// ===== Rotas AFTER HOURS (admin) =====

app.get("/admin/after-hours/health", (req: Request, res: Response) => {
  const payload: HealthResponse = {
    status: "ok",
    port: PORT,
    robotEnabled: afterHoursConfig.robotEnabled,
    chatguru: {
      instanceId: chatguruConfig.instanceId || null,
    },
  };

  res.json(payload);
});

app.get("/admin/after-hours/config", (req: Request, res: Response) => {
  res.json({
    robotEnabled: afterHoursConfig.robotEnabled,
    atendimento: {
      inicio: afterHoursConfig.atendimentoInicio,
      fim: afterHoursConfig.atendimentoFim,
      timezone: process.env.AFTER_HOURS_TIMEZONE || "America/Sao_Paulo",
    },
    maxAutoReplies: afterHoursConfig.maxAutoReplies,
    chatguru: {
      apiUrl: chatguruConfig.apiUrl,
      accountId: chatguruConfig.accountId,
      instanceId: chatguruConfig.instanceId,
    },
    email: {
      from: emailConfigFrom,
      to: emergencyEmails.filter((e) => e.active).map((e) => e.email),
    },
  });
});

app.put("/admin/after-hours/config", (req: Request, res: Response) => {
  const body = req.body || {};
  const { robotEnabled, atendimentoInicio, atendimentoFim, maxAutoReplies } =
    body;

  if (typeof robotEnabled === "boolean") {
    afterHoursConfig.robotEnabled = robotEnabled;
  }
  if (typeof atendimentoInicio === "string") {
    afterHoursConfig.atendimentoInicio = atendimentoInicio;
  }
  if (typeof atendimentoFim === "string") {
    afterHoursConfig.atendimentoFim = atendimentoFim;
  }
  if (
    typeof maxAutoReplies === "number" &&
    !Number.isNaN(maxAutoReplies) &&
    maxAutoReplies > 0
  ) {
    afterHoursConfig.maxAutoReplies = Math.floor(maxAutoReplies);
  }

  addLog(
    "info",
    "Configuração geral do after-hours atualizada via /admin/after-hours/config",
  );

  res.json({
    success: true,
    config: {
      robotEnabled: afterHoursConfig.robotEnabled,
      atendimentoInicio: afterHoursConfig.atendimentoInicio,
      atendimentoFim: afterHoursConfig.atendimentoFim,
      maxAutoReplies: afterHoursConfig.maxAutoReplies,
    },
  });
});

// ===== Rotas de e-mails de emergência (admin legado) =====

app.get("/admin/emergency/emails", (req: Request, res: Response) => {
  res.json({
    success: true,
    emails: emergencyEmails,
  });
});

app.post("/admin/emergency/emails", (req: Request, res: Response) => {
  const { name, email } = req.body || {};

  if (!email || typeof email !== "string") {
    return res.status(400).json({
      success: false,
      message: "Campo 'email' é obrigatório.",
    });
  }

  const newEmail: EmergencyEmail = {
    id: Date.now().toString(),
    name: typeof name === "string" && name.trim() ? name.trim() : email,
    email: email.trim(),
    active: true,
    createdAt: new Date().toISOString(),
  };

  emergencyEmails.push(newEmail);
  addLog("info", `E-mail de emergência adicionado: ${newEmail.email}`);

  return res.json({
    success: true,
    email: newEmail,
    emails: emergencyEmails,
  });
});

app.delete("/admin/emergency/emails/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const exists = emergencyEmails.some((e) => e.id === id);

  if (!exists) {
    return res.status(404).json({
      success: false,
      message: "E-mail não encontrado.",
    });
  }

  emergencyEmails = emergencyEmails.filter((e) => e.id !== id);
  addLog("info", `E-mail de emergência removido: id=${id}`);

  return res.json({
    success: true,
    emails: emergencyEmails,
  });
});

// ===== Alerta de teste (simulado, legado) =====

app.post("/admin/emergency/alert", (req: Request, res: Response) => {
  const { subject, message } = req.body || {};

  console.log("✅ Alerta de emergência recebido (simulação):", {
    subject,
    message,
  });

  addLog("info", "Alerta de emergência (simulado) recebido via /admin/emergency/alert");

  return res.json({
    success: true,
    message:
      "Alerta recebido pelo backend (simulado). Integração de e-mail real ainda não configurada.",
  });
});

// ==================================================================
// ========== NOVAS ROTAS PARA CONVERSAR COM O PAINEL ADMIN =========
// ==================================================================

// --------- CONFIG GERAL (alias para o painel) ---------

// GET /config  -> painel usa para pegar config geral + e-mail
app.get("/config", (req: Request, res: Response) => {
  res.json({
    robotEnabled: afterHoursConfig.robotEnabled,
    atendimento: {
      inicio: afterHoursConfig.atendimentoInicio,
      fim: afterHoursConfig.atendimentoFim,
      timezone: process.env.AFTER_HOURS_TIMEZONE || "America/Sao_Paulo",
    },
    maxAutoReplies: afterHoursConfig.maxAutoReplies,
    chatguru: {
      apiUrl: chatguruConfig.apiUrl,
      accountId: chatguruConfig.accountId,
      instanceId: chatguruConfig.instanceId,
    },
    email: {
      from: emailConfigFrom,
      to: emergencyEmails.filter((e) => e.active).map((e) => e.email),
    },
  });
});

// --------- CONFIG DE E-MAIL (alertas) ---------

// POST /config/email  -> painel salva remetente + lista de destinatários
app.post("/config/email", (req: Request, res: Response) => {
  const body = req.body || {};
  const { from, to } = body as { from?: string | null; to?: string[] };

  if (typeof from === "string") {
    emailConfigFrom = from.trim() || null;
  } else if (from === null) {
    emailConfigFrom = null;
  }

  const recipients = Array.isArray(to)
    ? to
        .map((e) => String(e).trim())
        .filter((e) => e.length > 0)
    : [];

  emergencyEmails = recipients.map((email) => ({
    id: Date.now().toString() + "-" + email,
    name: email,
    email,
    active: true,
    createdAt: new Date().toISOString(),
  }));

  addLog(
    "info",
    `Config de e-mail atualizada via /config/email (remetente=${emailConfigFrom || "null"}, destinatários=${recipients.length})`,
  );

  return res.json({
    success: true,
    message: "Configuração de e-mail atualizada em memória.",
  });
});

// POST /config/email/test  -> painel dispara teste
app.post("/config/email/test", (req: Request, res: Response) => {
  const body = req.body || {};
  const { from, to } = body as { from?: string | null; to?: string[] };

  const recipients = Array.isArray(to)
    ? to
        .map((e) => String(e).trim())
        .filter((e) => e.length > 0)
    : emergencyEmails.filter((e) => e.active).map((e) => e.email);

  console.log("📧 [SIMULAÇÃO] Envio de e-mail de teste", {
    from: from || emailConfigFrom,
    to: recipients,
  });

  addLog(
    "info",
    `E-mail de teste (simulado) enviado via /config/email/test para ${recipients.length} destinatário(s).`,
  );

  return res.json({
    success: true,
    message:
      "E-mail de teste (simulado) processado pelo backend. Integração real ainda não está ativa.",
  });
});

// --------- CONFIG DE CHATGURU (Conexões) ---------

// GET /config/chatguru  -> painel "Conexões" lê aqui
app.get("/config/chatguru", (req: Request, res: Response) => {
  res.json({
    apiUrl: chatguruConfig.apiUrl,
    accountId: chatguruConfig.accountId,
    instanceId: chatguruConfig.instanceId,
  });
});

// POST /config/chatguru  -> painel "Conexões" salva aqui
app.post("/config/chatguru", (req: Request, res: Response) => {
  const body = req.body || {};
  const { apiUrl, accountId, instanceId } = body as Partial<ChatGuruConfig>;

  if (typeof apiUrl === "string") {
    chatguruConfig.apiUrl = apiUrl.trim();
  }
  if (typeof accountId === "string") {
    chatguruConfig.accountId = accountId.trim();
  }
  if (typeof instanceId === "string") {
    chatguruConfig.instanceId = instanceId.trim();
  }

  addLog(
    "info",
    "Config de ChatGuru atualizada via /config/chatguru",
    JSON.stringify(chatguruConfig),
  );

  return res.json({
    success: true,
    message: "Configuração de ChatGuru atualizada em memória.",
    config: chatguruConfig,
  });
});

// ==================================================================
// =================== ROTAS DE DIAGNÓSTICO BÁSICO ===================
// ==================================================================

// Status do robô fora de horário
app.get("/diagnostics/robot", (req: Request, res: Response) => {
  res.json({
    status: "online",
    port: PORT,
    robotEnabled: afterHoursConfig.robotEnabled,
    uptimeSeconds: Math.floor(process.uptime()),
    lastHealthCheck: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Status da "conexão" com o ChatGuru (básico, baseado na config)
app.get("/diagnostics/chatguru", (req: Request, res: Response) => {
  const hasConfig =
    !!chatguruConfig.apiUrl && !!chatguruConfig.instanceId;

  res.json({
    connected: hasConfig,
    apiUrl: chatguruConfig.apiUrl || null,
    lastWebhookAt: null,
    lastError: hasConfig
      ? null
      : "Conexão ainda não testada ou não configurada corretamente.",
  });
});

// Logs de diagnóstico (painel pede limite)
app.get("/diagnostics/logs", (req: Request, res: Response) => {
  const limitRaw = req.query.limit;
  const limit = limitRaw ? Number(limitRaw) : 10;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 10;

  res.json(diagnosticLogs.slice(0, safeLimit));
});

// Teste rápido do robô
app.post("/diagnostics/robot/test", (req: Request, res: Response) => {
  addLog("info", "Teste de robô executado via /diagnostics/robot/test");

  res.json({
    success: true,
    message:
      "Robô respondeu ao teste (endpoint /diagnostics/robot/test está ativo).",
  });
});

// Teste rápido da conexão com o ChatGuru
app.post("/diagnostics/chatguru/test", (req: Request, res: Response) => {
  const hasConfig =
    !!chatguruConfig.apiUrl && !!chatguruConfig.instanceId;

  if (!hasConfig) {
    addLog(
      "warn",
      "Teste de ChatGuru falhou: config incompleta.",
      JSON.stringify(chatguruConfig),
    );

    return res.json({
      success: false,
      message:
        "CHATGURU_API_URL ou CHATGURU_INSTANCE_ID não configurados no painel Conexões.",
    });
  }

  // Aqui no futuro dá pra fazer um ping real na API do ChatGuru.
  addLog("info", "Teste de ChatGuru executado com config presente.");

  return res.json({
    success: true,
    message:
      "Teste básico de conexão executado. Configuração de ChatGuru encontrada em memória.",
  });
});

// ==================================================================
// ========================= ROTAS DO SIMULADOR ======================
// ==================================================================

// Simulador básico: só devolve uma conversa fake por enquanto
app.post("/simulator/run", (req: Request, res: Response) => {
  const body = req.body || {};
  const message: string = body.message || "";
  const isNewClient: boolean = !!body.isNewClient;
  const simulateAt: string =
    body.simulateAt || new Date().toISOString();

  const steps = [
    {
      from: "cliente" as const,
      text: message || "(mensagem vazia do cliente)",
    },
    {
      from: "robo" as const,
      text:
        "Simulação básica do robô RT Laser.\n\n" +
        "Aqui é onde, no futuro, vamos plugar o fluxo REAL do robô fora de horário " +
        "(regras, limites e mensagens automáticas). Por enquanto, este retorno serve " +
        "apenas para validar o painel e a comunicação com o backend.",
    },
  ];

  addLog(
    "info",
    "Simulação executada via /simulator/run",
    JSON.stringify({ isNewClient, simulateAt }),
  );

  return res.json({
    success: true,
    message:
      "Simulação executada em modo básico (sem regras reais ainda).",
    steps,
    raw: {
      simulateAt,
      isNewClient,
      robotEnabled: afterHoursConfig.robotEnabled,
    },
  });
});

// ==================================================================
// ===================== WEBHOOK RAIZ (SIMULAÇÃO) ====================
// ==================================================================

app.post("/", (req: Request, res: Response) => {
  const body = req.body || {};

  console.log("📩 Webhook recebido no robô fora de horário (simulação):", body);

  addLog("info", "Webhook raiz recebido em /", JSON.stringify(body));

  return res.json({
    success: true,
    mode: "SIMULATION_ONLY",
    robotEnabled: afterHoursConfig.robotEnabled,
    received: body,
  });
});

// ===== Inicialização do servidor =====

app.listen(PORT, () => {
  console.log(`Robô fora de horário RT Laser rodando na porta ${PORT}`);
  addLog("info", `Servidor iniciado na porta ${PORT}`);
});
