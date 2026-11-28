import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { isSoundPackId, type ShopItem } from "@shared/items";
import { isThemeId, themeCategories, themeCategoryLabels, themes } from "@shared/themes";
import { CoinIcon, PlayIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAudioSettings } from "@/features/audio/audio-settings-store";
import { previewSound } from "@/features/audio/sounds";
import { PurchaseButton } from "@/features/shop/purchase-button";
import { formatCount } from "@/lib/format";
import { settingsQuery, shopQuery, useUpdateSettings } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

export const Route = createFileRoute("/loja")({
  loader: ({ context }) => context.queryClient.ensureQueryData(shopQuery()),
  component: ShopPage,
});

function ShopPage() {
  const { data: shop } = useSuspenseQuery(shopQuery());
  const themeGroups = themeCategories
    .map((category) => ({
      category,
      items: shop.items.filter(
        (i) => i.kind === "theme" && isThemeId(i.id) && themes[i.id].category === category,
      ),
    }))
    .filter((group) => group.items.length > 0);
  const packItems = shop.items.filter((i) => i.kind === "sound_pack");

  return (
    // gap, não space-y: a margem da moldura do Card anularia a do space-y.
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="mr-auto">
          <h1 className="display-lg">Loja</h1>
          <p className="mt-2 text-muted-foreground">
            Temas e sons para o seu Zerômetro, com as moedas que você ganha jogando.
          </p>
        </div>
        <Link
          to="/carteira"
          className="flex items-center gap-2 p-1 hover:bg-accent"
          title="Ver a carteira"
        >
          <CoinIcon className="size-6 text-coin" />
          <span className="display-md tabular-nums">{formatCount(shop.balance)}</span>
        </Link>
      </div>

      {themeGroups.map(({ category, items }) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="display-xs text-muted-foreground">
            Temas · {themeCategoryLabels[category]}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="min-w-0">
                <ThemeCard item={item} balance={shop.balance} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="flex flex-col gap-3">
        <h2 className="display-xs text-muted-foreground">Sons</h2>
        <p className="-mt-1 text-sm text-muted-foreground">
          Cada tema já vem com os sons dele. Avulsos, servem para misturar: o visual de um com os
          sons de outro.
        </p>
        <ul className="grid gap-4 sm:grid-cols-3">
          {packItems.map((item) => (
            <li key={item.id} className="min-w-0">
              <SoundPackCard item={item} balance={shop.balance} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ThemeCard({ item, balance }: { item: ShopItem; balance: number }) {
  const { data: settings } = useQuery(settingsQuery());
  const { activeId, previewId, startPreview, endPreview } = useTheme();
  const applyTheme = useUpdateSettings();
  if (!isThemeId(item.id)) return null;
  const theme = themes[item.id];
  const inUse = settings?.themeId === item.id;

  return (
    <Card className="h-full">
      <Swatch colors={theme.swatch} />
      <div className="space-y-1">
        <h3 className="display-sm">{item.name}</h3>
        <p className="text-sm text-muted-foreground">{item.description}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center">
        {item.owned ? (
          inUse && !previewId ? (
            <span className="display-xs px-1 py-2 text-muted-foreground">Em uso</span>
          ) : (
            <Button
              size="sm"
              disabled={applyTheme.isPending}
              onClick={() => {
                if (isThemeId(item.id)) {
                  applyTheme.mutate({ themeId: item.id }, { onSuccess: () => endPreview() });
                }
              }}
            >
              Usar
            </Button>
          )
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={activeId === item.id}
              onClick={() => startPreview(theme.id)}
            >
              {activeId === item.id ? "Experimentando" : "Experimentar"}
            </Button>
            {item.price !== null && (
              <PurchaseButton item={{ ...item, price: item.price }} balance={balance} />
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function SoundPackCard({ item, balance }: { item: ShopItem; balance: number }) {
  const volume = useAudioSettings((state) => state.volume);
  if (!isSoundPackId(item.id)) return null;
  const pack = item.id;

  return (
    <Card className="h-full">
      <div className="space-y-1">
        <h3 className="display-xs">{item.name}</h3>
        <p className="text-sm text-muted-foreground">{item.description}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center">
        <Button
          size="sm"
          variant="outline"
          aria-label={`Ouvir ${item.name}`}
          // Ouvir é pedido explícito: toca mesmo com os efeitos desligados (num volume audível).
          onClick={() => void previewSound(pack, "game-finished", Math.max(volume, 0.4))}
        >
          <PlayIcon /> Ouvir
        </Button>
        {item.owned ? (
          <span className="display-xs px-1 py-2 text-muted-foreground">Seu</span>
        ) : (
          item.price !== null && (
            <PurchaseButton item={{ ...item, price: item.price }} balance={balance} />
          )
        )}
      </div>
    </Card>
  );
}

/** Amostra do tema: fundo, superfície e destaque, em faixas. */
function Swatch({ colors }: { colors: readonly [string, string, string] }) {
  const [bg, surface, accent] = colors;
  return (
    <div
      aria-hidden
      className="flex h-16 items-end gap-2 p-3 frame-ring"
      style={{ backgroundColor: bg }}
    >
      <span className="h-6 w-16" style={{ backgroundColor: surface }} />
      <span className="h-10 w-10" style={{ backgroundColor: accent }} />
      <span className="h-4 flex-1" style={{ backgroundColor: surface, opacity: 0.5 }} />
    </div>
  );
}
