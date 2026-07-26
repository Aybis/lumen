import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { AnalyticsWorkspace } from "@/components/analytics-workspace";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireChatGPTUser("/dashboard");
  return <AnalyticsWorkspace />;
}
