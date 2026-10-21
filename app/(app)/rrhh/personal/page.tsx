import { redirect } from "next/navigation";

// "Personal" ahora se llama Legajos. Los links viejos siguen funcionando.
export default function PersonalPage() {
  redirect("/rrhh/legajos");
}
