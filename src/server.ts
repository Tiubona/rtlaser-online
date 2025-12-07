import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import bodyParser from "body-parser";

// ============================================================================
// CONFIGURAÇÕES BÁSICAS E TIPAGENS
// ============================================================================

type AfterHoursConfig = {
  timezone: string;
  emergencyEmailFrom: string;
  emergencyEmails: string[];
  robotEnabled: boolean;
};

type ChatGuruConfig = {
  apiUrl: string;
  accountId: string;
  instanceId: string | null;
};

type AfterHoursContext = {
  config: AfterHoursConfig;
  chatGuru: ChatGuruConfig;
};

// ============================================================================
// CARREGAR VARIÁVEIS DE AMBIENTE
// ============================================================================

const AFTER_HOURS_TIMEZONE =
  process.env.AFTER_HOURS_TIMEZONE?.trim() || "America/Sao_Paulo";

const EMERGENCY_EMAIL_FROM =
  process.env.EMERGENCY_EMAIL_FROM?.trim() || "rtlaser-emergencia@rtlaser.com";

// Esses valores vêm lá do painel do ChatGuru (API HTTP / Informações da API)
const CHATGURU_API_URL =
  process.env.CHATGURU_API_URL?.trim() || "https://s19.chatguru.app/api";

const CHATGURU_ACCOUNT_ID =
  process.env.CHATGURU_ACCOUNT_ID?.trim() || "rtlaser-conta-id-nao-configurado";

// Esse é o valor que você acabou de configurar no Render (CHATGURU_INSTANCE_ID)
const CHATGURU_INSTANCE_ID =
  process.env.CHATGURU_INSTANCE_ID?.trim() || null;

// ============================================================================
// ARQUIVOS DE CONFIG
// ============================================================================

const CONFIG_DIR = path.join(__dirname, "..", "config");
const EMERGENCY_EMAILS_FILE = path.join(CONFIG_DIR, "emergencyEmails.json");

// Garantir que a pasta de config existe
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// ============================================================================
// LOG SIMPLES EM ARQUIVO (APENAS PARA DEPURAÇÃO)
// ============================================================================

const LOG_FILE = path.join(__dirname, "..", "after-hours.log");

