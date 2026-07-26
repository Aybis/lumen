import { getChatGPTUser } from "@/app/chatgpt-auth";
import { MarketingSite } from "@/components/marketing-site";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <MarketingSite signedIn={Boolean(user)} />;
}
