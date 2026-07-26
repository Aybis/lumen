import { getChatGPTUser } from "@/app/chatgpt-auth";
import { AuthPage } from "@/components/auth-page";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getChatGPTUser();
  return <AuthPage mode="register" signedIn={Boolean(user)} />;
}