function addLog(level: "info" | "error", message: string, extra?: string) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${
    extra ? " | " + extra : ""
  }\n`;

  try {
    fs.appendFileSync(LOG_FILE, line, { encoding: "utf-8" });
  } catch (err) {
    console.error("Falha ao escrever log em arquivo:", err);
  }
}

// ============================================================================
// FUNÇÕES DE CONFIG (CARREGAR / SALVAR)
// ============================================================================

function loadEmergencyEmailsFromFile(): string[] {
  try {
    if (!fs.existsSync(EMERGENCY_EMAILS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(EMERGENCY_EMAILS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.emails)) {
      return parsed.emails;
    }
    return [];
  } catch (err) {
    console.error("Erro ao ler emergencyEmails.json:", err);
    return [];
  }
}

function saveEmergencyEmailsToFile(emails: string[]): void {
  try {
    const payload = { emails };
    fs.writeFileSync(EMERGENCY_EMAILS_FILE, JSON.stringify(payload, null, 2), {
      encoding: "utf-8",
    });
  } catch (err) {
    console.error("Erro ao salvar emergencyEmails.json:", err);
  }
}

// Config padrão em memória
const afterHoursConfig: AfterHoursConfig = {
  timezone: AFTER_HOURS_TIMEZONE,
  emergencyEmailFrom: EMERGENCY_EMAIL_FROM,
  emergencyEmails: loadEmergencyEmailsFromFile(),
  robotEnabled: true,
};

const chatGuruConfig: ChatGuruConfig = {
  apiUrl: CHATGURU_API_URL,
  accountId: CHATGURU_ACCOUNT_ID,
  instanceId: CHATGURU_INSTANCE_ID,
};

const context: AfterHoursContext = {
  config: afterHoursConfig,
  chatGuru: chatGuruConfig,
};

// ============================================================================
// APP EXPRESS
// ============================================================================

const app = express();

// CORS liberado (o painel admin em React se comunica com esse backend)
app.use(
  cors({
    origin: "*",
  })
);

// Para aceitar JSON grande do ChatGuru
app.use(bodyParser.json({ limit: "5mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// ============================================================================
// ROTAS BÁSICAS / STATUS
// ============================================================================

app.get("/", (req: Request, res: Response) => {
  res.send(
    "RT Laser – Robô de fora de horário ONLINE. Use POST (CRM) vindo do ChatGuru neste mesmo endpoint."
  );
});

// Endpoint que o painel admin usa pra ver o status do robô
app.get("/status", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    now: new Date().toISOString(),
    port: process.env.PORT || 10000,
    timezone: context.config.timezone,
    emergencyEmailFrom: context.config.emergencyEmailFrom,
    emergencyEmails: context.config.emergencyEmails,
    robotEnabled: context.config.robotEnabled,
    chatguru: {
      apiUrl: context.chatGuru.apiUrl,
      accountId: context.chatGuru.accountId,
      instanceId: context.chatGuru.instanceId || null,
    },
  });
});

// ============================================================================
// ROTAS DE CONFIGURAÇÃO PARA O PAINEL ADMIN (admin-rtlaser)
// ============================================================================

// GET: lista emails de emergência
app.get("/admin/emergency/emails", (req: Request, res: Response) => {
  try {
    const emails = loadEmergencyEmailsFromFile();
    context.config.emergencyEmails = emails;
    res.json({
      success: true,
      emails,
    });
  } catch (err) {
    console.error("Erro ao ler e-mails de emergência:", err);
    res.status(500).json({
      success: false,
      error: "Erro ao ler e-mails de emergência",
    });
  }
});

// POST: atualiza emails de emergência
app.post("/admin/emergency/emails", (req: Request, res: Response) => {
  try {
    const { emails } = req.body as { emails: string[] };

    if (!Array.isArray(emails)) {
      return res.status(400).json({
        success: false,
        error: "Campo 'emails' deve ser um array de strings.",
      });
    }

    const cleaned = emails
      .map((e) => String(e).trim())
      .filter((e) => e.length > 0);

    context.config.emergencyEmails = cleaned;
    saveEmergencyEmailsToFile(cleaned);

    addLog("info", "Lista de e-mails de emergência atualizada", cleaned.join(","));

    res.json({
      success: true,
      emails: cleaned,
    });
  } catch (err) {
    console.error("Erro ao salvar e-mails de emergência:", err);
    res.status(500).json({
      success: false,
      error: "Erro ao salvar e-mails de emergência",
    });
  }
});

// GET: configuração básica do robô
app.get("/admin/config", (req: Request, res: Response) => {
  res.json({
    success: true,
    config: {
      timezone: context.config.timezone,
      emergencyEmailFrom: context.config.emergencyEmailFrom,
      emergencyEmails: context.config.emergencyEmails,
      robotEnabled: context.config.robotEnabled,
    },
    chatguru: {
      apiUrl: context.chatGuru.apiUrl,
      accountId: context.chatGuru.accountId,
      instanceId: context.chatGuru.instanceId || null,
    },
  });
});

// POST: atualizar config básica (sem e-mails, que já têm rota própria)
app.post("/admin/config", (req: Request, res: Response) => {
  try {
    const { timezone, emergencyEmailFrom, robotEnabled } = req.body as Partial<AfterHoursConfig>;

    if (typeof timezone === "string" && timezone.trim().length > 0) {
      context.config.timezone = timezone.trim();
    }
    if (typeof emergencyEmailFrom === "string" && emergencyEmailFrom.trim().length > 0) {
      context.config.emergencyEmailFrom = emergencyEmailFrom.trim();
    }
    if (typeof robotEnabled === "boolean") {
      context.config.robotEnabled = robotEnabled;
    }

    addLog(
      "info",
      "Configuração básica atualizada",
      JSON.stringify({
        timezone: context.config.timezone,
        emergencyEmailFrom: context.config.emergencyEmailFrom,
        robotEnabled: context.config.robotEnabled,
      })
    );

    res.json({
      success: true,
      config: {
        timezone: context.config.timezone,
        emergencyEmailFrom: context.config.emergencyEmailFrom,
        emergencyEmails: context.config.emergencyEmails,
        robotEnabled: context.config.robotEnabled,
      },
    });
  } catch (err) {
    console.error("Erro ao atualizar configuração básica:", err);
    res.status(500).json({
      success: false,
      error: "Erro ao atualizar configuração básica",
    });
  }
});

// ============================================================================
// (OPCIONAL) ROTA DE SIMULAÇÃO – TESTE VIA TERMINAL (curl)
// ============================================================================

/**
 * Exemplo de teste via terminal:
 *
 * curl -X POST https://SEU-SERVICO.onrender.com/simular \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "origem": "teste-terminal",
 *     "mensagem": "hello rtlaser"
 *   }'
 */
app.post("/simular", (req: Request, res: Response) => {
  const body = req.body || {};
  console.log("📩 Requisição de simulação recebida em /simular:", body);

  addLog("info", "Simulação recebeu payload em /simular", JSON.stringify(body));

  return res.json({
    success: true,
    mode: "SIMULATION_ONLY",
    received: body,
  });
});

// ============================================================================
// WEBHOOK RAIZ VINDO DO CHATGURU (POST PARA URL)
// ============================================================================

/**
 * IMPORTANTE:
 * - Esta rota é chamada pelo ChatGuru usando a ação "POST PARA URL".
 * - O ChatGuru NÃO usa o corpo da resposta HTTP para mandar mensagem ao cliente.
 * - Ou seja: este robô serve para LOG, integrações, e futuramente e-mail / API,
 *   mas a resposta automática ao cliente ainda é feita pelos fluxos do ChatGuru.
 */

app.post("/", (req: Request, res: Response) => {
  const body = req.body || {};

  console.log("📩 Webhook recebido no robô fora de horário (simulação):", body);
  addLog("info", "Webhook raiz recebido em /", JSON.stringify(body));

  // Aqui você consegue ver no log:
  // - texto_mensagem
  // - celular
  // - phone_id
  // - chat_id
  // - tipo_mensagem (chat, audio, etc.)
  //
  // Hoje ele só registra e devolve 200 OK.
  // Se quiser que o robô realmente ENVIE mensagens automáticas no WhatsApp,
  // precisamos integrar com a API de envio do ChatGuru numa próxima etapa.

  return res.json({
    success: true,
    mode: "SIMULATION_ONLY",
    message:
      "Webhook recebido com sucesso no robô de fora de horário da RT Laser. (Este endpoint é apenas CRM/log – não responde o cliente automaticamente).",
    receivedSummary: {
      origem: body?.origem ?? body?.origin ?? null,
      texto_mensagem: body?.texto_mensagem ?? body?.mensagem ?? null,
      tipo_mensagem: body?.tipo_mensagem ?? null,
      celular: body?.celular ?? null,
      phone_id: body?.phone_id ?? null,
      chat_id: body?.chat_id ?? null,
      datetime_post: body?.datetime_post ?? null,
    },
  });
});

// ============================================================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================================================

const PORT = Number(process.env.PORT || 10000);

app.listen(PORT, () => {
  console.log(
    `Robô fora de horário RT Laser rodando na porta ${PORT} (timezone: ${context.config.timezone})`
  );
  console.log(
    `Config ChatGuru: apiUrl=${context.chatGuru.apiUrl}, accountId=${context.chatGuru.accountId}, instanceId=${context.chatGuru.instanceId}`
  );
});
