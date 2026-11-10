import { redirect } from "next/navigation";

/** `/admin` now lives on its own pages: /admin/users and /admin/modules. */
export default function AdminIndexPage() {
  redirect("/admin/users");
}
