import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";

const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: async () => {
    const res = await api.health.$get();
    if (!res.ok) throw new Error(`API respondeu ${res.status}`);
    return res.json();
  },
});

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(healthQuery),
  component: Home,
});

function Home() {
  const { data, isError } = useQuery(healthQuery);

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">Quanto falta pra zerar?</h1>
      <p className="text-sm text-zinc-400">
        API: {isError ? "fora do ar" : data?.status === "ok" ? "ok" : "verificando…"}
      </p>
    </section>
  );
}
