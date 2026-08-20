import { notFound } from "next/navigation";
import { getSupabaseServerClient, type Marca } from "@/lib/supabase";
import ImportarPreciosApp from "@/components/ImportarPreciosApp";

export const dynamic = "force-dynamic";

export default async function ImportarPreciosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: marca } = await supabase.from("marcas").select("*").eq("id_marca", id).maybeSingle();
  if (!marca) notFound();

  return <ImportarPreciosApp marca={marca as Marca} />;
}
