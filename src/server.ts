import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

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

// ===== Estado em memória =====

const afterHoursConfig: AfterHoursConfig = {
  robotEnabled: true,
  atendimentoInicio: "09:00",
  atendimentoFim: "19:00",
  maxAutoReplies: 10,
};

let emergencyEmails: EmergencyEmail[] = [];

// ===== Config de e-mail (Nodemailer) =====

const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT
  ? Number(process.env.SMTP_PORT)
  : 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const emailFrom =
  process.env.EMERGENCY_EMAIL_FROM || "no-reply@rtlaser.com";

const canSendEmail =
  !!smtpHost && !!smtpPort && !!smtpUser && !!smtpPass;

const transporter = canSendEmail
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // 465 = SSL, outros = STARTTLS
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })
  : null;

// ===== Rotas AFTER HOURS =====

app.get("/admin/after-hours/health", (req: Request, res: Response) => {
  const payload: HealthResponse = {
    status: "ok",
    port: PORT,
    robotEnabled: afterHoursConfig.robotEnabled,
    chatguru: {
      instanceId: process.env.CHATGURU_INSTANCE_ID || null,
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
      apiUrl: process.env.CHATGURU_API_URL || "",
      accountId: process.env.CHATGURU_ACCOUNT_ID || "",
      instanceId: process.env.CHATGURU_INSTANCE_ID || "",
    },
    email: {
      from: emailFrom,
      to: emergencyEmails
        .filter((e) => e.active)
        .map((e) => e.email),
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

// ===== Rotas de e-mails de emergência =====

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

  return res.json({
    success: true,
    emails: emergencyEmails,
  });
});

// ===== Alerta de emergência (agora REAL, com e-mail) =====

app.post("/admin/emergency/alert", async (req: Request, res: Response) => {
  const { subject, message } = req.body || {};

  const activeEmails = emergencyEmails
    .filter((e) => e.active)
    .map((e) => e.email);

  if (!subject || !message) {
    return res.status(400).json({
      success: false,
      message: "Campos 'subject' e 'message' são obrigatórios.",
    });
  }

  if (!activeEmails.length) {
    return res.status(400).json({
      success: false,
      message: "Nenhum e-mail de emergência ativo cadastrado.",
    });
  }

  console.log("🚨 Requisição de alerta de emergência recebida:", {
    subject,
    message,
    activeEmails,
  });

  if (!canSendEmail || !transporter) {
    console.warn(
      "⚠️ SMTP não configurado corretamente. Alerta não será enviado por e-mail."
    );
    return res.json({
      success: false,
      emailSent: false,
      message:
        "SMTP não configurado. Alerta recebido, mas e-mail não foi disparado.",
    });
  }

  try {
    await transporter.sendMail({
      from: emailFrom,
      to: activeEmails.join(","),
      subject,
      text: message,
      html: `<p>${message}</p>`,
    });

    console.log("✅ Alerta de emergência enviado por e-mail com sucesso.");

    return res.json({
      success: true,
      emailSent: true,
      message: "Alerta de emergência enviado por e-mail.",
    });
  } catch (error) {
    console.error("❌ Erro ao enviar e-mail de emergência:", error);
    return res.status(500).json({
      success: false,
      emailSent: false,
      message: "Falha ao enviar e-mail de emergência.",
    });
  }
});

// ===== Webhook raiz (ainda simulado) =====

app.post("/", (req: Request, res: Response) => {
  const body = req.body || {};

  console.log("📩 Webhook recebido no robô fora de horário (simulação):", body);

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
});
