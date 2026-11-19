// Infraestrutura do Zerômetro na Railway (IaC). Aplicar com:
//   mise run deploy:plan    → railway config plan (só mostra o diff)
//   mise run deploy:apply   → railway config apply
// Docs: https://docs.railway.com/infrastructure-as-code
import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

/** Onde o volume é montado; o SQLite fica em /data/zerometro.db (ver Dockerfile). */
const DATA_DIR = "/data";
const DOMAIN = "zerometro.arthur-resende.com.br";
/** Porta em que o servidor escuta; o domínio aponta para ela. */
const PORT = 8080;

export default defineRailway(() => {
  // SQLite com WAL: 1 GB sobra para anos de sessões; aumentar é online e não destrutivo.
  const data = volume("zerometro-data", { sizeMB: 1024 });

  const web = service("web", {
    // Cada push na main gera um deploy.
    source: github("ArthurResendeC/zerometro", { branch: "main" }),
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
    domains: [{ domain: DOMAIN, port: PORT }],
    volumeMounts: { [DATA_DIR]: data },
    env: {
      NODE_ENV: "production",
      TZ: "America/Sao_Paulo",
      DATABASE_PATH: `${DATA_DIR}/zerometro.db`,
      PORT: String(PORT),
      // Origem confiável do login e base do redirect do Google (com domínio próprio, a
      // Railway não preenche RAILWAY_PUBLIC_DOMAIN com ele).
      BETTER_AUTH_URL: `https://${DOMAIN}`,
      //
      // Segredos: nunca neste arquivo (vai para o git). Defina uma vez com
      // `railway variable set NOME=valor`; preserve() mantém o valor que já está lá.
      BETTER_AUTH_SECRET: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      IGDB_CLIENT_ID: preserve(),
      IGDB_CLIENT_SECRET: preserve(),
      ALLOWED_EMAILS: preserve(),
    },
  });

  return project("zerometro", { resources: [web, data] });
});
