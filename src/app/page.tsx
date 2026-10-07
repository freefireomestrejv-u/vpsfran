import { redirect } from "next/navigation";

export const metadata = {
  title: "RenewHub",
  description: "Entre na sua conta RenewHub",
};

// Sem landing page: a raiz leva ao painel (ou ao login, se deslogado).
export default function Home() {
  redirect("/dashboard");
}
