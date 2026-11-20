import { z } from "zod";

// Perfil da Steam do usuário, para sincronizar conquistas e tempo jogado. Sem login na Steam:
// a pessoa informa o perfil (que precisa mostrar os jogos publicamente) e o servidor consulta
// com a chave da instância.

/** SteamID64 de conta de usuário: 17 dígitos começando com 7656119. */
const STEAM_ID64 = /^7656119\d{10}$/;
/** URL personalizada (steamcommunity.com/id/<nome>): letras, números, _ e -. */
const VANITY = /^[\w-]{2,32}$/;

export type SteamProfileRef = { steamId: string } | { vanity: string };

/**
 * Lê o que a pessoa colou: SteamID64, URL do perfil (/profiles/<id> ou /id/<nome>) ou só o nome
 * da URL personalizada. null se não parecer nenhum deles.
 */
export function parseSteamProfile(input: string): SteamProfileRef | null {
  const text = input.trim();
  if (STEAM_ID64.test(text)) return { steamId: text };
  const url = text.match(/steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)/i);
  if (url) {
    const [, kind, value = ""] = url;
    if (kind?.toLowerCase() === "profiles")
      return STEAM_ID64.test(value) ? { steamId: value } : null;
    return VANITY.test(value) ? { vanity: value } : null;
  }
  return VANITY.test(text) ? { vanity: text } : null;
}

export interface SteamProfile {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  profileUrl: string;
  linkedAt: string;
}

export const linkSteamProfileSchema = z.object({
  profile: z
    .string()
    .trim()
    .min(1, "Informe o perfil da Steam")
    .max(200)
    .refine((value) => parseSteamProfile(value) !== null, {
      message: "Use a URL do perfil (steamcommunity.com/id/… ou /profiles/…) ou o SteamID64",
    }),
});
export type LinkSteamProfileInput = z.infer<typeof linkSteamProfileSchema>;
