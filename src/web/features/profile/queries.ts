import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  AuthSession,
  ChangePasswordInput,
  CreatedInvite,
  CreateInviteInput,
  UpdateMeInput,
} from "@shared/auth";
import { api, unwrap } from "@/lib/api";
import { authKeys } from "@/lib/queries";

// A própria conta (/api/me) e a administração dos perfis (/api/admin, só o admin).

const onError = (error: Error) => toast.error(error.message);

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateMeInput) => unwrap(api.me.$patch({ json: patch })),
    onSuccess: (session: AuthSession) => {
      queryClient.setQueryData(authKeys.session, session);
      toast.success("Perfil salvo");
    },
    onError,
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => unwrap(api.me.password.$post({ json: input })),
    onSuccess: (session: AuthSession) => {
      queryClient.setQueryData(authKeys.session, session);
      toast.success("Senha trocada. Os outros aparelhos vão pedir para entrar de novo.");
    },
  });
}

export function useSignOutEverywhere() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.me["sign-out-everywhere"].$post()),
    onSuccess: (session: AuthSession) => {
      queryClient.setQueryData(authKeys.session, session);
      toast.success("Pronto: só este aparelho continua conectado.");
    },
    onError,
  });
}

export const adminKeys = {
  all: ["admin"] as const,
  users: ["admin", "users"] as const,
  invites: ["admin", "invites"] as const,
};

export const adminUsersQuery = () =>
  queryOptions({
    queryKey: adminKeys.users,
    queryFn: () => unwrap(api.admin.users.$get()),
  });

export const adminInvitesQuery = () =>
  queryOptions({
    queryKey: adminKeys.invites,
    queryFn: () => unwrap(api.admin.invites.$get()),
  });

export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInviteInput): Promise<CreatedInvite> =>
      unwrap(api.admin.invites.$post({ json: input })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.invites }),
    onError,
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await unwrap(api.admin.invites[":id"].$delete({ param: { id: String(id) } }));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.invites }),
    onError,
  });
}

export function useSetUserDisabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, disabled }: { userId: string; disabled: boolean }) => {
      const route = api.admin.users[":id"];
      const param = { param: { id: userId } };
      await unwrap(disabled ? route.disable.$post(param) : route.enable.$post(param));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
    onError,
  });
}

export function useCreateResetLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string): Promise<CreatedInvite> =>
      unwrap(api.admin.users[":id"]["reset-link"].$post({ param: { id: userId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.invites }),
    onError,
  });
}

export const invitePreviewQuery = (code: string) =>
  queryOptions({
    queryKey: ["invite", code] as const,
    queryFn: () => unwrap(api.auth.invites[":code"].$get({ param: { code } })),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
