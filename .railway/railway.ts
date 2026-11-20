// Infraestrutura do Zerômetro na Railway (IaC). Aplicar com:
//   mise run deploy:plan    → railway config plan (só mostra o diff)
//   mise run deploy:apply   → railway config apply
// Docs: https://docs.railway.com/infrastructure-as-code
//
// O que muda de uma instância para outra vem do ambiente de quem roda o plan/apply (o mise
// carrega o .env), não deste arquivo: cada pessoa sobe a própria instância a partir do mesmo
// repositório. Ver "Deploy (Railway)" no README.
import {
  bucket,
  defineRailway,
  github,
  preserve,
  project,
  ref,
  service,
  volume,
} from "railway/iac";

/** Repositório de onde a Railway builda: o oficial, para todo push na main chegar a todas as instâncias. */
const REPO = "ArthurResendeC/Zerometro";
/** Onde o volume é montado; o SQLite fica em /data/zerometro.db (ver Dockerfile). */
const DATA_DIR = "/data";
/** Porta em que o servidor escuta; o domínio próprio aponta para ela. */
const PORT = 8080;

/** Valor opcional do ambiente: vazio conta como ausente. */
const fromEnv = (name: string) => process.env[name]?.trim() || undefined;

/** Domínio próprio (ex.: zerometro.exemplo.com). Sem ele, use o gerado por `railway domain`. */
const domain = fromEnv("ZEROMETRO_DOMAIN");

/**
 * Backup do SQLite (Litestream, ver deploy/entrypoint.sh). Padrão: um bucket da Railway criado
 * aqui. Com ZEROMETRO_BACKUP=externo, nenhum bucket é criado e as BACKUP_* (R2 ou outro S3) são
 * definidas à mão com `railway variable set`; com ZEROMETRO_BACKUP=desligado, não há backup.
 */
const backupMode = fromEnv("ZEROMETRO_BACKUP") ?? "railway";
if (!["railway", "externo", "desligado"].includes(backupMode)) {
  throw new Error(`ZEROMETRO_BACKUP inválido: ${backupMode} (use railway, externo ou desligado)`);
}

export default defineRailway(() => {
  // SQLite com WAL: 1 GB sobra para anos de sessões; aumentar é online e não destrutivo.
  // Região fixa: sem ela, o plan lê a região de um volume existente como mudança.
  const data = volume("zerometro-data", {
    sizeMB: 1024,
    region: fromEnv("ZEROMETRO_VOLUME_REGION") ?? "us-west2",
  });

  // Região do bucket é fixa depois de criado. Por padrão, longe do volume (us-west2): um
  // problema na região do volume não leva o backup junto.
  const backups =
    backupMode === "railway"
      ? bucket("zerometro-backups", {
          region: (fromEnv("ZEROMETRO_BACKUP_REGION") ?? "iad") as "sjc" | "iad" | "ams" | "sin",
        })
      : undefined;

  const backupEnv = backups
    ? {
        BACKUP_BUCKET: ref(backups, "BUCKET"),
        BACKUP_ENDPOINT: ref(backups, "ENDPOINT"),
        BACKUP_REGION: ref(backups, "REGION"),
        BACKUP_ACCESS_KEY_ID: ref(backups, "ACCESS_KEY_ID"),
        BACKUP_SECRET_ACCESS_KEY: ref(backups, "SECRET_ACCESS_KEY"),
      }
    : backupMode === "externo"
      ? {
          BACKUP_BUCKET: preserve(),
          BACKUP_ENDPOINT: preserve(),
          BACKUP_REGION: preserve(),
          BACKUP_ACCESS_KEY_ID: preserve(),
          BACKUP_SECRET_ACCESS_KEY: preserve(),
        }
      : {};

  const web = service("web", {
    // Cada push na main gera um deploy (a Railway precisa de acesso ao repositório no GitHub).
    source: github(REPO, { branch: "main" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    deploy: {
      // SQLite num volume: exatamente uma instância, e nunca sem o volume
      // (sem ele o banco iria para o disco efêmero e sumiria no próximo deploy).
      numReplicas: 1,
      requiredMountPath: DATA_DIR,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    domains: domain ? [{ domain, port: PORT }] : [],
    volumeMounts: { [DATA_DIR]: data },
    env: {
      NODE_ENV: "production",
      TZ: fromEnv("TZ") ?? "America/Sao_Paulo",
      DATABASE_PATH: `${DATA_DIR}/zerometro.db`,
      PORT: String(PORT),
      // Emissor do OAuth do MCP e cookie Secure. Com domínio próprio a Railway não preenche
      // RAILWAY_PUBLIC_DOMAIN com ele; sem domínio próprio, o servidor usa o gerado.
      ...(domain && { PUBLIC_URL: `https://${domain}` }),
      //
      // Segredos: nunca neste arquivo (vai para o git). Defina uma vez com
      // `railway variable set NOME=valor`; preserve() mantém o valor que já está lá.
      ZEROMETRO_TOKEN: preserve(),
      IGDB_CLIENT_ID: preserve(),
      IGDB_CLIENT_SECRET: preserve(),
      // Conquistas (opcionais): sem a chave, a fonte fica desligada.
      STEAM_WEB_API_KEY: preserve(),
      RA_API_KEY: preserve(),
      ...backupEnv,
    },
  });

  return project("zerometro", { resources: backups ? [web, data, backups] : [web, data] });
});
